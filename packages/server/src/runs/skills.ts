import {
  type SkillUse,
  skillsDataPart,
  skillUsesOf,
  withoutSkillsData,
} from "@workspace/ai/messages/skills";
import type { PromptFile } from "@workspace/ai/prompts/codegen";
import {
  LOAD_SKILL_TOOL,
  type LoadedSkill,
  parseSkillMd,
  skillSections,
} from "@workspace/ai/prompts/skills";
import {
  loadSkillTool,
  type SkillPorts,
} from "@workspace/ai/tools/registry/load-skill";
import { toAiSdkTool } from "@workspace/ai/tools/registry/to-ai-sdk";
import type {
  FileId,
  LibraryItemId,
  LibraryVersionId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import type { UserMessagePart } from "@workspace/contract/schemas/message-parts";
import type { PickedSkill } from "@workspace/contract/schemas/runs";
import type { Db } from "@workspace/db/client";
import { getFile } from "@workspace/db/queries/files";
import {
  getVersionedItem,
  resolvePublishedVersion,
} from "@workspace/db/queries/library";
import { listSkillFiles } from "@workspace/db/queries/library-items";
import { getMessage } from "@workspace/db/queries/messages";
import { err, ok, type Result } from "@workspace/shared/result";
import type { Tool, ToolApprovalStatus } from "ai";

import { canUseLibraryItem } from "../library/router";
import type { Storage } from "../ports/storage";

// Skills in chats (127). A skill is picked for one message in the composer
// (`input.skills`), or attached to an agent's version (`definition.skills`).
//
// - Picked: `createRun` checks the sender may use each one (the library's
//   usable rule, as for agents) and that it has a published version, then
//   keeps what it resolved on the user message as a `skills` data part. The
//   turn reads that part back, checks access again (a queued or resumed run
//   starts later, and access can be revoked in between) and puts each
//   skill's `SKILL.md` instructions in the prompt as a section of its own.
// - Attached: the agent's author could use them when they saved the version
//   (`library/definitions.ts`), so they come with the agent, as its MCP
//   servers and knowledge do. The prompt lists them by name and description;
//   the agent loads one with `load_skill`.
//
// `load_skill` reads only those skills, and their bundled files by path,
// never anything else in the library. It never asks: it changes nothing.

/** A skill as the turn holds it: what the model sees, and where its files are. */
export interface TurnSkill extends LoadedSkill {
  readonly fileIds: ReadonlyMap<string, FileId>;
}

/** An upload's bytes, once access to the skill that bundles it is settled. */
export type SkillFileReader = (fileId: FileId) => Promise<Uint8Array | null>;

/**
 * Reads a skill's bundled file from `storage`. The upload belongs to the
 * skill's author, so it isn't checked against the reader as an attachment
 * is: the turn only gets here through a skill it may use (D13: whoever may
 * use a skill may use what it bundles).
 */
export const skillFileReader =
  (db: Db, storage: Storage): SkillFileReader =>
  async (fileId) => {
    const found = await getFile(db, fileId);
    if (!found.ok) {
      return null;
    }
    const object = await storage.get(found.value.storageKey);
    if (!object.ok) {
      return null;
    }
    return new Uint8Array(await new Response(object.value.body).arrayBuffer());
  };

/** Most skills one message may pick; the contract caps it too. */
const MAX_PICKED = 20;

/**
 * A skill's published version (the pinned one, else the latest), as a turn
 * reads it; `undefined` when it isn't a skill or has never been published.
 * Access is the caller's to check.
 */
export const loadSkillVersion = async (
  db: Db,
  id: LibraryItemId,
  versionId?: LibraryVersionId
): Promise<TurnSkill | undefined> => {
  const [item, version] = await Promise.all([
    getVersionedItem(db, "skill", id),
    resolvePublishedVersion(db, "skill", id, versionId),
  ]);
  if (!(item.ok && version.ok)) {
    return;
  }
  const files = await listSkillFiles(db, version.value.id);
  const parsed = parseSkillMd(version.value.definition.skillMd);
  return {
    description: parsed.description ?? item.value.description,
    fileIds: new Map(files.map((file) => [file.path, file.fileId as FileId])),
    files: files.map((file) => file.path),
    id,
    instructions: parsed.body,
    name: item.value.name,
    versionId: version.value.id,
  };
};

const usable = async (
  db: Db,
  userId: UserId,
  use: { readonly id: LibraryItemId; readonly versionId?: LibraryVersionId }
): Promise<TurnSkill | undefined> =>
  (await canUseLibraryItem(db, userId, "skill", use.id))
    ? await loadSkillVersion(db, use.id, use.versionId)
    : undefined;

export interface SkillRefusal {
  /** Which pick, by its place in `input.skills`. */
  readonly index: number;
  readonly message: string;
}

/**
 * The skills picked for a message, each checked and resolved to the
 * version the turn will read, once each in the order picked. The first one
 * the sender can't use (or that was never published) refuses the message,
 * without saying which of the two it was, so ids don't leak.
 */
export const resolvePickedSkills = async (
  db: Db,
  userId: UserId,
  picks: readonly PickedSkill[]
): Promise<Result<readonly SkillUse[], SkillRefusal>> => {
  const uses: SkillUse[] = [];
  for (const [index, pick] of picks.slice(0, MAX_PICKED).entries()) {
    if (uses.some((use) => use.id === pick.id)) {
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: a message picks a handful, and the first refusal stops it.
    const skill = await usable(db, userId, pick);
    if (!skill) {
      return err({
        index,
        message: "No such skill, or you can't use it.",
      });
    }
    uses.push({ id: skill.id, name: skill.name, versionId: skill.versionId });
  }
  return ok(uses);
};

/**
 * The user message's parts as stored: anything the client sent as a
 * `skills` part is dropped, and the server's own record of the picks goes
 * after the rest. Pure.
 */
export const partsWithSkills = (
  parts: readonly UserMessagePart[],
  uses: readonly SkillUse[]
): UserMessagePart[] => [
  ...withoutSkillsData(parts),
  ...(uses.length > 0 ? [skillsDataPart(uses)] : []),
];

/**
 * What a turn may use: the skills its message picked, still usable by the
 * sender, and the agent's own. A pick that's gone (access revoked, the
 * skill deleted) is left out rather than failing the turn.
 */
export const turnSkills = async (
  db: Db,
  run: { readonly createdBy: UserId; readonly userMessageId: string },
  attached: AgentDefinition["skills"] = []
): Promise<{
  readonly attached: readonly TurnSkill[];
  readonly picked: readonly TurnSkill[];
}> => {
  const message = await getMessage(db, run.userMessageId as never);
  const uses = message.ok ? skillUsesOf(message.value.parts) : [];
  const [picked, own] = await Promise.all([
    Promise.all(uses.map((use) => usable(db, run.createdBy, use))),
    Promise.all(
      attached.map((each) => loadSkillVersion(db, each.id, each.versionId))
    ),
  ]);
  const present = (skill: TurnSkill | undefined): skill is TurnSkill =>
    skill !== undefined;
  return { attached: own.filter(present), picked: picked.filter(present) };
};

export interface SkillTurnParts {
  /** For `composeInstructions`' `skills`. */
  readonly sections: readonly PromptFile[];
  readonly toolApproval: Readonly<Record<string, ToolApprovalStatus>>;
  readonly tools: Readonly<Record<string, Tool>>;
}

const NONE: SkillTurnParts = { sections: [], toolApproval: {}, tools: {} };

/**
 * The instructions and the `load_skill` tool for a turn's skills; nothing
 * when it has none. The tool is bound to exactly these skills, and reads a
 * bundled file only through the skill that lists it.
 */
export const skillTurnParts = (
  skills: {
    readonly attached: readonly TurnSkill[];
    readonly picked: readonly TurnSkill[];
  },
  readFile: SkillFileReader | undefined
): SkillTurnParts => {
  const loadable = [...skills.picked];
  for (const skill of skills.attached) {
    if (!loadable.some((each) => each.id === skill.id)) {
      loadable.push(skill);
    }
  }
  if (loadable.length === 0) {
    return NONE;
  }
  const ports: SkillPorts = {
    readFile: (skill, path) => {
      const fileId = loadable
        .find((each) => each.id === skill.id)
        ?.fileIds.get(path);
      return fileId && readFile ? readFile(fileId) : Promise.resolve(null);
    },
    skills: loadable,
  };
  return {
    sections: skillSections(skills),
    toolApproval: { [LOAD_SKILL_TOOL]: "not-applicable" },
    tools: { [LOAD_SKILL_TOOL]: toAiSdkTool(loadSkillTool, { ports }) },
  };
};
