import { describe, expect, it } from "vitest";

import { documentToDocxBuffer } from "./docx";
import { documentPrintPage, documentToHtml, escapeHtml } from "./html";
import { markdownToDocument } from "./markdown";

// Exports (126): Word, built with `docx`, and the print page the browser
// saves as PDF. Markdown out is `documentToMarkdown` (markdown.test.ts).

const document = markdownToDocument(`# Trip

Some **bold** and [a link](https://example.com).

1. One
2. Two

- [x] Packed

| A | B |
| - | - |
| 1 | 2 |

\`\`\`
code <here>
\`\`\`
`);

describe("documentToDocxBuffer", () => {
  it("writes a Word file (a zip with the document part)", async () => {
    const bytes = await documentToDocxBuffer(document, "Trip");
    // A .docx is a zip: it starts "PK".
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain("word/document.xml");
  });

  it("writes every kind of block without failing", async () => {
    const everything = markdownToDocument(
      "> quote\n\n---\n\n![alt](https://example.com/a.png)\n\n- a\n  - b\n\nline  \nbreak"
    );
    await expect(
      documentToDocxBuffer(everything, "All")
    ).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe("documentToHtml", () => {
  it("renders blocks and escapes text", () => {
    const html = documentToHtml(document);
    expect(html).toContain("<h1>Trip</h1>");
    expect(html).toContain(
      '<strong>bold</strong> and <a href="https://example.com">a link</a>'
    );
    expect(html).toContain("<ol><li><p>One</p></li><li><p>Two</p></li></ol>");
    expect(html).toContain('<input type="checkbox" disabled checked>');
    expect(html).toContain("<th><p>A</p></th>");
    expect(html).toContain("<pre><code>code &lt;here&gt;</code></pre>");
  });

  it("leaves out links and images it wouldn't follow", () => {
    const html = documentToHtml({
      content: [
        {
          content: [
            {
              marks: [{ attrs: { href: "javascript:alert(1)" }, type: "link" }],
              text: "click",
              type: "text",
            },
          ],
          type: "paragraph",
        },
        { attrs: { src: "data:image/png;base64,AAAA" }, type: "image" },
      ],
      type: "doc",
    });
    expect(html).toBe("<p>click</p>");
  });

  it("makes a page with the title and a line of details", () => {
    const page = documentPrintPage({
      document,
      meta: "2 October 2026 · Ada",
      title: 'Trip <"plan">',
    });
    expect(page).toContain("<title>Trip &lt;&quot;plan&quot;&gt;</title>");
    expect(page).toContain('<p class="meta">2 October 2026 · Ada</p>');
    expect(page).toContain("@page");
    expect(escapeHtml("a&b")).toBe("a&amp;b");
  });
});
