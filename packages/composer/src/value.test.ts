import { fixtureId, userAda } from "@workspace/contract/fixtures";
import { describe, expect, it } from "vitest";

import { textToDoc } from "./doc";
import { composerValueSchema } from "./schemas";
import { buildComposerValue, hasContent } from "./value";

const templateId = fixtureId("libraryItem", 20);

describe("buildComposerValue", () => {
  it("combines the serialised document, files, skill chips and template", () => {
    const attachment = { file: new File(["x"], "a.txt"), id: "f1" };
    const value = buildComposerValue({
      attachments: [attachment],
      doc: {
        content: [
          {
            content: [
              { text: " hey ", type: "text" },
              {
                attrs: { id: userAda.id, kind: "user", label: "Ada" },
                type: "mention",
              },
              { text: " ", type: "text" },
              {
                attrs: { id: templateId, kind: "skill", label: "Haiku" },
                type: "mention",
              },
              {
                attrs: { id: templateId, kind: "skill", label: "Haiku" },
                type: "mention",
              },
            ],
            type: "paragraph",
          },
        ],
        type: "doc",
      },
      templateId,
    });
    expect(value).toEqual({
      attachments: [attachment],
      mentions: [
        { end: 8, id: userAda.id, kind: "user", label: "Ada", start: 4 },
        { end: 15, id: templateId, kind: "skill", label: "Haiku", start: 9 },
        { end: 21, id: templateId, kind: "skill", label: "Haiku", start: 15 },
      ],
      // Each skill chip once, as the run's `input.skills`.
      skills: [{ id: templateId, name: "Haiku" }],
      templateId,
      text: "hey @Ada @Haiku@Haiku",
    });
    expect(composerValueSchema.parse(value)).toEqual(value);
  });

  it("forgets the template when the text is empty", () => {
    expect(
      buildComposerValue({ attachments: [], doc: textToDoc("  "), templateId })
        .templateId
    ).toBeNull();
  });
});

describe("hasContent", () => {
  it("needs words or a file", () => {
    expect(hasContent({ attachments: [], text: "  " })).toBe(false);
    expect(hasContent({ attachments: [], text: "hi" })).toBe(true);
    expect(hasContent({ attachments: [{}], text: "" })).toBe(true);
  });
});

describe("composerValueSchema", () => {
  it("rejects an attachment that isn't a File", () => {
    expect(
      composerValueSchema.safeParse({
        attachments: [{ file: "a.txt", id: "1" }],
        mentions: [],
        skills: [],
        templateId: null,
        text: "",
      }).success
    ).toBe(false);
  });
});
