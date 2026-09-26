"use client";

import { Trans } from "@lingui/react/macro";
import { CodeView } from "@workspace/code-ui/code-view";
import { DiffView } from "@workspace/code-ui/diff-view";
import { FileTree, type GitStatusEntry } from "@workspace/code-ui/file-tree";
import { CodeUiProvider } from "@workspace/code-ui/provider";
import { applyReview } from "@workspace/code-ui/review/apply";
import type { ProposedEdit } from "@workspace/code-ui/review/patch";
import type { ApprovalDecision } from "@workspace/code-ui/review/review-state";
import { type ReactNode, useCallback, useState } from "react";

// Stand-ins for a sandbox's files and an agent's proposed edit. That's
// content, not UI copy, so it stays out of the Lingui catalog.
const paths = [
  "README.md",
  "package.json",
  "docs/",
  "docs/pricing.md",
  "public/",
  "public/logo.png",
  "src/",
  "src/billing.ts",
  "src/math.ts",
  "src/index.ts",
  "src/legacy.ts",
];

const gitStatus: GitStatusEntry[] = [
  { path: "src/billing.ts", status: "modified" },
  { path: "docs/pricing.md", status: "added" },
  { path: "src/legacy.ts", status: "deleted" },
];

const billing = [
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

const math = [
  "/** Adds up line items. */",
  "export function total(items: readonly number[]): number {",
  "  return items.reduce((sum, item) => sum + item, 0);",
  "}",
  "",
].join("\n");

const edit: ProposedEdit = {
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

const files: Readonly<Record<string, string>> = {
  "src/billing.ts": billing,
  "src/math.ts": math,
};

// The demo accepts renames and moves but has nowhere to write them.
const ignore = () => undefined;

const Section = ({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) => (
  <section className="flex min-w-0 flex-col gap-3">
    <h2 className="font-medium text-muted-foreground text-sm">{title}</h2>
    {children}
  </section>
);

export function CodeDemo() {
  const [openPath, setOpenPath] = useState("src/math.ts");
  const [decision, setDecision] = useState<ApprovalDecision | null>(null);
  const openSelected = useCallback((selected: readonly string[]) => {
    const path = selected.at(-1);
    if (path !== undefined && path in files) {
      setOpenPath(path);
    }
  }, []);

  const applied =
    decision?.decision === "review"
      ? applyReview(billing, edit, decision.hunks)
      : null;

  return (
    <CodeUiProvider>
      <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <Section title={<Trans>File tree</Trans>}>
          <FileTree
            className="h-80"
            gitStatus={gitStatus}
            onMove={ignore}
            onRename={ignore}
            onSelectionChange={openSelected}
            paths={paths}
          />
        </Section>
        <Section title={<Trans>File</Trans>}>
          <CodeView contents={files[openPath] ?? ""} path={openPath} />
        </Section>
      </div>
      <Section title={<Trans>Proposed edit</Trans>}>
        <DiffView edit={edit} onSubmitReview={setDecision} />
      </Section>
      {decision ? (
        <div className="grid gap-8 lg:grid-cols-2">
          <Section title={<Trans>Decision sent to the agent</Trans>}>
            <pre
              className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs"
              data-testid="review-decision"
            >
              {JSON.stringify(decision, null, 2)}
            </pre>
          </Section>
          <Section title={<Trans>File after applying accepted changes</Trans>}>
            {applied?.ok ? (
              <CodeView contents={applied.value} path={edit.path} />
            ) : (
              <p className="text-destructive text-sm">
                <Trans>The accepted changes couldn't be applied.</Trans>
              </p>
            )}
          </Section>
        </div>
      ) : null}
    </CodeUiProvider>
  );
}
