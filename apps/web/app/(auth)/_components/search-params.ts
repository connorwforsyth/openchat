/** Next's page `searchParams`. */
export type SearchParams = Promise<
  Readonly<Record<string, string | string[] | undefined>>
>;

/** The first value of a query parameter, if any. */
export const firstParam = (
  value: string | string[] | undefined
): string | undefined => (Array.isArray(value) ? value[0] : value);
