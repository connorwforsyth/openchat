import { describe, expect, it } from "vitest";

import { BATCH_PATH, createApiClient } from "./api";

// Request batching (Q38) against a scripted `fetch`: no network. The fake
// answers a batch the way the server's `BatchHandlerPlugin` does in
// `buffered` mode: one JSON array of `{ index, status, body }`.

const MESSAGE_A = "01a0de5f-bf67-7628-9db6-f0c96ff5586c";
const MESSAGE_B = "01a0de5f-bf67-7628-9db6-f0c96ff5586d";

interface Sent {
  readonly credentials: RequestCredentials | undefined;
  readonly headers: Headers;
  readonly method: string;
  readonly url: URL;
}

interface BatchItem {
  readonly url: string;
}

/** Feedback for a message path, so each answer says which request it served. */
const feedbackFor = (path: string) => ({ comment: path, rating: "up" });

const fakeServer = () => {
  const sent: Sent[] = [];
  const fetch = (request: Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(request.url);
    sent.push({
      credentials: init?.credentials,
      headers: request.headers,
      method: request.method,
      url,
    });
    if (url.pathname === BATCH_PATH) {
      const items = JSON.parse(
        url.searchParams.get("batch") ?? "[]"
      ) as BatchItem[];
      return Promise.resolve(
        Response.json(
          items.map((item, index) => ({
            body: feedbackFor(new URL(item.url).pathname),
            index,
            status: 200,
          })),
          { status: 207 }
        )
      );
    }
    return Promise.resolve(Response.json(feedbackFor(url.pathname)));
  };
  return { fetch: fetch as typeof globalThis.fetch, sent };
};

describe("createApiClient batching", () => {
  it("sends concurrent GETs as one request, cookies and headers intact", async () => {
    const server = fakeServer();
    const client = createApiClient({
      baseUrl: "http://api.test",
      batch: true,
      fetch: server.fetch,
      headers: () => ({ authorization: "Bearer test-token" }),
    });

    const [a, b] = await Promise.all([
      client.feedback.get({ messageId: MESSAGE_A }),
      client.feedback.get({ messageId: MESSAGE_B }),
    ]);

    expect(server.sent).toHaveLength(1);
    const [batch] = server.sent;
    if (!batch) {
      throw new Error("no request went out");
    }
    expect(batch.method).toBe("GET");
    expect(`${batch.url.origin}${batch.url.pathname}`).toBe(
      `http://api.test${BATCH_PATH}`
    );
    expect(batch.headers.get("x-orpc-batch")).toBe("buffered");
    expect(batch.headers.get("authorization")).toBe("Bearer test-token");
    expect(batch.credentials).toBe("include");
    // Each caller gets its own answer back.
    expect(a).toMatchObject({
      comment: `/api/messages/${MESSAGE_A}/feedback`,
    });
    expect(b).toMatchObject({
      comment: `/api/messages/${MESSAGE_B}/feedback`,
    });
  });

  it("never batches a write", async () => {
    const server = fakeServer();
    const client = createApiClient({
      baseUrl: "http://api.test",
      batch: true,
      fetch: server.fetch,
    });

    await Promise.all([
      client.feedback.set({ messageId: MESSAGE_A, rating: "up" }),
      client.feedback.set({ messageId: MESSAGE_B, rating: "down" }),
    ]);

    expect(server.sent.map((each) => each.method)).toEqual(["PUT", "PUT"]);
    expect(server.sent.map((each) => each.url.pathname)).not.toContain(
      BATCH_PATH
    );
  });

  it("is off by default with an injected fetch", async () => {
    const server = fakeServer();
    const client = createApiClient({
      baseUrl: "http://api.test",
      fetch: server.fetch,
    });

    await Promise.all([
      client.feedback.get({ messageId: MESSAGE_A }),
      client.feedback.get({ messageId: MESSAGE_B }),
    ]);

    expect(server.sent.map((each) => each.url.pathname).sort()).toEqual(
      [
        `/api/messages/${MESSAGE_A}/feedback`,
        `/api/messages/${MESSAGE_B}/feedback`,
      ].sort()
    );
  });
});
