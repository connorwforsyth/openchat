import { z } from "zod";

export const SourceFile = z
  .object({
    content: z.string(),
    // Repo-relative, forward slashes, so rules can match on prefixes.
    path: z.string(),
  })
  .readonly();
export type SourceFile = z.infer<typeof SourceFile>;

export const Violation = z
  .object({
    column: z.number().int().positive(),
    line: z.number().int().positive(),
    message: z.string(),
    path: z.string(),
  })
  .readonly();
export type Violation = z.infer<typeof Violation>;

export const formatViolation = (v: Violation): string =>
  `${v.path}:${v.line}:${v.column}  ${v.message}`;

/** 1-based line and column of a character offset, for editor-clickable output. */
export const positionAt = (
  content: string,
  offset: number
): { line: number; column: number } => {
  const before = content.slice(0, offset);
  const line = before.split("\n").length;
  const column = offset - before.lastIndexOf("\n");
  return { column, line };
};
