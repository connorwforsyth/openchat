import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { chunkDocument } from "./chunk";
import { docxHtmlToText, isParseable, parseDocument } from "./parse";

const fixture = async (name: string) =>
  new Uint8Array(
    await readFile(new URL(`./__fixtures__/${name}`, import.meta.url))
  );

const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("parseDocument", () => {
  it("reads a PDF page by page", async () => {
    const parsed = await parseDocument(await fixture("two-pages.pdf"), {
      mediaType: "application/pdf",
      name: "fruit.pdf",
    });
    expect(parsed).toEqual({
      ok: true,
      value: {
        format: "pdf",
        pages: [
          { page: 1, text: "Kumquats ripen in winter." },
          { page: 2, text: "Page two mentions persimmons." },
        ],
      },
    });
  });

  it("reads a DOCX with its headings", async () => {
    const parsed = await parseDocument(await fixture("orchard.docx"), {
      mediaType: DOCX,
      name: "orchard.docx",
    });
    expect(parsed.ok && parsed.value.format).toBe("docx");
    const chunks = parsed.ok ? chunkDocument(parsed.value.pages) : [];
    expect(chunks.map((chunk) => [chunk.headings, chunk.text])).toEqual([
      [
        ["Orchard notes"],
        "Orchard notes\n\nQuinces need a long, warm summer & patience.",
      ],
    ]);
  });

  it("reads text and markdown, and fences code", async () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    expect(
      await parseDocument(encode("# Notes\n\nHello"), {
        mediaType: "text/markdown",
        name: "notes.md",
      })
    ).toEqual({
      ok: true,
      value: {
        format: "text",
        pages: [{ page: null, text: "# Notes\n\nHello" }],
      },
    });
    const code = await parseDocument(encode("# comment\nprint(1)\n"), {
      mediaType: "application/octet-stream",
      name: "script.py",
    });
    expect(code.ok && code.value.pages[0]?.text).toBe(
      "```python\n# comment\nprint(1)\n```"
    );
    // The chunker sees the fence, so the comment isn't a heading.
    expect(
      code.ok && chunkDocument(code.value.pages).map((c) => c.headings)
    ).toEqual([[]]);
  });

  it("says why it can't read a file", async () => {
    expect(
      await parseDocument(new Uint8Array([0xff, 0xfe, 0x00]), {
        mediaType: "text/plain",
        name: "bad.txt",
      })
    ).toMatchObject({ error: { type: "invalid" }, ok: false });
    expect(
      await parseDocument(new TextEncoder().encode("not a pdf"), {
        mediaType: "application/pdf",
        name: "broken.pdf",
      })
    ).toMatchObject({ error: { type: "invalid" }, ok: false });
    expect(
      await parseDocument(new Uint8Array([1, 2, 3]), {
        mediaType: "image/png",
        name: "photo.png",
      })
    ).toEqual({
      error: { mediaType: "image/png", type: "unsupported" },
      ok: false,
    });
  });

  it("decides parseability by type, then extension", () => {
    expect(isParseable("image/png", "photo.png")).toBe(false);
    expect(isParseable("application/octet-stream", "main.rs")).toBe(true);
    expect(isParseable("text/csv; charset=utf-8", "data")).toBe(true);
    expect(isParseable("application/json", "data")).toBe(true);
  });
});

describe("docxHtmlToText", () => {
  it("turns headings, lists and tables into text", () => {
    expect(
      docxHtmlToText(
        "<h2>Plan</h2><ul><li>One &amp; two</li><li>Three</li></ul><table><tr><td>a</td><td>b</td></tr></table>"
      )
    ).toBe("## Plan\n\n- One & two\n- Three\n\na | b |");
  });
});
