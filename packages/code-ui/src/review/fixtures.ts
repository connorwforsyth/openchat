import type { ProposedEdit } from "@workspace/contract/schemas/runs";

// A small file and a two-hunk edit to it, shared by the review tests.

export const originalSource = [
  'import { total } from "./math";',
  "",
  "export function price(items: number[]) {",
  "  const sum = total(items);",
  "  return sum;",
  "}",
  "",
  "export function label(value: number) {",
  "  return `$${value}`;",
  "}",
  "",
].join("\n");

export const twoHunkEdit: ProposedEdit = {
  hunks: [
    { hunkId: "h1", newLines: 5, newStart: 3, oldLines: 4, oldStart: 3 },
    { hunkId: "h2", newLines: 3, newStart: 9, oldLines: 3, oldStart: 8 },
  ],
  patch: [
    "@@ -3,4 +3,5 @@",
    " export function price(items: number[]) {",
    "   const sum = total(items);",
    "-  return sum;",
    "+  const tax = sum * 0.2;",
    "+  return sum + tax;",
    " }",
    "@@ -8,3 +9,3 @@",
    " export function label(value: number) {",
    "-  return `$${value}`;",
    "+  return `$${value.toFixed(2)}`;",
    " }",
    "",
  ].join("\n"),
  path: "src/billing.ts",
};
