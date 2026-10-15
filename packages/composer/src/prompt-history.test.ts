import { fixtureId } from "@workspace/contract/fixtures";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import { describe, expect, it } from "vitest";

import {
  type PromptHistoryEntry,
  type PromptHistoryMessage,
  promptHistory,
  stepPromptHistory,
} from "./prompt-history";

const message = (
  n: number,
  role: PromptHistoryMessage["role"],
  ...parts: MessagePart[]
): PromptHistoryMessage => ({ id: fixtureId("message", n), parts, role });

const text = (value: string): MessagePart => ({ text: value, type: "text" });

describe("promptHistory", () => {
  it("lists the user's prompts on the branch, oldest first", () => {
    const entries = promptHistory([
      message(1, "user", text("  first  ")),
      message(2, "assistant", text("an answer")),
      message(3, "user", text("second"), text("more")),
    ]);
    expect(entries).toEqual([
      { id: fixtureId("message", 1), prompt: "first" },
      { id: fixtureId("message", 3), prompt: "second\nmore" },
    ]);
  });

  it("skips files-only messages and ones the app wrote", () => {
    const entries = promptHistory([
      message(1, "user", {
        filename: "a.png",
        mediaType: "image/png",
        source: { kind: "url", url: "https://example.test/a.png" },
        type: "file",
      }),
      message(2, "user", text("Go ahead with the plan: X"), {
        data: {},
        name: "plan-approval",
        type: "data",
      }),
      message(3, "user", text("typed")),
    ]);
    expect(entries.map((entry) => entry.prompt)).toEqual(["typed"]);
  });

  it("keeps one of a prompt sent twice in a row, the newer", () => {
    const entries = promptHistory([
      message(1, "user", text("again")),
      message(2, "user", text("again")),
      message(3, "user", text("other")),
      message(4, "user", text("again")),
    ]);
    expect(entries.map((entry) => entry.id)).toEqual([
      fixtureId("message", 2),
      fixtureId("message", 3),
      fixtureId("message", 4),
    ]);
  });
});

describe("stepPromptHistory", () => {
  const entries: readonly PromptHistoryEntry[] = [
    { id: "a", prompt: "one" },
    { id: "b", prompt: "two" },
    { id: "c", prompt: "three" },
  ];

  it("walks back from an empty composer and stops at the oldest", () => {
    const first = stepPromptHistory({
      current: "",
      direction: "backward",
      entries,
      position: null,
    });
    expect(first?.prompt).toBe("three");
    const second = stepPromptHistory({
      current: "three",
      direction: "backward",
      entries,
      position: first?.position ?? null,
    });
    expect(second?.prompt).toBe("two");
    const third = stepPromptHistory({
      current: "two",
      direction: "backward",
      entries,
      position: second?.position ?? null,
    });
    expect(third?.prompt).toBe("one");
    expect(
      stepPromptHistory({
        current: "one",
        direction: "backward",
        entries,
        position: third?.position ?? null,
      })
    ).toBeNull();
  });

  it("walks forward and, past the newest, back to empty", () => {
    const back = { entryId: "b", recalled: "two" };
    const forward = stepPromptHistory({
      current: "two",
      direction: "forward",
      entries,
      position: back,
    });
    expect(forward).toEqual({
      position: { entryId: "c", recalled: "three" },
      prompt: "three",
    });
    expect(
      stepPromptHistory({
        current: "three",
        direction: "forward",
        entries,
        position: forward?.position ?? null,
      })
    ).toEqual({ position: null, prompt: "" });
  });

  it("leaves the caret alone over typed text, edited recalls and an empty history", () => {
    expect(
      stepPromptHistory({
        current: "typing",
        direction: "backward",
        entries,
        position: null,
      })
    ).toBeNull();
    expect(
      stepPromptHistory({
        current: "two, edited",
        direction: "backward",
        entries,
        position: { entryId: "b", recalled: "two" },
      })
    ).toBeNull();
    expect(
      stepPromptHistory({
        current: "",
        direction: "forward",
        entries,
        position: null,
      })
    ).toBeNull();
    expect(
      stepPromptHistory({
        current: "",
        direction: "backward",
        entries: [],
        position: null,
      })
    ).toBeNull();
  });

  it("finds its place by text when a refetch changed the ids", () => {
    const step = stepPromptHistory({
      current: "two",
      direction: "backward",
      entries,
      position: { entryId: "gone", recalled: "two" },
    });
    expect(step?.prompt).toBe("one");
  });
});
