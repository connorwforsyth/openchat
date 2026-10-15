"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  CodeIcon,
  FileIcon,
  LayoutGridIcon,
  PaletteIcon,
  PencilIcon,
  SparklesIcon,
  UploadIcon,
} from "@workspace/icons";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ChangeEvent,
  type ComponentType,
  type ReactNode,
  useCallback,
  useRef,
} from "react";

import type { SkillFields } from "../skill-md";

// Where a new skill starts (170): a blank page, one of a few worked
// examples to edit, or a chat where the model drafts it with you (the
// `create_skill` tool). Picking one only fills the form; nothing is saved
// until Create.

export type SkillStarterId =
  | "blank"
  | "writing_style"
  | "code_review"
  | "data_analysis"
  | "brand_voice";

export interface SkillStarter {
  readonly fields: SkillFields;
  readonly icon: ComponentType<{ readonly className?: string }>;
  readonly id: SkillStarterId;
  readonly label: string;
  readonly summary: string;
}

export const useSkillStarters = (): readonly SkillStarter[] => {
  const { t } = useLingui();
  return [
    {
      fields: { description: "", instructions: "", name: "" },
      icon: FileIcon,
      id: "blank",
      label: t`Blank`,
      summary: t`Start from an empty SKILL.md.`,
    },
    {
      fields: {
        description: t`Writes in my personal style. Use when drafting or editing emails, posts or documents on my behalf.`,
        instructions: t`# Writing style

## Voice
- Plain, direct and warm. Short sentences; one idea each.
- Active voice. Say "we" for the team and "you" for the reader.

## Do
- Lead with the point, then the reason.
- Prefer concrete examples to adjectives.

## Don't
- No filler ("just", "really", "very") and no exclamation marks.
- Don't use jargon without explaining it.

## Before you finish
Read the draft once more and cut anything that doesn't earn its place.
`,
        name: t`Writing style`,
      },
      icon: PencilIcon,
      id: "writing_style",
      label: t`Writing style`,
      summary: t`Make every draft sound like you.`,
    },
    {
      fields: {
        description: t`A checklist for reviewing code changes. Use when asked to review a diff, a pull request or a file.`,
        instructions: t`# Code review checklist

Review the change in this order and report findings grouped by severity
(blocking, should fix, nit). Quote the line you mean.

1. **Correctness**: does it do what it says? Edge cases, errors, nulls.
2. **Security**: input validation, secrets, injection, access checks.
3. **Tests**: is the new behaviour covered? Would a test fail without it?
4. **Readability**: names, comments that say why, dead code.
5. **Performance**: only when it matters at the expected scale.

End with a one-line verdict: approve, approve with changes, or request changes.
`,
        name: t`Code review checklist`,
      },
      icon: CodeIcon,
      id: "code_review",
      label: t`Code review checklist`,
      summary: t`Consistent, prioritised code reviews.`,
    },
    {
      fields: {
        description: t`How to analyse a dataset. Use when the person shares a CSV, spreadsheet or table and asks questions about it.`,
        instructions: t`# Data analysis

1. **Understand the data**: list the columns, their types and the row count.
   Note missing values and anything that looks wrong.
2. **Restate the question** in one sentence before answering it.
3. **Analyse**: start simple (counts, averages, distributions) before
   anything clever. Show the method so it can be checked.
4. **Visualise** when a chart says it faster than a table.
5. **Conclude**: the answer first, then the evidence, then the caveats
   (sample size, missing data, correlation isn't causation).
`,
        name: t`Data analysis`,
      },
      icon: LayoutGridIcon,
      id: "data_analysis",
      label: t`Data analysis`,
      summary: t`A repeatable method for questions about data.`,
    },
    {
      fields: {
        description: t`Our brand's voice and terminology. Use when writing anything customer-facing: marketing copy, product text, support replies.`,
        instructions: t`# Brand voice

## Who we sound like
Confident, helpful and human. An expert friend, never a salesperson.

## Words we use
- Say "customers", not "users".
- Write the product name exactly as it's spelled in the brand guide.

## Words we avoid
- Superlatives we can't prove ("best", "fastest").
- Hype ("revolutionary", "game-changing").

## Format
Sentence case for headings. Oxford comma. Numbers as numerals.
`,
        name: t`Brand voice`,
      },
      icon: PaletteIcon,
      id: "brand_voice",
      label: t`Brand voice`,
      summary: t`Keep customer-facing copy on brand.`,
    },
  ];
};

/** What the model is asked when you create a skill with AI. */
export const useCreateWithAiPrompt = (): string => {
  const { t } = useLingui();
  return t`Help me create a new skill. Interview me one question at a time: what it should do, when it should be used, and an example of good output. Then draft it with create_skill, with a description that says when to use it and short Markdown instructions. Afterwards, tell me I can edit it, try it, or publish it.`;
};

function StarterCard({
  children,
  icon: Icon,
  onSelect,
  selected,
  summary,
}: {
  readonly children: ReactNode;
  readonly icon: SkillStarter["icon"];
  readonly onSelect: () => void;
  readonly selected?: boolean;
  readonly summary: string;
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "flex min-h-11 w-full items-start gap-3 rounded-lg border border-border bg-background p-3 text-start outline-none transition-colors duration-(--motion-fast) hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
        selected && "border-primary bg-muted"
      )}
      onClick={onSelect}
      type="button"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium text-sm">{children}</span>
        <span className="text-muted-foreground text-xs">{summary}</span>
      </span>
    </button>
  );
}

function StarterOption({
  onPick,
  selected,
  starter,
}: {
  readonly onPick: (starter: SkillStarter) => void;
  readonly selected: boolean;
  readonly starter: SkillStarter;
}) {
  const pick = useCallback(() => onPick(starter), [onPick, starter]);
  return (
    <li>
      <StarterCard
        icon={starter.icon}
        onSelect={pick}
        selected={selected}
        summary={starter.summary}
      >
        {starter.label}
      </StarterCard>
    </li>
  );
}

/** Most SKILL.md files are a few KB; this keeps a wrong pick from freezing the page. */
const IMPORT_MAX_BYTES = 200_000;

export interface SkillStarterPickerProps {
  /** Opens a chat where the model drafts the skill; left out, it isn't offered. */
  readonly onCreateWithAi?: () => void;
  /** A SKILL.md the person chose, as text; left out, import isn't offered. */
  readonly onImport?: (skillMd: string) => void;
  readonly onPick: (starter: SkillStarter) => void;
  readonly selected: SkillStarterId | null;
}

/** The starters for a new skill, and "Create with AI". */
export function SkillStarterPicker({
  onCreateWithAi,
  onImport,
  onPick,
  selected,
}: SkillStarterPickerProps) {
  const { t } = useLingui();
  const starters = useSkillStarters();
  const fileRef = useRef<HTMLInputElement>(null);
  const chooseFile = useCallback(() => fileRef.current?.click(), []);
  const readFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      input.value = "";
      if (file && file.size <= IMPORT_MAX_BYTES) {
        onImport?.(await file.text());
      }
    },
    [onImport]
  );
  return (
    <section aria-label={t`Start from`} className="flex flex-col gap-2">
      <h2 className="font-medium text-sm">
        <Trans>Start from</Trans>
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {onCreateWithAi ? (
          <li>
            <StarterCard
              icon={SparklesIcon}
              onSelect={onCreateWithAi}
              summary={t`Describe it in a chat and the AI drafts it for you.`}
            >
              <Trans>Create with AI</Trans>
            </StarterCard>
          </li>
        ) : null}
        {onImport ? (
          <li>
            <StarterCard
              icon={UploadIcon}
              onSelect={chooseFile}
              summary={t`Bring in a skill you already have.`}
            >
              <Trans>Import SKILL.md</Trans>
            </StarterCard>
            <input
              accept=".md,.markdown,text/markdown,text/plain"
              aria-label={t`Choose a SKILL.md file`}
              className="hidden"
              onChange={readFile}
              ref={fileRef}
              type="file"
            />
          </li>
        ) : null}
        {starters.map((starter) => (
          <StarterOption
            key={starter.id}
            onPick={onPick}
            selected={selected === starter.id}
            starter={starter}
          />
        ))}
      </ul>
    </section>
  );
}
