// The error body plain HTTP routes answer with: the same shape oRPC sends
// for a procedure's error, so a client handles both alike.

export const problem = (status: number, code: string, message: string) =>
  Response.json({ code, defined: false, message, status }, { status });
