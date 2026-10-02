import { describe, expect, it } from "vitest";

import { documentToMarkdown, markdownToDocument } from "./markdown";
import { type Document, documentSchema } from "./schema";

const SAMPLE = `# Trip plan

Some **bold**, *italic*, ~~gone~~ and \`code\`, with [a link](https://example.com "Example").

## Packing

- Boots
- Rain jacket
  1. Hood
  2. Zip

To do:

- [ ] Book the ferry
- [x] Pack

> Bring snacks.

\`\`\`ts
const x = 1;
\`\`\`

| Day | Place |
| --- | --- |
| 1 | Harbour |

---

![The harbour](https://example.com/harbour.png)
`;

describe("markdownToDocument", () => {
  const document = markdownToDocument(SAMPLE);

  it("makes a document the schema (and so the editor) accepts", () => {
    expect(documentSchema.safeParse(document).success).toBe(true);
  });

  it("reads headings, marks and links", () => {
    expect(document.content[0]).toEqual({
      attrs: { level: 1 },
      content: [{ text: "Trip plan", type: "text" }],
      type: "heading",
    });
    expect(document.content[1]).toEqual({
      content: [
        { text: "Some ", type: "text" },
        { marks: [{ type: "bold" }], text: "bold", type: "text" },
        { text: ", ", type: "text" },
        { marks: [{ type: "italic" }], text: "italic", type: "text" },
        { text: ", ", type: "text" },
        { marks: [{ type: "strike" }], text: "gone", type: "text" },
        { text: " and ", type: "text" },
        { marks: [{ type: "code" }], text: "code", type: "text" },
        { text: ", with ", type: "text" },
        {
          marks: [
            {
              attrs: { href: "https://example.com", title: "Example" },
              type: "link",
            },
          ],
          text: "a link",
          type: "text",
        },
        { text: ".", type: "text" },
      ],
      type: "paragraph",
    });
  });

  it("reads lists, nested lists and task lists", () => {
    const types = document.content.map((block) => block.type);
    expect(types).toEqual([
      "heading",
      "paragraph",
      "heading",
      "bulletList",
      "paragraph",
      "taskList",
      "blockquote",
      "codeBlock",
      "table",
      "horizontalRule",
      "image",
    ]);
    const [, , , bullets, , tasks] = document.content;
    expect(
      tasks?.type === "taskList" &&
        tasks.content.map((item) => item.attrs?.checked)
    ).toEqual([false, true]);
    expect(
      bullets?.type === "bulletList" &&
        bullets.content[1]?.content.map((block) => block.type)
    ).toEqual(["paragraph", "orderedList"]);
  });

  it("reads tables with a header row", () => {
    const table = document.content.at(8);
    expect(table?.type).toBe("table");
    if (table?.type === "table") {
      expect(table.content[0]?.content.map((cell) => cell.type)).toEqual([
        "tableHeader",
        "tableHeader",
      ]);
      expect(table.content[1]?.content.map((cell) => cell.type)).toEqual([
        "tableCell",
        "tableCell",
      ]);
    }
  });

  it("makes images blocks, and keeps the code's language", () => {
    expect(document.content.at(-1)).toEqual({
      attrs: {
        alt: "The harbour",
        src: "https://example.com/harbour.png",
        title: null,
      },
      type: "image",
    });
    expect(document.content[7]).toEqual({
      attrs: { language: "ts" },
      content: [{ text: "const x = 1;", type: "text" }],
      type: "codeBlock",
    });
  });

  it("drops HTML tags but keeps their text, and reads entities", () => {
    expect(markdownToDocument("<b>Hi</b> &amp; bye").content).toEqual([
      { content: [{ text: "Hi & bye", type: "text" }], type: "paragraph" },
    ]);
  });

  it("gives an empty document one empty paragraph", () => {
    expect(markdownToDocument("").content).toEqual([{ type: "paragraph" }]);
  });
});

describe("documentToMarkdown", () => {
  it("round-trips: Markdown out reads back as the same document", () => {
    const document = markdownToDocument(SAMPLE);
    const again = markdownToDocument(documentToMarkdown(document));
    expect(again).toEqual(document);
  });

  it("escapes text that would otherwise read as Markdown", () => {
    const document: Document = {
      content: [
        {
          content: [
            { text: "- not a list, *not* bold, 1. or [link]", type: "text" },
          ],
          type: "paragraph",
        },
        {
          content: [{ text: "# not a heading", type: "text" }],
          type: "paragraph",
        },
      ],
      type: "doc",
    };
    expect(markdownToDocument(documentToMarkdown(document))).toEqual(document);
  });

  it("keeps two lists in a row apart", () => {
    const document: Document = {
      content: [
        {
          content: [
            {
              content: [
                { content: [{ text: "a", type: "text" }], type: "paragraph" },
              ],
              type: "listItem",
            },
          ],
          type: "bulletList",
        },
        {
          content: [
            {
              content: [
                { content: [{ text: "b", type: "text" }], type: "paragraph" },
              ],
              type: "listItem",
            },
          ],
          type: "bulletList",
        },
      ],
      type: "doc",
    };
    expect(
      markdownToDocument(documentToMarkdown(document)).content
    ).toHaveLength(2);
  });

  it("writes hard breaks, and code with backticks in it", () => {
    const document: Document = {
      content: [
        {
          content: [
            { text: "one", type: "text" },
            { type: "hardBreak" },
            { text: "two", type: "text" },
          ],
          type: "paragraph",
        },
        {
          content: [{ marks: [{ type: "code" }], text: "a`b", type: "text" }],
          type: "paragraph",
        },
      ],
      type: "doc",
    };
    expect(documentToMarkdown(document)).toBe("one\\\ntwo\n\n``a`b``\n");
    expect(markdownToDocument(documentToMarkdown(document))).toEqual(document);
  });

  it("writes nothing for an empty document", () => {
    expect(
      documentToMarkdown({ content: [{ type: "paragraph" }], type: "doc" })
    ).toBe("");
  });
});
