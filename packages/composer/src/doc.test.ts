import type { JSONContent } from "@tiptap/core";
import { agentItem, userAda } from "@workspace/contract/fixtures";
import { describe, expect, it } from "vitest";

import { serializeDoc, textToDoc, textToInline } from "./doc";

const paragraph = (...content: JSONContent[]): JSONContent => ({
  content,
  type: "paragraph",
});
const text = (value: string, code = false): JSONContent => ({
  text: value,
  type: "text",
  ...(code ? { marks: [{ type: "code" }] } : {}),
});
const mention = (id: string, label: string, kind?: string): JSONContent => ({
  attrs: { id, kind, label, mentionSuggestionChar: "@" },
  type: "mention",
});
const doc = (...content: JSONContent[]): JSONContent => ({
  content,
  type: "doc",
});

describe("serializeDoc", () => {
  it("joins paragraphs and hard breaks with newlines", () => {
    expect(
      serializeDoc(
        doc(
          paragraph(text("one"), { type: "hardBreak" }, text("two")),
          paragraph(),
          paragraph(text("three"))
        )
      )
    ).toEqual({ mentions: [], text: "one\ntwo\n\nthree" });
  });

  it("turns mention nodes into @label tokens with offsets", () => {
    const serialized = serializeDoc(
      doc(
        paragraph(
          text("ask "),
          mention(agentItem.id, "Reviewer", "agent"),
          text(" and "),
          mention(userAda.id, "Ada", "user"),
          text(" ")
        )
      )
    );
    expect(serialized).toEqual({
      mentions: [
        {
          end: 13,
          id: agentItem.id,
          kind: "agent",
          label: "Reviewer",
          start: 4,
        },
        { end: 22, id: userAda.id, kind: "user", label: "Ada", start: 18 },
      ],
      text: "ask @Reviewer and @Ada",
    });
    for (const token of serialized.mentions) {
      expect(serialized.text.slice(token.start, token.end)).toBe(
        `@${token.label}`
      );
    }
  });

  it("shifts offsets past trimmed leading whitespace", () => {
    const { mentions, text: value } = serializeDoc(
      doc(paragraph(), paragraph(text("  "), mention(userAda.id, "Ada")))
    );
    expect(value).toBe("@Ada");
    expect(mentions).toEqual([
      { end: 4, id: userAda.id, kind: "user", label: "Ada", start: 0 },
    ]);
  });

  it("keeps a mention with an unusable id as plain text", () => {
    expect(serializeDoc(doc(paragraph(mention("not-an-id", "Ghost"))))).toEqual(
      {
        mentions: [],
        text: "@Ghost",
      }
    );
  });

  it("turns a file mention into a path token", () => {
    const serialized = serializeDoc(
      doc(paragraph(text("fix "), mention("src/app.ts", "app.ts", "file")))
    );
    expect(serialized).toEqual({
      mentions: [
        {
          end: 11,
          kind: "file",
          label: "app.ts",
          path: "src/app.ts",
          start: 4,
        },
      ],
      text: "fix @app.ts",
    });
  });

  it("keeps inline code's backticks", () => {
    expect(
      serializeDoc(doc(paragraph(text("run "), text("bun test", true)))).text
    ).toBe("run `bun test`");
  });

  it("is empty for an empty document", () => {
    expect(serializeDoc(doc(paragraph()))).toEqual({ mentions: [], text: "" });
    expect(serializeDoc({ type: "doc" })).toEqual({ mentions: [], text: "" });
  });
});

describe("textToInline", () => {
  it("turns newlines into hard breaks, skipping empty text nodes", () => {
    expect(textToInline("a\n\nb")).toEqual([
      text("a"),
      { type: "hardBreak" },
      { type: "hardBreak" },
      text("b"),
    ]);
    expect(textToInline("")).toEqual([]);
  });

  it("round-trips through serializeDoc", () => {
    const value = "Review this ts:\n\nconst a = 1";
    expect(serializeDoc(textToDoc(value)).text).toBe(value);
  });
});

describe("chips beyond people and files", () => {
  it("keep a draft's version, and an artifact chip its kind", () => {
    const versionId = "0199a000-0000-7000-8000-0000000000bb";
    const serialized = serializeDoc(
      doc(
        paragraph(
          {
            attrs: {
              id: agentItem.id,
              kind: "agent",
              label: "Reviewer",
              versionId,
            },
            type: "mention",
          },
          text(" make "),
          {
            attrs: { id: "presentation", kind: "artifact", label: "Slides" },
            type: "mention",
          }
        )
      )
    );
    expect(serialized).toEqual({
      mentions: [
        {
          end: 9,
          id: agentItem.id,
          kind: "agent",
          label: "Reviewer",
          start: 0,
          versionId,
        },
        {
          artifact: "presentation",
          end: 22,
          kind: "artifact",
          label: "Slides",
          start: 15,
        },
      ],
      text: "@Reviewer make @Slides",
    });
  });

  it("stay text when an artifact chip names no kind we know", () => {
    expect(
      serializeDoc(
        doc(
          paragraph({
            attrs: { id: "poster", kind: "artifact", label: "Poster" },
            type: "mention",
          })
        )
      )
    ).toEqual({ mentions: [], text: "@Poster" });
  });
});

describe("prompt variables", () => {
  const variable = (name: string, fallback?: string): JSONContent => ({
    attrs: { fallback: fallback ?? null, name },
    type: "promptVariable",
  });

  it("are sent as their default when left unfilled", () => {
    expect(
      serializeDoc(
        doc(paragraph(text("Tone: "), variable("tone", "warm"), text(".")))
      ).text
    ).toBe("Tone: warm.");
  });

  it("are dropped cleanly, with the space before them, when they have no default", () => {
    const sent = (...content: JSONContent[]) =>
      serializeDoc(doc(paragraph(...content))).text;
    expect(sent(text("Write about "), variable("topic"), text("."))).toBe(
      "Write about."
    );
    expect(sent(text("Write about "), variable("topic"), text(" today"))).toBe(
      "Write about today"
    );
    expect(sent(text("Summarise "), variable("doc"))).toBe("Summarise");
    expect(sent(variable("greeting"), text(" there"))).toBe("there");
    expect(sent(text("a "), variable("x"), text("b"))).toBe("a b");
  });
});
