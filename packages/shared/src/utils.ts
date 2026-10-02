// Small pure helpers with no better home. Keep this file short: anything
// domain-shaped belongs in the package that owns the domain.

/**
 * The `default` branch of an exhaustive `switch` over a discriminated union.
 * Reaching it is a bug (a new variant nobody handled), so it throws.
 */
export const assertNever = (value: never, what = "value"): never => {
  throw new Error(`Unhandled ${what}: ${JSON.stringify(value)}`);
};

/** A type guard for `.filter(isDefined)`. */
export const isDefined = <T>(value: T | null | undefined): value is T =>
  value !== null && value !== undefined;

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Keys of an object, typed as the object's own keys. */
export const keysOf = <T extends object>(value: T): (keyof T & string)[] =>
  Object.keys(value) as (keyof T & string)[];

export interface CappedText {
  readonly text: string;
  readonly truncated: boolean;
}

/**
 * Cuts `text` to about `max` characters for a model or the wire, keeping the
 * head and the tail (where errors usually are) and saying in between how
 * much was dropped, so a reader knows the result is partial.
 */
export const capText = (text: string, max: number): CappedText => {
  if (text.length <= max) {
    return { text, truncated: false };
  }
  const half = Math.floor(Math.max(max, 0) / 2);
  const dropped = text.length - half * 2;
  const head = text.slice(0, half);
  const tail = half > 0 ? text.slice(-half) : "";
  return {
    text: `${head}\n… ${dropped} characters omitted …\n${tail}`,
    truncated: true,
  };
};
