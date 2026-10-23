// The error body plain HTTP routes answer with: the same shape oRPC sends
// for a procedure's error, so a client handles both alike. `extra` adds
// route-specific fields, like the computer's `reason`.

export const problem = (
  status: number,
  code: string,
  message: string,
  extra: Readonly<Record<string, unknown>> = {}
) =>
  Response.json(
    { ...extra, code, defined: false, message, status },
    { status }
  );
