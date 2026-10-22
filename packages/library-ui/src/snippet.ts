import type { Editor, JSONContent } from "@tiptap/core";
import type { LibraryItemId } from "@workspace/contract/schemas/common";

// The library's snippet editors (agent instructions, prompt templates,
// SKILL.md) edit plain text: one paragraph per line, so what's saved is
// exactly what was typed. Their `/` menu offers snippets to insert, from
// whichever sources the editor passes.

/** Something the `/` menu can insert. */
export type SnippetItem =
  | {
      readonly attached: boolean;
      readonly description: string;
      readonly id: LibraryItemId;
      readonly kind: "skill";
      readonly name: string;
    }
  | {
      readonly id: LibraryItemId;
      readonly kind: "prompt";
      readonly name: string;
    }
  | {
      readonly description?: string;
      readonly kind: "variable";
      readonly name: string;
    }
  | { readonly kind: "new-variable" };

export type SnippetKind = SnippetItem["kind"];

type ItemOf<K extends SnippetKind> = Extract<SnippetItem, { kind: K }>;

/** What one editor's menu offers; a source left out isn't offered. */
export interface SnippetSources {
  readonly newVariable?: boolean;
  readonly prompts?: readonly ItemOf<"prompt">[];
  readonly skills?: readonly ItemOf<"skill">[];
  readonly variables?: readonly ItemOf<"variable">[];
}

/** The name a new variable gets, selected so typing replaces it. */
export const NEW_VARIABLE_NAME = "variable";

/**
 * A template placeholder, as the composer reads one (`@workspace/composer`'s
 * `variables.ts`), so what's highlighted is exactly what becomes a variable.
 */
const OPEN_NAME = /\{\{\s*[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Whether the caret is at the end of a placeholder's name, right before its
 * `}}`: where a new variable leaves it once its name is typed. A name has no
 * spaces, so Space or Tab there means "done", and the caret jumps out.
 */
export const atVariableEnd = (before: string, after: string): boolean =>
  OPEN_NAME.test(before) && after.startsWith("}}");

export const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}/g;

const WORD_BREAK = /[^\p{L}\p{N}]+/u;

const words = (text: string): readonly string[] =>
  text.toLowerCase().split(WORD_BREAK);

/** Whether `query` starts the name or any word in it, ignoring case. */
const matches = (name: string, query: string): boolean => {
  const wanted = query.trim().toLowerCase();
  return (
    wanted === "" ||
    name.toLowerCase().startsWith(wanted) ||
    words(name).some((word) => word.startsWith(wanted))
  );
};

/** What the new-variable entry answers to when typed after `/`. */
const NEW_VARIABLE_WORDS = "new variable";

/** The menu's items for `query`: new variable, variables, skills, then prompts. */
export const snippetMenuItems = (
  query: string,
  sources: SnippetSources
): SnippetItem[] => [
  ...(sources.newVariable && matches(NEW_VARIABLE_WORDS, query)
    ? [{ kind: "new-variable" } as const]
    : []),
  ...(sources.variables ?? []).filter((item) => matches(item.name, query)),
  ...(sources.skills ?? []).filter((item) => matches(item.name, query)),
  ...(sources.prompts ?? []).filter((item) => matches(item.name, query)),
];

/** Plain text as the editor's document: each line a paragraph, blank lines empty ones. */
export const snippetToDoc = (text: string): JSONContent => ({
  content: text
    .split("\n")
    .map((line) =>
      line === ""
        ? { type: "paragraph" }
        : { content: [{ text: line, type: "text" }], type: "paragraph" }
    ),
  type: "doc",
});

/** The editor's document as plain text; `snippetToDoc` reverses it. */
export const snippetText = (editor: Pick<Editor, "getText">): string =>
  editor.getText({ blockSeparator: "\n" });
