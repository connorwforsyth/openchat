// Errors are values (PLAN.md D8): functions that can fail for expected reasons
// return a `Result` instead of throwing. A throw is reserved for bugs and is
// caught once, at the shell. The shape matches `scripts/ci/lib/result.ts`, so
// the guards' local copy can be swapped for this one without code changes.

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly error: E;
  readonly ok: false;
}

export type Result<T, E> = Ok<T> | Err<E>;

/** A `Result` that resolves later; the usual return type of a port method. */
export type AsyncResult<T, E> = Promise<Result<T, E>>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

export const err = <E>(error: E): Err<E> => ({ error, ok: false });

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;

export const isErr = <T, E>(result: Result<T, E>): result is Err<E> =>
  !result.ok;

export const map = <T, E, U>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> => (result.ok ? ok(fn(result.value)) : result);

export const mapErr = <T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F
): Result<T, F> => (result.ok ? result : err(fn(result.error)));

export const flatMap = <T, E, U, F>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, F>
): Result<U, E | F> => (result.ok ? fn(result.value) : result);

export const match = <T, E, U>(
  result: Result<T, E>,
  handlers: { readonly err: (error: E) => U; readonly ok: (value: T) => U }
): U => (result.ok ? handlers.ok(result.value) : handlers.err(result.error));

export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T =>
  result.ok ? result.value : fallback;

/**
 * Collects a list of results: the first error wins, otherwise every value in
 * order. For "report every problem" (config validation), collect errors
 * yourself instead.
 */
export const all = <T, E>(
  results: readonly Result<T, E>[]
): Result<readonly T[], E> => {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) {
      return result;
    }
    values.push(result.value);
  }
  return ok(values);
};

/**
 * Runs a function that may throw (a third-party API, `JSON.parse`) and turns
 * the throw into an error value at the boundary.
 */
export const tryCatch = <T, E>(
  fn: () => T,
  onError: (cause: unknown) => E
): Result<T, E> => {
  try {
    return ok(fn());
  } catch (cause) {
    return err(onError(cause));
  }
};

/** Like `tryCatch`, for a promise that may reject. Never rejects itself. */
export const fromPromise = async <T, E>(
  promise: PromiseLike<T> | (() => PromiseLike<T>),
  onError: (cause: unknown) => E
): AsyncResult<T, E> => {
  try {
    return ok(await (typeof promise === "function" ? promise() : promise));
  } catch (cause) {
    return err(onError(cause));
  }
};
