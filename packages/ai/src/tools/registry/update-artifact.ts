import { builtinArtifactKinds } from "@workspace/artifacts-kit/builtin";
import { DOCUMENT_EDITS } from "@workspace/artifacts-kit/kinds/document/operations";
import { SPREADSHEET_EDITS } from "@workspace/artifacts-kit/kinds/spreadsheet/operations";
import type { ArtifactKindRegistry } from "@workspace/artifacts-kit/registry";
import { artifactIdSchema } from "@workspace/contract/schemas/common";
import { z } from "zod";

import { artifactDirectiveSchema } from "../../../evals/artifacts/format";
import {
  type ArtifactPorts,
  type ArtifactStore,
  type ArtifactToolOutput,
  artifactContentSchema,
  artifactLanguageSchema,
  artifactModelText,
  artifactToolOutputSchema,
  type StoredArtifact,
  saveArtifact,
  storedContent,
} from "../artifact-content";
import { defineTool, type ToolContext } from "./define";

// `update_artifact` (078): the artifact's next version; earlier versions
// are kept. Either the whole content again, or (126) an `edit` of one part
// of a document: a kind's structured operation (`@workspace/artifacts-kit`)
// applied to its latest version, or (166) of a spreadsheet's cells. The content is checked by the artifact's
// kind (123), and nothing is saved if a check fails. What the tools share
// is in `../artifact-content.ts`.

type EditName = keyof typeof DOCUMENT_EDITS | keyof typeof SPREADSHEET_EDITS;

const EDIT_NAMES = [
  ...Object.keys(DOCUMENT_EDITS),
  ...Object.keys(SPREADSHEET_EDITS),
] as [EditName, ...EditName[]];

const spreadsheetCellSchema = z.union([
  z.string().max(10_000),
  z.number(),
  z.boolean(),
  z.null(),
]);

/**
 * One structured edit. A flat object (not a union) so every provider's
 * tool schema can say it; each operation reads the fields it needs and the
 * kit checks them.
 */
export const artifactEditSchema = z
  .object({
    content: z
      .string()
      .max(400_000)
      .optional()
      .describe(
        "Markdown for replace_section and insert: the new section body (start it with a heading to replace the heading too) or the blocks to insert."
      ),
    fmt: z
      .string()
      .max(64)
      .optional()
      .describe(
        'Spreadsheet set_range and set_formula: a number format for the cells, as Excel writes one ("0.00", "#,##0", "0%").'
      ),
    formula: z
      .string()
      .max(2000)
      .optional()
      .describe(
        'Spreadsheet set_formula: the formula, with or without its leading "=".'
      ),
    heading: z
      .string()
      .max(300)
      .optional()
      .describe(
        "The section's heading text, as it reads (without #s). insert without one adds at the end of the document."
      ),
    name: z
      .string()
      .max(64)
      .optional()
      .describe(
        "Spreadsheet add_sheet: the new sheet's name. rename_sheet: the sheet's new name."
      ),
    operation: z
      .enum(EDIT_NAMES)
      .describe(
        "Document: replace_section (the section under a heading, up to the next heading of the same or a higher level), insert (blocks at a section's start or end, or the document's end), delete_section (a heading and its section). Spreadsheet: set_range, set_formula, delete_range, add_sheet, rename_sheet."
      ),
    position: z
      .enum(["section_end", "section_start"])
      .optional()
      .describe("For insert: where in the section. section_end by default."),
    range: z
      .string()
      .max(32)
      .optional()
      .describe(
        'Spreadsheet set_range, set_formula and delete_range: a cell ("B2") or a range ("B2:D5").'
      ),
    sheet: z
      .string()
      .max(64)
      .optional()
      .describe(
        "Spreadsheet: the sheet the edit acts on; the first sheet when left out."
      ),
    values: z
      .array(z.array(spreadsheetCellSchema).max(100))
      .max(10_000)
      .optional()
      .describe(
        'Spreadsheet set_range: rows of cells from the range\'s top-left. Numbers, TRUE/FALSE, text, "=FORMULA", or null to clear.'
      ),
  })
  .describe(
    'For a document (type "document"): change one section; for a spreadsheet (type "spreadsheet"): change some cells or sheets, instead of sending all of it. Leave out content when you send an edit.'
  );

export const updateArtifactInputSchema = z.object({
  artifactId: artifactIdSchema.describe(
    "The artifactId create_artifact returned."
  ),
  content: artifactContentSchema
    .optional()
    .describe(
      "The artifact's complete new content, with no surrounding code fence. Leave out when you send an edit."
    ),
  edit: artifactEditSchema.optional(),
  language: artifactLanguageSchema,
  title: artifactDirectiveSchema.shape.title
    .optional()
    .describe("A new title; leave out to keep the current one."),
});
export type UpdateArtifactInput = z.infer<typeof updateArtifactInputSchema>;

const invalid = (problem: string): ArtifactToolOutput => ({
  problems: [problem],
  status: "invalid",
});

/** The edit as its operation's input: the fields it sent, without `operation`. */
const editInput = ({
  operation: _operation,
  ...fields
}: z.infer<typeof artifactEditSchema>) =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  );

/**
 * The next version's stored text: the whole content (converted for the
 * kind), or the latest version with the edit applied.
 */
const nextContent = async (
  store: ArtifactStore,
  current: StoredArtifact,
  input: UpdateArtifactInput,
  kinds: ArtifactKindRegistry
): Promise<
  | { readonly content: string; readonly ok: true }
  | { readonly ok: false; readonly output: ArtifactToolOutput }
> => {
  if (input.edit === undefined) {
    if (input.content === undefined) {
      return {
        ok: false,
        output: invalid(
          "send either content (the whole artifact) or an edit (one part of a document or spreadsheet)"
        ),
      };
    }
    const stored = storedContent(kinds, current.kind, input.content);
    return "problems" in stored
      ? {
          ok: false,
          output: { problems: [...stored.problems], status: "invalid" },
        }
      : { content: stored.content, ok: true };
  }
  if (input.content !== undefined) {
    return {
      ok: false,
      output: invalid("send content or an edit, not both"),
    };
  }
  let latest: string | null;
  try {
    latest = await store.read(current.artifactId);
  } catch {
    return {
      ok: false,
      output: {
        message: "The artifact couldn't be read right now.",
        status: "unavailable",
      },
    };
  }
  const edited = kinds.edit(
    current.kind,
    latest,
    input.edit.operation,
    editInput(input.edit)
  );
  return edited.ok
    ? { content: edited.value, ok: true }
    : {
        ok: false,
        output: {
          problems: [...edited.error],
          status: "invalid",
        },
      };
};

/** Applies an `update_artifact` call, as the artifact's next version. */
export const updateArtifact = async (
  store: ArtifactStore,
  input: UpdateArtifactInput,
  kinds: ArtifactKindRegistry = builtinArtifactKinds
): Promise<ArtifactToolOutput> => {
  let existing: readonly StoredArtifact[];
  try {
    existing = await store.list();
  } catch {
    return {
      message: "The artifact couldn't be read right now.",
      status: "unavailable",
    };
  }
  const current = existing.find(
    (artifact) => artifact.artifactId === input.artifactId
  );
  if (!current) {
    return { artifacts: [...existing], status: "not_found" };
  }
  const next = await nextContent(store, current, input, kinds);
  if (!next.ok) {
    return next.output;
  }
  return saveArtifact(
    store,
    {
      artifactId: current.artifactId,
      content: next.content,
      kind: current.kind,
      language: input.language ?? null,
      title: input.title ?? current.title,
    },
    kinds
  );
};

export const updateArtifactTool = defineTool({
  // A new version is a change to something the user kept, so it asks first.
  approval: "ask",
  capability: "artifacts",
  description:
    "Save an artifact's next version; earlier versions are kept. Pass the complete new content, not a diff, or, for a document or spreadsheet, an edit of one part.",
  execute: (input, { ports }: ToolContext<{ readonly ports: ArtifactPorts }>) =>
    updateArtifact(ports.store, input, ports.kinds),
  input: updateArtifactInputSchema,
  modelText: artifactModelText,
  name: "update_artifact",
  output: artifactToolOutputSchema,
});
