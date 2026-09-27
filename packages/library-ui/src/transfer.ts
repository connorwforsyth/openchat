import {
  libraryExportSchema,
  libraryImportInputSchema,
} from "@workspace/contract/schemas/library";
import { err, ok, type Result } from "@workspace/shared/result";
import type { z } from "zod";

// Import and export files (D13). An export is our native JSON; an import is
// that, or a LibreChat agent export, told apart by the `format` field ours
// always carries. Zip bundles (a skill with its files) are a follow-up.

export type ImportDocument = z.infer<
  typeof libraryImportInputSchema
>["document"];

export type ImportFileError = "not_json" | "unrecognised";

/** Reads a dropped or picked file's text into an import document. Pure. */
export const importDocumentFrom = (
  text: string
): Result<ImportDocument, ImportFileError> => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err("not_json");
  }
  const native = libraryExportSchema.safeParse(json);
  if (native.success) {
    return ok(native.data);
  }
  // Anything with a name that isn't ours is offered to the LibreChat importer,
  // which validates it on the server.
  const libreChat = libraryImportInputSchema.safeParse({
    document: { data: json, format: "librechat-agent" },
  });
  const looksLikeAgent =
    typeof json === "object" &&
    json !== null &&
    !("format" in json) &&
    "name" in json;
  return libreChat.success && looksLikeAgent
    ? ok(libreChat.data.document)
    : err("unrecognised");
};

/** A safe file name for an export: the item's name, kebab-cased. */
export const exportFileName = (name: string): string => {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "library-item"}.json`;
};

/** Hands the browser a JSON file to save. */
export const downloadJson = (fileName: string, data: unknown): void => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};
