import { createHash } from "node:crypto";

import { parseSkillMd } from "@workspace/ai/prompts/skills";
import {
  type CreateSkillInput,
  composeSkillMd,
  type PublishSkillInput,
  type SkillAuthoringOutput,
  type SkillAuthoringPorts,
  type SkillLibrary,
  type SkillRef,
  type SkillTextFile,
  skillLibraryText,
  type UpdateSkillInput,
} from "@workspace/ai/tools/registry/skill-authoring";
import { createSkillAuthoringTools } from "@workspace/ai/tools/registry/skill-tools";
import type {
  LibraryItemId,
  OrgId,
  TeamId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  LibraryItemDetail,
  SkillDefinition,
} from "@workspace/contract/schemas/library";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import { createFile } from "@workspace/db/queries/files";
import { loadPrincipals } from "@workspace/db/queries/teams";
import { organization, user } from "@workspace/db/schema/auth";
import { team } from "@workspace/db/schema/tenancy";
import { newId } from "@workspace/shared/ids";
import { err, ok, type Result } from "@workspace/shared/result";
import type { Tool } from "ai";
import { inArray } from "drizzle-orm";

import type { Storage } from "../ports/storage";
import type { LibraryDeps } from "./core";
import type { LibraryError } from "./errors";
import { createItem, getItem, updateItem } from "./items";
import { publishToLibrary, publishVersion } from "./publishing";

// The skill-authoring tools' port (128): `create_skill`, `update_skill` and
// `publish_skill` run the Library's own handlers as the person, so the
// rules are the Library page's and nothing here decides access:
//
// - create: `createItem`, a personal draft;
// - update: `getItem` on the draft (which takes `edit`), then `updateItem`;
// - publish: `publishVersion` (`edit`, and the target library's publish
//   gate), then, for a team or org library, `publishToLibrary` (`manage`,
//   and membership of that library), as the Publish dialog does.
//
// A refusal comes back as an `error` result in words the model can act on.
// The approval card shows the skill's name and the library from the call's
// input, so publish checks both against what's stored before it changes
// anything: what the person approved is what happens.

/** Where text files a skill bundles are stored: the uploads store (044). */
export interface SkillUploads {
  /** What `file.storage_driver` records. */
  readonly driver: "local" | "s3";
  readonly storage: Storage;
}

export interface SkillAuthoringDeps extends Omit<LibraryDeps, "keys"> {
  /** MCP header secrets aren't a skill's, so the key ring is optional here. */
  readonly keys?: LibraryDeps["keys"];
  /** Without it, a call that writes files is refused; the rest works. */
  readonly uploads?: SkillUploads;
}

/** The library's deps as the handlers take them. */
type Deps = LibraryDeps & Pick<SkillAuthoringDeps, "uploads">;

const NO_KEYS: LibraryDeps["keys"] = err({
  message: "Skills hold no secrets.",
  type: "missing_key",
});

type Output = SkillAuthoringOutput;

const refused = (message: string): Output => ({ message, status: "error" });

/** SKILL.md's cap in the contract (`skillDefinitionSchema`). */
const SKILL_MD_MAX = 200_000;

const MARKDOWN = /\.(?:md|markdown)$/i;

/** A library error as words the model can act on; `what` names the step. */
const explain = (error: LibraryError, what: string): string => {
  switch (error.type) {
    case "not_found":
      return "No skill with that id that the person can see. Use the skillId create_skill returned, or ask the person which skill they mean.";
    case "forbidden":
      return `The person can't ${what} this skill: the library lets them use or view it, not change it. They could ask its owner, or you could create a new skill of their own with create_skill.`;
    case "validation":
      return `The library refused to ${what} it: ${error.issues.map((issue) => issue.message).join(" ")}`;
    case "conflict":
      return `The library refused to ${what} it (${error.reason}).`;
    case "feature_disabled":
      return `Skills can't be changed here: ${error.feature} is turned off.`;
    default:
      return error satisfies never;
  }
};

interface Named {
  readonly id: string;
  readonly isPersonal?: boolean;
  readonly name: string;
}

/** Names of the users, teams and orgs among `principals`, by `type:id`. */
const namesOf = async (
  db: Db,
  principals: readonly Principal[]
): Promise<ReadonlyMap<string, Named>> => {
  const ids = (type: Principal["type"]) =>
    principals.filter((each) => each.type === type).map((each) => each.id);
  const [users, teams, orgs] = await Promise.all([
    ids("user").length > 0
      ? db
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(inArray(user.id, ids("user") as UserId[]))
      : [],
    ids("team").length > 0
      ? db
          .select({ id: team.id, name: team.name })
          .from(team)
          .where(inArray(team.id, ids("team") as TeamId[]))
      : [],
    ids("org").length > 0
      ? db
          .select({
            id: organization.id,
            isPersonal: organization.isPersonal,
            name: organization.name,
          })
          .from(organization)
          .where(inArray(organization.id, ids("org") as OrgId[]))
      : [],
  ]);
  return new Map<string, Named>([
    ...users.map((row) => [`user:${row.id}`, row] as const),
    ...teams.map((row) => [`team:${row.id}`, row] as const),
    ...orgs.map((row) => [`org:${row.id}`, row] as const),
  ]);
};

const libraryOf = async (
  db: Db,
  userId: UserId,
  owner: Principal
): Promise<SkillLibrary> => {
  if (owner.type === "user" && owner.id === userId) {
    return { type: "personal" };
  }
  const name =
    (await namesOf(db, [owner])).get(`${owner.type}:${owner.id}`)?.name ?? "";
  return { id: owner.id, name, type: owner.type };
};

const skillDefinition = (
  detail: LibraryItemDetail
): SkillDefinition | undefined =>
  detail.definition?.kind === "skill" ? detail.definition : undefined;

/** A stored skill as results name it. */
const refOf = async (
  db: Db,
  userId: UserId,
  detail: LibraryItemDetail,
  state: SkillRef["state"]
): Promise<SkillRef> => ({
  description: detail.description,
  files: (skillDefinition(detail)?.files ?? []).map((file) => file.path),
  library: await libraryOf(db, userId, detail.owner),
  name: detail.name,
  skillId: detail.id,
  state,
  version:
    state === "published"
      ? (detail.latestVersionNumber ?? 1)
      : (detail.latestVersionNumber ?? 0) + 1,
});

/** Stores each file as one of the person's uploads, for the skill to bundle. */
const storeFiles = async (
  deps: Deps,
  userId: UserId,
  files: readonly SkillTextFile[]
): Promise<Result<SkillDefinition["files"], string>> => {
  if (files.length === 0) {
    return ok([]);
  }
  const { uploads } = deps;
  if (!uploads) {
    return err(
      "This instance has no file storage, so a skill can't bundle files here. Put what the files would hold in the instructions instead."
    );
  }
  const stored: SkillDefinition["files"] = [];
  for (const file of files) {
    const bytes = new TextEncoder().encode(file.content);
    const name = file.path.split("/").at(-1) || "file";
    const mediaType = MARKDOWN.test(name) ? "text/markdown" : "text/plain";
    // Keys are ours, never the model's path (the Storage port's rule).
    const storageKey = `files/${userId}/${newId("x")}`;
    // biome-ignore lint/performance/noAwaitInLoops: a handful of small files, and the first failure stops the call.
    const put = await uploads.storage.put(storageKey, bytes, {
      contentType: mediaType,
    });
    if (!put.ok) {
      return err("The files couldn't be stored right now. Try again shortly.");
    }
    const row = await createFile(deps.db, {
      mediaType,
      name: name.slice(0, 512),
      ownerId: userId,
      purpose: "skill",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
      storageDriver: uploads.driver,
      storageKey,
    });
    stored.push({ fileId: row.id as never, path: file.path });
  }
  return ok(stored);
};

const duplicatePath = (
  files: readonly { readonly path: string }[]
): string | undefined =>
  files.find(
    (file, index) => files.findIndex((each) => each.path === file.path) < index
  )?.path;

const tooLong = (skillMd: string): Output | undefined =>
  skillMd.length > SKILL_MD_MAX
    ? refused(
        `SKILL.md would be ${skillMd.length} characters; the most a skill holds is ${SKILL_MD_MAX}. Shorten the instructions, or move reference material into files.`
      )
    : undefined;

const create = async (
  deps: Deps,
  userId: UserId,
  input: CreateSkillInput
): Promise<Output> => {
  const files = input.files ?? [];
  const twice = duplicatePath(files);
  if (twice !== undefined) {
    return refused(`Two files have the path ${twice}; give each its own.`);
  }
  const skillMd = composeSkillMd(input);
  const long = tooLong(skillMd);
  if (long) {
    return long;
  }
  const stored = await storeFiles(deps, userId, files);
  if (!stored.ok) {
    return refused(stored.error);
  }
  const created = await createItem(deps, userId, {
    definition: { files: stored.value, kind: "skill", skillMd },
    description: input.description,
    icon: null,
    name: input.name,
  });
  if (!created.ok) {
    return refused(explain(created.error, "create"));
  }
  return {
    skill: await refOf(deps.db, userId, created.value, "draft"),
    skillMd,
    status: "saved",
  };
};

/** The person's editable draft of a skill, or why they can't have it. */
const editableSkill = async (
  deps: Deps,
  userId: UserId,
  id: LibraryItemId,
  what: string
): Promise<
  Result<
    { readonly definition: SkillDefinition; readonly item: LibraryItemDetail },
    string
  >
> => {
  const found = await getItem(deps, userId, { id, revision: "draft" });
  if (!found.ok) {
    return err(explain(found.error, what));
  }
  const definition = skillDefinition(found.value);
  if (found.value.kind !== "skill" || !definition) {
    return err(
      found.value.kind === "skill"
        ? "That skill has no draft to work from. Ask the person to open it in the Library."
        : `That id is a library ${found.value.kind.replace("_", " ")}, not a skill.`
    );
  }
  return ok({ definition, item: found.value });
};

const update = async (
  deps: Deps,
  userId: UserId,
  input: UpdateSkillInput
): Promise<Output> => {
  const current = await editableSkill(deps, userId, input.skillId, "change");
  if (!current.ok) {
    return refused(current.error);
  }
  const { definition, item } = current.value;
  const added = input.files ?? [];
  const removed = input.removeFiles ?? [];
  if (
    input.name === undefined &&
    input.description === undefined &&
    input.instructions === undefined &&
    added.length === 0 &&
    removed.length === 0
  ) {
    return refused(
      "Nothing to change: pass a new name, description, instructions, files or removeFiles."
    );
  }
  const twice = duplicatePath(added);
  if (twice !== undefined) {
    return refused(`Two files have the path ${twice}; give each its own.`);
  }
  const missing = removed.find(
    (path) => !definition.files.some((file) => file.path === path)
  );
  if (missing !== undefined) {
    return refused(
      `The skill has no file at ${missing}. Its files: ${definition.files.map((file) => file.path).join(", ") || "(none)"}.`
    );
  }

  // SKILL.md is written again only when what it holds changes, so a call
  // that only touches files keeps it byte for byte.
  const parsed = parseSkillMd(definition.skillMd);
  const rewrite =
    input.name !== undefined ||
    input.description !== undefined ||
    input.instructions !== undefined;
  const skillMd = rewrite
    ? composeSkillMd({
        description:
          input.description ?? parsed.description ?? item.description,
        instructions: input.instructions ?? parsed.body,
        name: input.name ?? item.name,
      })
    : definition.skillMd;
  const long = tooLong(skillMd);
  if (long) {
    return long;
  }
  const stored = await storeFiles(deps, userId, added);
  if (!stored.ok) {
    return refused(stored.error);
  }
  const replaced = new Set([...removed, ...added.map((file) => file.path)]);
  const files = [
    ...definition.files.filter((file) => !replaced.has(file.path)),
    ...stored.value,
  ];

  const updated = await updateItem(deps, userId, {
    definition: { files, kind: "skill", skillMd },
    ...(input.description === undefined
      ? {}
      : { description: input.description }),
    id: input.skillId,
    ...(input.name === undefined ? {} : { name: input.name }),
  });
  if (!updated.ok) {
    return refused(explain(updated.error, "change"));
  }
  return {
    previousSkillMd: definition.skillMd,
    skill: await refOf(deps.db, userId, updated.value, "draft"),
    skillMd,
    status: "saved",
  };
};

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

interface Target {
  readonly name: string;
  readonly principal: Principal & { readonly type: "team" | "org" };
}

/** The team and org libraries the person is in, with their names (their personal org isn't one). */
const libraryTargets = async (
  db: Db,
  userId: UserId
): Promise<readonly Target[]> => {
  const principals = (await loadPrincipals(db, userId)).filter(
    (each): each is Target["principal"] => each.type !== "user"
  );
  const names = await namesOf(db, principals);
  return principals.flatMap((principal) => {
    const named = names.get(`${principal.type}:${principal.id}`);
    return named && !named.isPersonal ? [{ name: named.name, principal }] : [];
  });
};

const listTargets = (targets: readonly Target[]): string =>
  targets.length === 0
    ? "The person isn't in any team or org library, so it can only be published in their own."
    : `Libraries they can publish to: ${targets.map((each) => `${each.name} (${each.principal.type}, id ${each.principal.id})`).join("; ")}.`;

const article = (type: "team" | "org"): string =>
  type === "org" ? "an org" : "a team";

/** The library a call names, among those the person is in. */
const resolveTarget = (
  targets: readonly Target[],
  wanted: NonNullable<PublishSkillInput["library"]>
): Result<Target, string> => {
  const ofType = targets.filter((each) => each.principal.type === wanted.type);
  if (wanted.id !== undefined) {
    const found = ofType.find((each) => each.principal.id === wanted.id);
    if (!found) {
      return err(
        `The person isn't in ${article(wanted.type)} with that id. ${listTargets(targets)}`
      );
    }
    return sameName(found.name, wanted.name)
      ? ok(found)
      : err(
          `That ${wanted.type} is called "${found.name}". Call again with that name, so the person sees where it goes.`
        );
  }
  const named = ofType.filter((each) => sameName(each.name, wanted.name));
  if (named.length === 1 && named[0]) {
    return ok(named[0]);
  }
  return err(
    named.length === 0
      ? `The person isn't in ${article(wanted.type)} called "${wanted.name}". ${listTargets(targets)}`
      : `More than one ${wanted.type} is called "${wanted.name}"; pass its id as well. ${listTargets(named)}`
  );
};

const sameLibrary = (owner: Principal, target: Principal): boolean =>
  owner.type === target.type && owner.id === target.id;

/**
 * Publishes the draft as the next version. An unchanged draft isn't an
 * error here: that version exists already, so the call goes on from it.
 */
const freeze = async (
  deps: Deps,
  userId: UserId,
  input: PublishSkillInput,
  item: LibraryItemDetail
): Promise<Result<{ readonly unchanged: boolean }, string>> => {
  const published = await publishVersion(deps, userId, {
    id: item.id,
    ...(input.notes ? { notes: input.notes } : {}),
  });
  if (published.ok) {
    return ok({ unchanged: false });
  }
  if (published.error.type === "conflict" && item.latestVersionId !== null) {
    return ok({ unchanged: true });
  }
  return err(explain(published.error, "publish"));
};

/** The draft as the skill's next version, where it already is. */
const publishInPlace = async (
  deps: Deps,
  userId: UserId,
  input: PublishSkillInput,
  item: LibraryItemDetail
): Promise<Output> => {
  const frozen = await freeze(deps, userId, input, item);
  return frozen.ok
    ? await publishedResult(deps, userId, item.id, frozen.value.unchanged)
    : refused(frozen.error);
};

/**
 * The Publish dialog's two steps: the next version, then a copy of it in
 * the library, which owns the copy with the person as a maintainer.
 */
const publishCopy = async (
  deps: Deps,
  userId: UserId,
  input: PublishSkillInput,
  item: LibraryItemDetail,
  target: Target
): Promise<Output> => {
  const frozen = await freeze(deps, userId, input, item);
  if (!frozen.ok) {
    return refused(frozen.error);
  }
  const latest = await getItem(deps, userId, {
    id: item.id,
    revision: "latest",
  });
  const copied = await publishToLibrary(deps, userId, {
    id: item.id,
    target: target.principal,
    ...(latest.ok && latest.value.latestVersionId
      ? { versionId: latest.value.latestVersionId }
      : {}),
  });
  if (!copied.ok) {
    return refused(
      copied.error.type === "forbidden"
        ? `The ${target.name} ${target.principal.type} library already has a copy of this skill that the person doesn't maintain, so they can't publish over it.`
        : explain(copied.error, "publish")
    );
  }
  return {
    skill: await refOf(deps.db, userId, copied.value, "published"),
    status: "published",
    unchanged: frozen.value.unchanged,
  };
};

/** Why a skill outside the person's own library can't go where the call says. */
const notTheirs = async (
  deps: Deps,
  userId: UserId,
  owner: Principal,
  copying: boolean
): Promise<Output> => {
  const library = await libraryOf(deps.db, userId, owner);
  if (copying) {
    return refused(
      `This skill is in ${skillLibraryText(library)}; only a skill in the person's own library can be published to another library.`
    );
  }
  return refused(
    library.type === "team" || library.type === "org"
      ? `This skill is in the ${library.name} ${library.type} library. To publish its next version there, call again with library { type: "${library.type}", name: "${library.name}" }.`
      : `This skill is in ${skillLibraryText(library)}, not the person's own, so publish_skill can't publish it. Its owner can, from the Library.`
  );
};

const publish = async (
  deps: Deps,
  userId: UserId,
  input: PublishSkillInput
): Promise<Output> => {
  const current = await editableSkill(deps, userId, input.skillId, "publish");
  if (!current.ok) {
    return refused(current.error);
  }
  const { item } = current.value;
  if (!sameName(item.name, input.skillName)) {
    return refused(
      `That skill is called "${item.name}". Call publish_skill again with skillName "${item.name}", so the person sees the right name before they approve.`
    );
  }
  const { owner } = item;
  const personal = owner.type === "user" && owner.id === userId;
  if (!input.library) {
    return personal
      ? await publishInPlace(deps, userId, input, item)
      : await notTheirs(deps, userId, owner, false);
  }
  const target = resolveTarget(
    await libraryTargets(deps.db, userId),
    input.library
  );
  if (!target.ok) {
    return refused(target.error);
  }
  if (sameLibrary(owner, target.value.principal)) {
    // A copy already in that library: its next version, in place.
    return await publishInPlace(deps, userId, input, item);
  }
  return personal
    ? await publishCopy(deps, userId, input, item, target.value)
    : await notTheirs(deps, userId, owner, true);
};

const publishedResult = async (
  deps: Deps,
  userId: UserId,
  id: LibraryItemId,
  unchanged: boolean
): Promise<Output> => {
  const latest = await getItem(deps, userId, { id, revision: "latest" });
  if (!latest.ok) {
    return refused(explain(latest.error, "publish"));
  }
  return {
    skill: await refOf(deps.db, userId, latest.value, "published"),
    status: "published",
    unchanged,
  };
};

/**
 * A store that fails underneath (the database, the uploads) is a result
 * the model reads, not a throw: a tool that throws fails the whole run.
 */
const safely = async (work: () => Promise<Output>): Promise<Output> => {
  try {
    return await work();
  } catch {
    return refused(
      "The library couldn't be reached just now. Try again shortly."
    );
  }
};

/** The three tools' port for one person: the Library's handlers, as them. */
export const skillAuthoringPorts = (
  given: SkillAuthoringDeps,
  userId: UserId
): SkillAuthoringPorts => {
  const deps: Deps = { ...given, keys: given.keys ?? NO_KEYS };
  return {
    create: (input) => safely(() => create(deps, userId, input)),
    publish: (input) => safely(() => publish(deps, userId, input)),
    update: (input) => safely(() => update(deps, userId, input)),
  };
};

/**
 * The tools for a run, as its creator: what the turn resolver's
 * `skillAuthoring` takes (`services.ts` binds it).
 */
export const skillAuthoringTools =
  (deps: SkillAuthoringDeps) =>
  (run: { readonly createdBy: UserId }): Readonly<Record<string, Tool>> =>
    createSkillAuthoringTools(skillAuthoringPorts(deps, run.createdBy));
