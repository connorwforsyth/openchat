// A local stand-in for the `Result` that `packages/shared` will export (ticket 005).
// The guards are root tooling, not a workspace package, so they keep their own
// copy rather than reaching into the app's dependency graph.
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ error, ok: false });
