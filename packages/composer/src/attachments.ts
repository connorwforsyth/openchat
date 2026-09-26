import { err, ok, type Result } from "@workspace/shared/result";

import type { AttachmentLimits, AttachmentRejection } from "./schemas";

// The picker's `accept` attribute is only a hint (paste and drop ignore it),
// so every way in goes through the same check.

export interface AdmittedFiles {
  readonly accepted: readonly File[];
  readonly rejected: readonly AttachmentRejection[];
}

/** The `accept` attribute for the file input. */
export const acceptAttribute = (
  limits: AttachmentLimits
): string | undefined =>
  limits.accept && limits.accept.length > 0
    ? limits.accept.join(",")
    : undefined;

/** Whether a file matches one of the `accept` patterns: a MIME type, `type/*` or `.ext`. */
export const matchesAccept = (
  file: Pick<File, "name" | "type">,
  accept: readonly string[] | undefined
): boolean => {
  if (accept === undefined || accept.length === 0) {
    return true;
  }
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept.some((raw) => {
    const pattern = raw.trim().toLowerCase();
    if (pattern.startsWith(".")) {
      return name.endsWith(pattern);
    }
    if (pattern.endsWith("/*")) {
      return type.startsWith(pattern.slice(0, -1));
    }
    return type === pattern;
  });
};

/** Type and size, for one file. Count depends on the others, so `admitFiles` checks it. */
export const checkAttachment = (
  file: File,
  limits: AttachmentLimits
): Result<File, AttachmentRejection> => {
  if (!matchesAccept(file, limits.accept)) {
    return err({ code: "type", fileName: file.name });
  }
  if (limits.maxFileSize !== undefined && file.size > limits.maxFileSize) {
    return err({
      code: "size",
      fileName: file.name,
      maxFileSize: limits.maxFileSize,
    });
  }
  return ok(file);
};

/**
 * Splits incoming files into those that fit and why the rest don't. Files
 * that pass type and size are taken in order until `maxFiles` is reached.
 */
export const admitFiles = (
  attachedCount: number,
  files: readonly File[],
  limits: AttachmentLimits
): AdmittedFiles => {
  const accepted: File[] = [];
  const rejected: AttachmentRejection[] = [];
  const room =
    limits.maxFiles === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, limits.maxFiles - attachedCount);

  for (const file of files) {
    const checked = checkAttachment(file, limits);
    if (!checked.ok) {
      rejected.push(checked.error);
    } else if (accepted.length >= room) {
      rejected.push({
        code: "count",
        fileName: file.name,
        maxFiles: limits.maxFiles ?? 0,
      });
    } else {
      accepted.push(checked.value);
    }
  }
  return { accepted, rejected };
};

/** Files from a paste or drop. Browsers list non-file items (text, HTML) too. */
export const filesFromTransfer = (
  transfer: Pick<DataTransfer, "items"> | null
): readonly File[] => {
  if (transfer === null) {
    return [];
  }
  const files: File[] = [];
  for (const item of Array.from(transfer.items)) {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file !== null) {
        files.push(file);
      }
    }
  }
  return files;
};
