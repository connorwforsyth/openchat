import {
  type ArtifactKind,
  artifactKindSchema,
} from "@workspace/contract/schemas/message-parts";
import { z } from "zod";

// The artifact directive a model writes when the artifacts prompt asks for
// one (PLAN.md D1: adapted from LibreChat's `artifacts.js`), and a strict
// reader for it. The eval scores recorded replies with this; the chat
// runtime's own reader arrives with the artifacts prompt and should agree
// with it on every fixture.
//
//   :::artifact{identifier="counter-button" type="react" title="Counter"}
//   ```tsx
//   export default function Counter() { … }
//   ```
//   :::

export const artifactDirectiveSchema = z.object({
  identifier: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "kebab-case")
    .max(64),
  title: z.string().trim().min(1).max(200),
  type: artifactKindSchema,
});

export interface ParsedArtifact {
  readonly content: string;
  readonly identifier: string;
  readonly kind: ArtifactKind;
  readonly language: string;
  readonly title: string;
}

export interface ParsedReply {
  readonly artifacts: readonly ParsedArtifact[];
  /** Everything wrong with the reply's artifacts; empty when well-formed. */
  readonly problems: readonly string[];
}

const OPEN = /^:::artifact\{(.*)\}\s*$/;
const CLOSE = /^:::\s*$/;
const FENCE = /^```([\w+-]*)\s*$/;
const ATTRIBUTE = /(\w+)="([^"]*)"/g;

/** What an artifact of each kind must look like to render at all. */
const BODY_CHECKS: Readonly<Record<ArtifactKind, RegExp>> = {
  code: /\S/,
  html: /<[a-z!][\s\S]*>/i,
  markdown: /\S/,
  mermaid:
    /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap|timeline)\b/,
  react: /export\s+default\b/,
  // Sites (125) are JSON with their files; the Site kind checks the rest.
  site: /"files"\s*:/,
  svg: /^\s*<svg[\s>][\s\S]*<\/svg>\s*$/,
};

const attributesOf = (raw: string): Record<string, string> =>
  Object.fromEntries(
    [...raw.matchAll(ATTRIBUTE)].map((match) => [match[1], match[2]])
  );

interface Block {
  readonly body: readonly string[];
  readonly header: string;
  readonly line: number;
}

/** Splits a reply into its artifact blocks, noting any left open. */
const blocksOf = (
  lines: readonly string[]
): { blocks: Block[]; problems: string[] } => {
  const blocks: Block[] = [];
  const problems: string[] = [];
  let open: { body: string[]; header: string; line: number } | null = null;
  let inFence = false;
  for (const [index, line] of lines.entries()) {
    if (!open) {
      const header = OPEN.exec(line);
      if (header) {
        open = { body: [], header: header[1] ?? "", line: index + 1 };
      }
      continue;
    }
    if (FENCE.test(line)) {
      inFence = !inFence;
    }
    if (!inFence && CLOSE.test(line)) {
      blocks.push(open);
      open = null;
      continue;
    }
    if (!inFence && OPEN.test(line)) {
      problems.push(`line ${index + 1}: an artifact opens inside another`);
    }
    open.body.push(line);
  }
  if (open) {
    problems.push(`line ${open.line}: artifact is never closed with :::`);
  }
  return { blocks, problems };
};

const parseBlock = (
  block: Block
): { artifact?: ParsedArtifact; problems: string[] } => {
  const where = `line ${block.line}`;
  const directive = artifactDirectiveSchema.safeParse(
    attributesOf(block.header)
  );
  if (!directive.success) {
    return {
      problems: directive.error.issues.map(
        (issue) =>
          `${where}: ${issue.path.join(".") || "directive"} ${issue.message}`
      ),
    };
  }
  const body = block.body.join("\n").trim().split("\n");
  const fence = FENCE.exec(body[0] ?? "");
  if (!(fence && body.length >= 2 && body.at(-1)?.trim() === "```")) {
    return { problems: [`${where}: content must be one fenced code block`] };
  }
  const content = body.slice(1, -1).join("\n");
  const { identifier, title, type: kind } = directive.data;
  if (!BODY_CHECKS[kind].test(content)) {
    return { problems: [`${where}: content isn't a valid ${kind} artifact`] };
  }
  return {
    artifact: { content, identifier, kind, language: fence[1] ?? "", title },
    problems: [],
  };
};

/** Reads every artifact in a model's reply, strictly. Pure. */
export const parseArtifacts = (reply: string): ParsedReply => {
  const { blocks, problems } = blocksOf(reply.split("\n"));
  const artifacts: ParsedArtifact[] = [];
  const all = [...problems];
  for (const block of blocks) {
    const parsed = parseBlock(block);
    all.push(...parsed.problems);
    if (parsed.artifact) {
      if (artifacts.some((a) => a.identifier === parsed.artifact?.identifier)) {
        all.push(
          `line ${block.line}: identifier "${parsed.artifact.identifier}" is used twice`
        );
      }
      artifacts.push(parsed.artifact);
    }
  }
  return { artifacts, problems: all };
};
