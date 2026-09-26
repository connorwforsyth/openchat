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
