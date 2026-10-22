import { describe, expect, it } from "vitest";

import {
  advanceReply,
  EMPTY_CURSOR,
  MAX_SENTENCE_CHARS,
  settledPrefix,
  speakable,
  takeSentences,
} from "./sentences";

describe("takeSentences", () => {
  it("takes complete sentences and keeps the rest", () => {
    expect(
      takeSentences(
        "Your next run is at nine tomorrow. After that, the weekly digest"
      )
    ).toEqual({
      rest: "After that, the weekly digest",
      sentences: ["Your next run is at nine tomorrow."],
    });
  });

  it("flushes the rest when final", () => {
    expect(takeSentences("All done here", true)).toEqual({
      rest: "",
      sentences: ["All done here"],
    });
  });

  it("joins short pieces so TTS isn't called per word", () => {
    expect(
      takeSentences("Sure. Here's what I found in the logs today. Next")
    ).toEqual({
      rest: "Next",
      sentences: ["Sure. Here's what I found in the logs today."],
    });
  });

  it("doesn't split on abbreviations or decimals", () => {
    const { sentences } = takeSentences(
      "Use a model, e.g. the fast one at version 3.5 for this task. Then"
    );
    expect(sentences).toEqual([
      "Use a model, e.g. the fast one at version 3.5 for this task.",
    ]);
  });

  it("splits on newlines, questions and exclamations", () => {
    expect(
      takeSentences(
        "Is that the report you wanted?\nI can also email it to you! ok",
        false
      ).sentences
    ).toEqual([
      "Is that the report you wanted?",
      "I can also email it to you!",
    ]);
  });

  it("cuts a run-on at a space", () => {
    const words = "word ".repeat(100);
    const { rest, sentences } = takeSentences(words);
    expect(sentences.length).toBeGreaterThan(0);
    expect(sentences[0]?.length).toBeLessThanOrEqual(MAX_SENTENCE_CHARS);
    expect(rest.length).toBeLessThanOrEqual(MAX_SENTENCE_CHARS);
  });
});

describe("speakable", () => {
  it("drops code, link targets and markup", () => {
    expect(
      speakable(
        "## Plan\n- **First**, read [the docs](https://x.dev).\n```ts\nconst a = 1;\n```\nRun `bun dev`."
      ).trim()
    ).toBe("Plan\nFirst, read the docs.\n\nRun bun dev.");
  });

  it("hides an unclosed fence", () => {
    expect(speakable("Here:\n```ts\nconst a")).toBe("Here:\n\n");
  });
});

describe("advanceReply", () => {
  it("hands out each sentence once as the reply streams", () => {
    const reply =
      "I checked your schedule for this week. **Tomorrow** you have the standup at nine. Nothing else.";
    let cursor = EMPTY_CURSOR;
    const spoken: string[] = [];
    for (let end = 1; end <= reply.length; end += 7) {
      const step = advanceReply(cursor, reply.slice(0, end), false);
      ({ cursor } = step);
      spoken.push(...step.sentences);
    }
    const last = advanceReply(cursor, reply, true);
    spoken.push(...last.sentences);
    expect(spoken).toEqual([
      "I checked your schedule for this week.",
      "Tomorrow you have the standup at nine.",
      // The end of the reply is said even when short.
      "Nothing else.",
    ]);
  });

  it("waits for half-written markup to close", () => {
    expect(settledPrefix("Done. Now **bol")).toBe("Done. ");
  });
});
