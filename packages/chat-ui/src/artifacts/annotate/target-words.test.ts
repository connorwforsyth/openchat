import { setupI18n } from "@lingui/core";
import type { AnnotationsData } from "@workspace/ai/messages/annotations";
import { describe, expect, it } from "vitest";

import { notesText } from "./target-words";

const i18n = setupI18n({ locale: "en", messages: { en: {} } });

describe("notesText", () => {
  it("copies sent notes as people wrote them, one line each", () => {
    const note = {
      mark: { shape: "point", x: 0.5, y: 0.5 },
      version: 1,
      versionId: "0192a000-0000-7000-8000-000000000022",
    } as const;
    const data = {
      artifactId: "0192a000-0000-7000-8000-000000000021",
      kind: "spreadsheet",
      notes: [
        {
          ...note,
          note: "Add a ferry row.",
          target: { range: "B2:C3", type: "cells" },
        },
        { ...note, note: "Darker.", target: null },
      ],
      title: "Costs",
    } as unknown as AnnotationsData;
    expect(notesText(data, i18n)).toBe(
      "• Cells B2:C3: Add a ferry row.\n• Darker."
    );
  });
});
