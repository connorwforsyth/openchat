import { describe, expect, it } from "vitest";

import { callErrorOf } from "./voice-engine";

const problem = (status: number, code: string) =>
  Response.json({ code, defined: false, message: "x", status }, { status });

describe("callErrorOf", () => {
  it("says the service is down only when the server says so", async () => {
    expect(
      await callErrorOf("transcribe", problem(503, "SERVICE_UNAVAILABLE"))
    ).toBe("unavailable");
    expect(
      await callErrorOf("speak", problem(503, "SERVICE_UNAVAILABLE"))
    ).toBe("unavailable");
  });

  it("blames the stage for any other failure, a bare 503 included", async () => {
    const proxy = () =>
      new Response("<html>Bad gateway</html>", { status: 503 });
    expect(await callErrorOf("transcribe", proxy())).toBe("transcription");
    expect(await callErrorOf("speak", proxy())).toBe("speech");
    expect(
      await callErrorOf("transcribe", problem(413, "PAYLOAD_TOO_LARGE"))
    ).toBe("transcription");
  });
});
