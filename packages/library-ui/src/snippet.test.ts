import { Editor } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { fixtureId } from "@workspace/contract/fixtures";
import { describe, expect, it } from "vitest";

import {
  atVariableEnd,
  type SnippetItem,
  type SnippetSources,
  snippetMenuItems,
  snippetText,
  snippetToDoc,
} from "./snippet";

const roundTrip = (text: string): string => {
  const editor = new Editor({
    content: snippetToDoc(text),
    extensions: [Document, Paragraph, Text],
  });
  const back = snippetText(editor);
  editor.destroy();
  return back;
};

describe("snippet text in the editor", () => {
  it.each([
    "",
    "one line",
    "two\nlines",
    "\nleading blank",
    "trailing blank\n",
    "\n\n\nmany\n\n\n\nblank lines\n\n",
    "\n",
    "  indented\n\ttabbed  ",
    "Explain {{topic}} to {{ audience }}.",
    "---\nname: changelog\ndescription: Writes a changelog.\n---\n\n# Changelog\n",
  ])("comes back exactly as written: %j", (text) => {
    expect(roundTrip(text)).toBe(text);
  });
});

const sources: SnippetSources = {
  newVariable: true,
  prompts: [
    {
      id: fixtureId("libraryItem", 20),
      kind: "prompt",
      name: "Explain a concept",
    },
  ],
  skills: [
    {
      attached: false,
      description: "Writes a changelog entry.",
      id: fixtureId("libraryItem", 30),
      kind: "skill",
      name: "Changelog",
    },
  ],
  variables: [
    { description: "Today's date", kind: "variable", name: "current_date" },
    { kind: "variable", name: "current_user" },
  ],
};

const names = (items: readonly SnippetItem[]) =>
  items.map((item) => (item.kind === "new-variable" ? "+" : item.name));

describe("snippetMenuItems", () => {
  it("offers everything for an empty query, grouped in a fixed order", () => {
    expect(names(snippetMenuItems("", sources))).toEqual([
      "+",
      "current_date",
      "current_user",
      "Changelog",
      "Explain a concept",
    ]);
  });

  it("matches the start of the name or of any word in it, ignoring case", () => {
    expect(names(snippetMenuItems("date", sources))).toEqual(["current_date"]);
    expect(names(snippetMenuItems("CON", sources))).toEqual([
      "Explain a concept",
    ]);
    expect(names(snippetMenuItems("var", sources))).toEqual(["+"]);
    expect(names(snippetMenuItems("ent", sources))).toEqual([]);
  });

  it("offers only the sources an editor passes", () => {
    expect(names(snippetMenuItems("", { prompts: sources.prompts }))).toEqual([
      "Explain a concept",
    ]);
  });
});

describe("atVariableEnd", () => {
  it("is true at the end of a name, before its braces", () => {
    expect(atVariableEnd("Launch of {{product", "}} soon")).toBe(true);
    expect(atVariableEnd("{{ topic", "}}")).toBe(true);
  });

  it("is false anywhere else", () => {
    expect(atVariableEnd("Launch of {{product}}", "")).toBe(false);
    expect(atVariableEnd("Launch of product", "}}")).toBe(false);
    expect(atVariableEnd("{{prod", "uct}}")).toBe(false);
    expect(atVariableEnd("{{", "}}")).toBe(false);
  });
});
