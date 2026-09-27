import type { ConflictReason } from "@workspace/contract/errors";
import type { z } from "zod";

// What the library's shell can refuse with, as values (D8). The router turns
// each into the contract's typed error; nothing below it throws for an
// expected failure.

export interface Issue {
  readonly message: string;
  readonly path: readonly (number | string)[];
}

export type LibraryError =
  | { readonly type: "not_found" }
  | { readonly type: "forbidden" }
  | { readonly issues: readonly Issue[]; readonly type: "validation" }
  | { readonly reason: ConflictReason; readonly type: "conflict" }
  | { readonly feature: string; readonly type: "feature_disabled" };

export const notFound = (): LibraryError => ({ type: "not_found" });
export const forbidden = (): LibraryError => ({ type: "forbidden" });
export const conflict = (reason: ConflictReason): LibraryError => ({
  reason,
  type: "conflict",
});

/** One `VALIDATION` issue at `path`. */
export const invalid = (
  message: string,
  path: readonly (number | string)[] = []
): LibraryError => ({ issues: [{ message, path }], type: "validation" });

/** Turns a zod failure into validation issues (paths prefixed by `at`). */
export const fromZod = (
  error: z.ZodError,
  at: readonly (number | string)[] = []
): LibraryError => ({
  issues: error.issues.map((issue) => ({
    message: issue.message,
    path: [
      ...at,
      ...issue.path.filter(
        (part): part is number | string => typeof part !== "symbol"
      ),
    ],
  })),
  type: "validation",
});
