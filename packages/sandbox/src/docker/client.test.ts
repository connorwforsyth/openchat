import { fixtureId } from "@workspace/contract/fixtures";
import { describe, expect, it } from "vitest";

import { runnerUnavailableError } from "../runner/unavailable";
import { createDockerSandboxFactory } from "./client";

const limits = { cpu: 1, diskMb: 64, memoryMb: 256, network: true };
const id = fixtureId("sandbox", 1);

const factory = (
  fetch: typeof globalThis.fetch,
  { token }: { readonly token?: string } = { token: "secret" }
) =>
  createDockerSandboxFactory({
    egress: { allow: ["registry.npmjs.org"], mode: "allowlist" },
    fetch,
    runnerUrl: "http://runner.test:7070",
    token,
  });

const answer = (status: number, body: unknown) => () =>
  Promise.resolve(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
    })
  );

describe("the docker client's failures", () => {
  it("says the runner isn't configured without a token, and calls nothing", async () => {
    const result = await factory(
      () => Promise.reject(new Error("never called")),
      {}
    ).runnerStatus();
    expect(result).toEqual({
      error: runnerUnavailableError("not_configured"),
      ok: false,
    });
  });

  it("says the runner isn't running when the connection fails", async () => {
    const result = await factory(() =>
      Promise.reject(new TypeError("fetch failed"))
    ).runnerStatus();
    expect(result).toEqual({
      error: runnerUnavailableError("runner_unreachable"),
      ok: false,
    });
  });

  it("says the tokens differ when the runner answers 401", async () => {
    const result = await factory(
      answer(401, { reason: "invalid" })
    ).runnerStatus();
    expect(result).toEqual({
      error: runnerUnavailableError("token_rejected"),
      ok: false,
    });
  });

  it("passes on the runner's own reason", async () => {
    const result = await factory(
      answer(503, { error: runnerUnavailableError("docker_unavailable") })
    ).runnerStatus();
    expect(result).toEqual({
      error: runnerUnavailableError("docker_unavailable"),
      ok: false,
    });
  });

  it("points at the runner's log for an answer it can't read", async () => {
    const result = await factory(answer(502, "Bad Gateway")).runnerStatus();
    expect(result).toEqual({
      error: runnerUnavailableError("runner_error"),
      ok: false,
    });
  });
});

describe("creating a sandbox", () => {
  it("sends the egress policy from config with the request", async () => {
    const bodies: unknown[] = [];
    const created = await factory((_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return answer(200, { id, status: { state: "ready" } })();
    }).create({ conversationId: fixtureId("conversation", 1), id, limits });
    expect(created.ok).toBe(true);
    expect(bodies[0]).toMatchObject({
      egress: { allow: ["registry.npmjs.org"], mode: "allowlist" },
      id,
    });
  });
});
