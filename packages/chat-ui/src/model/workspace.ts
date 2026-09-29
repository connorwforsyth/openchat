import {
  artifactIdSchema,
  artifactVersionIdSchema,
} from "@workspace/contract/schemas/common";
import type { Message } from "@workspace/contract/schemas/messages";
import { z } from "zod";

import type { WorkspaceSection } from "./layout";

// The Workspace panel (060) as data: what its main area shows, which section
// of the list that belongs to, and a revision that moves whenever the agent
// may have changed the chat's files. Pure, so the panel's behaviour is
// tested without rendering it.

/**
 * What the panel's main area shows. `file` paths are relative to the
 * workspace (`src/a.ts`); an `artifact` without an id is the chat's newest.
 */
export const workspaceSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string().min(1) }),
  z.object({
    artifactId: artifactIdSchema.optional(),
    kind: z.literal("artifact"),
    /** Omitted, the latest version. */
    versionId: artifactVersionIdSchema.optional(),
  }),
  z.object({ kind: z.literal("preview") }),
]);
export type WorkspaceSelection = z.infer<typeof workspaceSelectionSchema>;

/** The list section a selection lives in. */
export const sectionOf = (selection: WorkspaceSelection): WorkspaceSection =>
  selection.kind === "artifact" ? "artifacts" : "files";

/**
 * What the panel shows on `section`: the selection if it belongs there,
 * otherwise that section's default (the newest artifact; the preview if the
 * workspace has one, or nothing).
 */
export const shownSelection = (
  section: WorkspaceSection,
  selection: WorkspaceSelection | null,
  hasPreview: boolean
): WorkspaceSelection | null => {
  if (selection && sectionOf(selection) === section) {
    return selection.kind === "preview" && !hasPreview ? null : selection;
  }
  if (section === "artifacts") {
    return { kind: "artifact" };
  }
  return hasPreview ? { kind: "preview" } : null;
};

/**
 * The agent's workspace tools (`packages/sandbox/src/tools/tools.ts`). Every
 * one may touch the files or the workspace itself: even `read` creates the
 * workspace on first use.
 */
const WORKSPACE_TOOLS: ReadonlySet<string> = new Set([
  "bash",
  "read",
  "write",
  "edit",
  "preview",
]);

/**
 * How many workspace-tool results the branch has settled. It grows while a
 * reply streams, one per finished tool call, so the panel reloads its files
 * as the agent works rather than when the turn ends.
 */
export const workspaceRevision = (
  messages: readonly Pick<Message, "parts">[]
): number => {
  let revision = 0;
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "tool-result" && WORKSPACE_TOOLS.has(part.toolName)) {
        revision += 1;
      }
    }
  }
  return revision;
};

const WORKSPACE_ROOT = /^\/work(?:\/|$)/;
const LEADING = /^(?:\.\/|\/)+/;

/**
 * A path as the tree has it: tools and file cards may say `/work/a.ts`,
 * `./a.ts` or `a.ts`.
 */
export const workspacePath = (path: string): string =>
  path.trim().replace(WORKSPACE_ROOT, "").replace(LEADING, "");
