import { describe, expect, it } from "vitest";

import {
  appendCommand,
  appendError,
  appendExit,
  appendOutput,
  emptyLog,
  MAX_LOG_CHARS,
} from "./log";

const result = {
  durationMs: 12,
  exitCode: 0,
  stderr: "",
  stdout: "hi\n",
  timedOut: false,
  truncated: false,
};

describe("terminal log", () => {
  it("merges consecutive chunks of one stream", () => {
    let log = appendCommand(emptyLog, "echo hi");
    log = appendOutput(log, "stdout", "h");
    log = appendOutput(log, "stdout", "i\n");
    log = appendOutput(log, "stderr", "warn\n");
    log = appendOutput(log, "stdout", "");
    expect(
      log.entries.map((entry) => entry.kind === "output" && entry.text)
    ).toEqual([false, "hi\n", "warn\n"]);
    expect(new Set(log.entries.map((entry) => entry.id)).size).toBe(3);
  });

  it("adds output that wasn't streamed when the command ends", () => {
    const streamed = appendExit(
      appendOutput(emptyLog, "stdout", "hi\n"),
      result,
      {
        stderr: false,
        stdout: true,
      }
    );
    expect(streamed.entries.map((entry) => entry.kind)).toEqual([
      "output",
      "exit",
    ]);
    const unstreamed = appendExit(emptyLog, result, {
      stderr: false,
      stdout: false,
    });
    expect(unstreamed.entries[0]).toMatchObject({
      kind: "output",
      text: "hi\n",
    });
    expect(unstreamed.entries[1]).toMatchObject({ exitCode: 0, kind: "exit" });
  });

  it("drops the oldest entries past the budget", () => {
    let log = appendCommand(emptyLog, "first");
    log = appendOutput(log, "stdout", "x".repeat(MAX_LOG_CHARS));
    log = appendError(log, "boom");
    expect(log.entries.map((entry) => entry.kind)).toEqual(["error"]);
  });
});
