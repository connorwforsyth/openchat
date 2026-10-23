import { describe, expect, it } from "vitest";

import {
  RUNNER_UNAVAILABLE,
  runnerUnavailableError,
  runnerUnavailableOf,
  runnerUnavailableReasonSchema,
} from "./unavailable";

const SHELL_COMMAND = /^(docker|bun) /;

describe("runner unavailable reasons", () => {
  it("gives every reason a message and a command to run", () => {
    for (const reason of runnerUnavailableReasonSchema.options) {
      expect(RUNNER_UNAVAILABLE[reason].message).not.toBe("");
      expect(RUNNER_UNAVAILABLE[reason].command).toMatch(SHELL_COMMAND);
    }
  });

  it("tells the model the reason and the fix in one message", () => {
    expect(runnerUnavailableError("runner_unreachable")).toEqual({
      message:
        "The sandbox runner isn't running. Fix: docker compose --profile sandbox up -d sandbox-runner",
      type: "unavailable",
    });
  });

  it("reads every reason back from its error, also behind a prefix", () => {
    for (const reason of runnerUnavailableReasonSchema.options) {
      const { message } = runnerUnavailableError(reason) as {
        message: string;
      };
      expect(runnerUnavailableOf(message)?.reason).toBe(reason);
      expect(
        runnerUnavailableOf(`The workspace is unavailable: ${message}`)
      ).toEqual({ reason, ...RUNNER_UNAVAILABLE[reason] });
    }
  });

  it("knows nothing about other messages", () => {
    expect(runnerUnavailableOf("the sandbox host couldn't run a command")).toBe(
      null
    );
    expect(runnerUnavailableOf("")).toBe(null);
  });
});
