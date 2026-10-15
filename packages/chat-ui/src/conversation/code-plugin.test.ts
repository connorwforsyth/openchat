import { err, type Ok, ok } from "@workspace/shared/result";
import { describe, expect, it, vi } from "vitest";

import {
  CODE_READY_ATTRIBUTE,
  createCodeHighlighter,
  type HighlightResult,
  type Tokenizer,
} from "./code-plugin";

const THEMES = ["light", "dark"] as const;
// ci-guard-ignore tokens: a pattern that asserts no colour literal leaks in.
const HEX_COLOUR = /#[0-9a-f]{3,8}\b/i;

// A fake grammar: each line is one token, and the state counts lines, so a
// resumed pass shows where it resumed from.
const fakeTokenizer = () => {
  const calls: { code: string; state: number | undefined }[] = [];
  const tokenizer: Tokenizer<number> = {
    tokenize: (code, state) => {
      calls.push({ code, state });
      const lines = code.split("\n");
      return ok({
        rows: lines.map((line) => [{ color: "var(--x)", content: line }]),
        state: (state ?? 0) + lines.length,
      });
    },
  };
  return { calls, tokenizer };
};

const ready = (tokenizer: Tokenizer<number>) =>
  createCodeHighlighter({
    loadTokenizer: () => Promise.resolve(ok(tokenizer)),
    themes: THEMES,
    yieldToMain: () => Promise.resolve(),
  });

const text = (result: HighlightResult | null) =>
  result?.tokens.map((row) => row.map((token) => token.content).join(""));

/** Highlights once through the async path, so the tokeniser is loaded. */
const warm = async (
  plugin: ReturnType<typeof ready>,
  code: string,
  language = "ts"
) => {
  const done = new Promise<HighlightResult>((resolve) => {
    plugin.highlight({ code, language, themes: [...THEMES] }, resolve);
  });
  return await done;
};

describe("createCodeHighlighter", () => {
  it("tokenises only the lines a streamed chunk finished", async () => {
    const { calls, tokenizer } = fakeTokenizer();
    const plugin = ready(tokenizer);
    await warm(plugin, "a");
    calls.length = 0;

    const first = plugin.highlight({
      code: "a\nb\nc",
      language: "ts",
      themes: [...THEMES],
    });
    expect(text(first)).toEqual(["a", "b", "c"]);
    // The completed lines without their last newline, then the open line.
    expect(calls).toEqual([
      { code: "a\nb", state: undefined },
      { code: "c", state: 2 },
    ]);

    calls.length = 0;
    const second = plugin.highlight({
      code: "a\nb\nc\nd",
      language: "ts",
      themes: [...THEMES],
    });
    expect(text(second)).toEqual(["a", "b", "c", "d"]);
    expect(calls).toEqual([
      { code: "c", state: 2 },
      { code: "d", state: 3 },
    ]);
  });

  it("marks the first rendered token so the block can show", async () => {
    const { tokenizer } = fakeTokenizer();
    const result = await warm(ready(tokenizer), "\nx");
    expect(result.tokens[0]?.[0]?.htmlAttrs).toBeUndefined();
    expect(result.tokens[1]?.[0]?.htmlAttrs).toEqual({
      [CODE_READY_ATTRIBUTE]: "",
    });
  });

  it("answers a repeated block from cache", async () => {
    const { calls, tokenizer } = fakeTokenizer();
    const plugin = ready(tokenizer);
    const first = await warm(plugin, "x\ny");
    calls.length = 0;
    const again = plugin.highlight({
      code: "x\ny",
      language: "ts",
      themes: [...THEMES],
    });
    expect(again).toBe(first);
    expect(calls).toEqual([]);
  });

  it("keeps finished blocks after newer ones push them out of streaming", async () => {
    const { calls, tokenizer } = fakeTokenizer();
    const plugin = ready(tokenizer);
    const first = await warm(plugin, "first\nblock");
    for (let index = 0; index < 12; index += 1) {
      plugin.highlight({
        code: `other ${index}\nblock`,
        language: "ts",
        themes: [...THEMES],
      });
    }
    calls.length = 0;
    expect(
      plugin.highlight({
        code: "first\nblock",
        language: "ts",
        themes: [...THEMES],
      })
    ).toBe(first);
    expect(calls).toEqual([]);
  });

  it("shows the code uncoloured when the highlighter can't load", async () => {
    const plugin = createCodeHighlighter<number>({
      loadTokenizer: () =>
        Promise.resolve(err({ cause: "offline", kind: "load-failed" })),
      themes: THEMES,
    });
    const result = await warm(plugin, "a\nb");
    expect(text(result)).toEqual(["a", "b"]);
    expect(result.tokens[0]?.[0]?.htmlAttrs).toEqual({
      [CODE_READY_ATTRIBUTE]: "",
    });
  });

  it("delivers queued results in call order", async () => {
    const { tokenizer } = fakeTokenizer();
    let release: (loaded: Ok<Tokenizer<number>>) => void = () => undefined;
    const loading = new Promise<Ok<Tokenizer<number>>>((resolve) => {
      release = resolve;
    });
    const plugin = createCodeHighlighter({
      loadTokenizer: () => loading,
      themes: THEMES,
    });
    const seen: string[] = [];
    const callback = vi.fn((result: HighlightResult) => {
      seen.push(text(result)?.join("|") ?? "");
    });
    expect(
      plugin.highlight(
        { code: "a", language: "ts", themes: [...THEMES] },
        callback
      )
    ).toBeNull();
    expect(
      plugin.highlight(
        { code: "a\nb", language: "ts", themes: [...THEMES] },
        callback
      )
    ).toBeNull();
    release(ok(tokenizer));
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(2));
    expect(seen).toEqual(["a", "a|b"]);
  });

  it("slices a long block and yields between slices", async () => {
    const { calls, tokenizer } = fakeTokenizer();
    const yields = vi.fn(() => Promise.resolve());
    const plugin = createCodeHighlighter({
      loadTokenizer: () => Promise.resolve(ok(tokenizer)),
      themes: THEMES,
      yieldToMain: yields,
    });
    const code = Array.from({ length: 2000 }, (_, index) => `l${index}`).join(
      "\n"
    );
    const result = await warm(plugin, code);
    expect(result.tokens).toHaveLength(2000);
    expect(yields.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(calls.every((call) => call.code.split("\n").length <= 400)).toBe(
      true
    );
  });
});

describe("the Shiki tokeniser", () => {
  // The real chunk: Shiki over Oniguruma WASM, the shared @pierre/diffs
  // highlighter and the token-drawn theme.
  const load = async () => {
    const { loadTokenizer } = await import("./code-highlighter");
    return createCodeHighlighter({
      loadTokenizer,
      themes: ["workspace-code-light", "workspace-code-dark"],
    });
  };

  it("colours a known language with theme tokens", async () => {
    const plugin = await load();
    const result = await new Promise<HighlightResult>((resolve) => {
      plugin.highlight(
        {
          code: "const answer = 42;",
          language: "ts",
          themes: ["workspace-code-light", "workspace-code-dark"],
        },
        resolve
      );
    });
    const colours = result.tokens.flat().map((token) => token.color);
    expect(colours.some((colour) => colour?.includes("var(--chart"))).toBe(
      true
    );
    expect(colours.join(" ")).not.toMatch(HEX_COLOUR);
  });

  it("renders an unknown language as plain text", async () => {
    const plugin = await load();
    const result = await new Promise<HighlightResult>((resolve) => {
      plugin.highlight(
        {
          code: "whatever <this> is",
          language: "not-a-language",
          themes: ["workspace-code-light", "workspace-code-dark"],
        },
        resolve
      );
    });
    expect(text(result)).toEqual(["whatever <this> is"]);
  });

  it("extends a 2,000-line streamed block in a few milliseconds", async () => {
    const plugin = await load();
    const themes: [string, string] = [
      "workspace-code-light",
      "workspace-code-dark",
    ];
    const lines = Array.from(
      { length: 2000 },
      (_, index) => `const value${index} = compute(${index}, "s${index}");`
    );
    const code = lines.join("\n");
    await new Promise<HighlightResult>((resolve) => {
      plugin.highlight({ code, language: "ts", themes }, resolve);
    });

    const started = performance.now();
    const next = plugin.highlight({
      code: `${code}\nconst more = 1;`,
      language: "ts",
      themes,
    });
    const elapsed = performance.now() - started;
    expect(next?.tokens).toHaveLength(2001);
    // One new line, not 2,000: generous for a loaded CI runner.
    expect(elapsed).toBeLessThan(100);
  });
});
