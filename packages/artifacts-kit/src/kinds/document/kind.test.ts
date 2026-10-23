import { describe, expect, it } from "vitest";

import { builtinArtifactKinds } from "../../builtin";
import { isSafeImageUrl } from "./checks";
import { documentKind } from "./kind";
import { markdownToDocument } from "./markdown";
import { documentHeadings, findSection } from "./operations";
import { type Document, serializeDocument } from "./schema";

// The Document kind through the registry, as the server and the tools use
// it: the model's Markdown in, the editor's JSON stored, checks, and the
// structured edits.

const PLAN = `# Plan

## Goal
Ship it.

## Steps
1. Build.
2. Test.

### Notes
Careful.

## Risks
None.
`;

const APPENDED = /None\.\n\n## Owner\n\nAda\.\n$/;

const stored = builtinArtifactKinds.fromModel("document", PLAN);
const read = (text: string): Document => JSON.parse(text) as Document;
const edit = (operation: string, input: unknown, from = stored) =>
  builtinArtifactKinds.edit("document", from, operation, input);

describe("the document kind", () => {
  it("is a built-in kind, edited in the rich-text editor, with instructions", () => {
    expect(builtinArtifactKinds.get("document")).toBe(documentKind);
    expect(documentKind.editor).toBe("rich-text");
    expect(documentKind.render.panel).toBe("document");
    expect(documentKind.export.map((each) => each.extension)).toEqual([
      "md",
      "pdf",
      "docx",
    ]);
    expect(builtinArtifactKinds.instructionFiles()).toContainEqual({
      source: "kinds/document",
      text: documentKind.instructions,
    });
  });

  it("stores the model's Markdown as the editor's JSON, and shows it back as Markdown", () => {
    expect(read(stored)).toEqual(markdownToDocument(PLAN));
    expect(builtinArtifactKinds.check("document", stored)).toEqual([]);
    expect(builtinArtifactKinds.toModel("document", stored)).toContain(
      "## Steps\n\n1. Build.\n2. Test."
    );
  });

  it("takes the editor's JSON from a model that sends it", () => {
    const json = serializeDocument(markdownToDocument("# Hi"));
    expect(builtinArtifactKinds.fromModel("document", json)).toBe(json);
  });

  it("refuses text that isn't a document, and a document of the wrong shape", () => {
    expect(builtinArtifactKinds.check("document", "# Plan")).toEqual([
      "content isn't a document's JSON",
    ]);
    expect(
      builtinArtifactKinds.check(
        "document",
        JSON.stringify({ content: [{ type: "video" }], type: "doc" })
      )
    ).toHaveLength(1);
  });

  it("refuses unsafe links and images", () => {
    const bad = builtinArtifactKinds.fromModel(
      "document",
      "[x](javascript:alert(1)) ![y](http://example.com/a.png) [ok](https://a.b) [mail](mailto:a@b.c) [here](/artifacts/1)"
    );
    expect(builtinArtifactKinds.check("document", bad)).toEqual([
      'the link to "javascript:alert(1)" isn\'t allowed: links go to http(s), mailto or a path in this app',
      'the image "http://example.com/a.png" isn\'t allowed: images load over https or from this app',
    ]);
  });

  it("tells an editor whether an image address may load", () => {
    expect(isSafeImageUrl("https://example.com/a.png")).toBe(true);
    expect(isSafeImageUrl(" /api/files/1 ")).toBe(true);
    expect(isSafeImageUrl("http://example.com/a.png")).toBe(false);
    expect(isSafeImageUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeImageUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isSafeImageUrl("//evil.example/a.png")).toBe(false);
  });

  it("caps a document's size", () => {
    const huge = serializeDocument({
      content: [
        {
          content: [{ text: "x".repeat(1_000_001), type: "text" }],
          type: "paragraph",
        },
      ],
      type: "doc",
    });
    expect(builtinArtifactKinds.check("document", huge)).toEqual([
      "content is longer than 1000000 characters",
    ]);
  });
});

describe("sections", () => {
  const document = read(stored);

  it("lists the headings, and finds a section up to the next heading at its level or above", () => {
    expect(documentHeadings(document)).toEqual([
      "Plan",
      "Goal",
      "Steps",
      "Notes",
      "Risks",
    ]);
    const steps = findSection(document, "steps");
    expect(steps).toEqual({ end: 7, level: 2, start: 3 });
    expect(findSection(document, "## Notes")).toEqual({
      end: 7,
      level: 3,
      start: 5,
    });
    expect(findSection(document, "Plan")).toEqual({
      end: 9,
      level: 1,
      start: 0,
    });
    expect(findSection(document, "Missing")).toBeNull();
  });
});

describe("structured edits", () => {
  const markdownOf = (result: ReturnType<typeof edit>) =>
    result.ok ? builtinArtifactKinds.toModel("document", result.value) : "";

  it("replace_section keeps the heading and replaces the body", () => {
    const result = edit("replace_section", {
      content: "1. Build.\n2. Test.\n3. Ship.",
      heading: "Steps",
    });
    expect(result.ok).toBe(true);
    expect(markdownOf(result)).toBe(
      "# Plan\n\n## Goal\n\nShip it.\n\n## Steps\n\n1. Build.\n2. Test.\n3. Ship.\n\n## Risks\n\nNone.\n"
    );
  });

  it("replace_section replaces the heading too when the Markdown starts with one", () => {
    const result = edit("replace_section", {
      content: "## Dangers\nFloods.",
      heading: "risks",
    });
    expect(markdownOf(result)).toContain("## Dangers\n\nFloods.\n");
    expect(markdownOf(result)).not.toContain("Risks");
  });

  it("insert adds blocks at a section's start or end, or the document's end", () => {
    expect(
      markdownOf(
        edit("insert", {
          content: "First.",
          heading: "Goal",
          position: "section_start",
        })
      )
    ).toContain("## Goal\n\nFirst.\n\nShip it.");
    expect(
      markdownOf(edit("insert", { content: "Also.", heading: "Goal" }))
    ).toContain("Ship it.\n\nAlso.\n\n## Steps");
    expect(markdownOf(edit("insert", { content: "## Owner\nAda." }))).toMatch(
      APPENDED
    );
  });

  it("insert into an empty document replaces its blank paragraph", () => {
    const empty = serializeDocument({
      content: [{ type: "paragraph" }],
      type: "doc",
    });
    expect(markdownOf(edit("insert", { content: "Hello." }, empty))).toBe(
      "Hello.\n"
    );
  });

  it("delete_section takes the heading and everything under it", () => {
    expect(markdownOf(edit("delete_section", { heading: "Steps" }))).toBe(
      "# Plan\n\n## Goal\n\nShip it.\n\n## Risks\n\nNone.\n"
    );
  });

  it("replace is the whole document again", () => {
    expect(markdownOf(edit("replace", { content: "# New" }))).toBe("# New\n");
  });

  it("says which headings there are when one isn't found", () => {
    expect(
      edit("replace_section", { content: "x", heading: "Budget" })
    ).toEqual({
      error: [
        'there\'s no section headed "Budget". Its headings: "Plan", "Goal", "Steps", "Notes", "Risks"',
      ],
      ok: false,
    });
  });

  it("refuses an edit it doesn't have, and input that doesn't fit", () => {
    const unknown = edit("rename", {});
    expect(unknown.ok).toBe(false);
    expect(unknown.ok ? [] : unknown.error[0]).toContain(
      'has no "rename" edit'
    );
    const bad = edit("insert", { content: "" });
    expect(bad.ok).toBe(false);
  });

  it("refuses to edit a stored version that isn't a document", () => {
    expect(edit("insert", { content: "x" }, "not json").ok).toBe(false);
  });
});
