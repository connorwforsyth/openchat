// Shiki for chat code blocks, in its own chunk (D27): `code-plugin` imports
// this on the first fence, so the composer-first boot never loads it.
//
// It's the Shiki @pierre/diffs already bundles for the code views (D16), not a
// second highlighter, and it colours with the same token-drawn theme.
import { type DiffsHighlighter, getSharedHighlighter } from "@pierre/diffs";
import { codeThemeNames } from "@workspace/code-ui/theme/code-theme";
import { registerCodeThemes } from "@workspace/code-ui/theme/register";
import { err, ok, type Result, tryCatch } from "@workspace/shared/result";

import type { HighlightError, Tokenizer } from "./code-plugin";

type GrammarState = NonNullable<
  ReturnType<DiffsHighlighter["codeToTokens"]>["grammarState"]
>;

// The two schemes share one palette (the tokens flip themselves), so one
// theme's output serves both.
const THEME = codeThemeNames.light;

// Minified one-liners aren't worth colouring; Shiki leaves longer lines plain.
const MAX_LINE_LENGTH = 1000;

const tokenizerOn = (
  highlighter: DiffsHighlighter,
  language: string
): Tokenizer<GrammarState> => ({
  tokenize: (code, state) =>
    tryCatch(
      () => {
        const result = highlighter.codeToTokens(code, {
          grammarState: state,
          lang: language,
          theme: THEME,
          tokenizeMaxLineLength: MAX_LINE_LENGTH,
        });
        return {
          bg: result.bg,
          fg: result.fg,
          rows: result.tokens,
          state: result.grammarState,
        };
      },
      (cause): HighlightError => ({ cause, kind: "tokenize-failed" })
    ),
});

const load = async (
  language: string
): Promise<Result<Tokenizer<GrammarState>, HighlightError>> => {
  registerCodeThemes();
  try {
    const highlighter = await getSharedHighlighter({
      langs: [language],
      // Oniguruma (WASM), not the JS regex engine: a hostile fence can make
      // the JS engine backtrack catastrophically and hang the page. The
      // shared highlighter is created once, by whichever caller is first.
      preferredHighlighter: "shiki-wasm",
      themes: [codeThemeNames.light, codeThemeNames.dark],
    });
    return ok(tokenizerOn(highlighter, language));
  } catch (cause) {
    return err({ cause, kind: "load-failed" });
  }
};

/**
 * The tokeniser for a fence's language; one Shiki can't load (an unknown or
 * made-up name) falls back to plain text.
 */
export async function loadTokenizer(
  language: string
): Promise<Result<Tokenizer<GrammarState>, HighlightError>> {
  const loaded = await load(language);
  return loaded.ok || language === "text" ? loaded : load("text");
}
