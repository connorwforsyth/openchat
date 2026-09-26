// Provider results carry `Date`s, bytes and `undefined`s; the proxy's wire is
// JSON with ISO timestamps and base64 bytes (as the AI SDK gateway sends).

const toBase64 = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64");

export const toJson = (value: unknown): unknown => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Uint8Array) {
    return toBase64(value);
  }
  if (value instanceof URL) {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(toJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([, child]) => child !== undefined && typeof child !== "function"
        )
        .map(([key, child]) => [key, toJson(child)])
    );
  }
  return value;
};
