import { call } from "@orpc/server";
import type {
  SkillAuthoringOutput,
  SkillAuthoringPorts,
} from "@workspace/ai/tools/registry/skill-authoring";
import { authRouter } from "@workspace/auth/handlers";
import {
  type HandlerContext,
  resolveSession,
} from "@workspace/auth/handlers/context";
import {
  createTestAuth,
  type SignedIn,
  signUp,
  type TestAuth,
} from "@workspace/auth/testing";
import type {
  LibraryItemId,
  OrgId,
  TeamId,
} from "@workspace/contract/schemas/common";
import { getFile } from "@workspace/db/queries/files";
import { keyRingOf } from "@workspace/mcp/crypto";
import { ok } from "@workspace/shared/result";
import { afterEach, describe, expect, it } from "vitest";

import type { RequestContext } from "../context";
import type { Storage } from "../ports/storage";
import { createMemoryStorage } from "../ports/storage.memory";
import { createLibraryRouter } from "./router";
import { skillAuthoringPorts } from "./skill-authoring";

// The skill-authoring tools' port (128) over PGlite, with real users, orgs
// and teams: each call goes through the Library's own handlers as the
// person, so what the Library page allows, the tools allow, and every
// refusal is a result the model can read.

let current: TestAuth | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

const KEY = Buffer.alloc(32, 7);

const setup = async ({ uploads = true } = {}) => {
  current = await createTestAuth();
  const t = current;
  const storage = createMemoryStorage();
  const deps = {
    db: t.db,
    keys: ok(keyRingOf(KEY)),
    ...(uploads ? { uploads: { driver: "local" as const, storage } } : {}),
  };
  const router = createLibraryRouter(deps);
  const tools = (who: SignedIn): SkillAuthoringPorts =>
    skillAuthoringPorts(deps, who.userId);
  return { router, storage, t, tools };
};

type Router = Awaited<ReturnType<typeof setup>>["router"];

const authContext = async (
  t: TestAuth,
  who: SignedIn
): Promise<HandlerContext> => ({
  appUrl: "https://chat.example.test",
  auth: t.auth,
  config: t.config,
  db: t.db,
  headers: who.headers,
  session: await resolveSession(t.auth, who.headers),
});

const as = (who: SignedIn): { context: RequestContext } => ({
  context: {
    request: new Request("https://chat.example.test/api/library"),
    session: { userId: who.userId },
  },
});

/** Acme with Eng › Platform; A in Eng, B in Platform, C in Globex instead. */
const acme = async (t: TestAuth) => {
  const admin = await signUp(t.auth, "admin@example.test");
  const adminCtx = await authContext(t, admin);
  const org = await call(
    authRouter.orgs.create,
    { name: "Acme", slug: "acme" },
    { context: adminCtx }
  );
  const eng = await call(
    authRouter.teams.create,
    { name: "Eng", orgId: org.id, parentId: null },
    { context: adminCtx }
  );
  const platform = await call(
    authRouter.teams.create,
    { name: "Platform", orgId: org.id, parentId: eng.id },
    { context: adminCtx }
  );
  const globex = await call(
    authRouter.orgs.create,
    { name: "Globex", slug: "globex" },
    { context: adminCtx }
  );
  const join = async (
    email: string,
    teamIds: TeamId[],
    orgId: OrgId = org.id as OrgId
  ) => {
    const invitation = await call(
      authRouter.orgs.invite,
      { email, orgId, role: "member", teamIds },
      { context: adminCtx }
    );
    const who = await signUp(t.auth, email);
    await call(
      authRouter.orgs.acceptInvitation,
      { token: invitation.token ?? "" },
      { context: await authContext(t, who) }
    );
    return who;
  };
  const a = await join("a@example.test", [eng.id]);
  const b = await join("b@example.test", [platform.id]);
  const c = await join("c@example.test", [], globex.id as OrgId);
  return { a, b, c, eng, org, platform };
};

const grant = async (
  t: TestAuth,
  owner: SignedIn,
  to: SignedIn,
  id: LibraryItemId,
  permission: "use" | "view" | "edit"
) =>
  await call(
    authRouter.grants.create,
    {
      permission,
      principal: { id: to.userId, type: "user" },
      resourceId: id,
      resourceType: "skill",
    },
    { context: await authContext(t, owner) }
  );

const saved = (output: SkillAuthoringOutput) => {
  if (output.status !== "saved") {
    throw new Error(`expected saved, got ${JSON.stringify(output)}`);
  }
  return output;
};

const published = (output: SkillAuthoringOutput) => {
  if (output.status !== "published") {
    throw new Error(`expected published, got ${JSON.stringify(output)}`);
  }
  return output;
};

const errorOf = (output: SkillAuthoringOutput): string => {
  if (output.status !== "error") {
    throw new Error(`expected an error, got ${JSON.stringify(output)}`);
  }
  return output.message;
};

const notes = {
  description: "Writes release notes from a list of changes.",
  instructions: "Group changes by area. Lead with what users notice.",
  name: "Release notes",
};

const readText = async (storage: Storage, t: TestAuth, fileId: string) => {
  const file = await getFile(t.db, fileId as never);
  if (!file.ok) {
    return null;
  }
  const object = await storage.get(file.value.storageKey as never);
  return object.ok ? await new Response(object.value.body).text() : null;
};

const mine = async (router: Router, who: SignedIn) =>
  (await call(router.library.list, { limit: 50, tab: "mine" }, as(who))).items;

describe("create_skill", () => {
  it("makes a personal draft with SKILL.md in the Agent Skills format and its files", async () => {
    const { router, storage, t, tools } = await setup();
    const { a } = await acme(t);
    const result = saved(
      await tools(a).create({
        ...notes,
        files: [{ content: "## Added\n", path: "templates/notes.md" }],
      })
    );
    expect(result.skill).toMatchObject({
      description: notes.description,
      files: ["templates/notes.md"],
      library: { type: "personal" },
      name: "Release notes",
      state: "draft",
      version: 1,
    });
    expect(result.skillMd).toBe(
      "---\nname: Release notes\ndescription: Writes release notes from a list of changes.\n---\n\nGroup changes by area. Lead with what users notice.\n"
    );
    expect(result.previousSkillMd).toBeUndefined();

    const draft = await call(
      router.library.get,
      { id: result.skill.skillId, revision: "draft" },
      as(a)
    );
    expect(draft).toMatchObject({
      kind: "skill",
      latestVersionId: null,
      owner: { id: a.userId, type: "user" },
    });
    expect(draft.definition).toMatchObject({ skillMd: result.skillMd });
    const [file] =
      draft.definition?.kind === "skill" ? draft.definition.files : [];
    expect(file?.path).toBe("templates/notes.md");
    expect(await readText(storage, t, file?.fileId ?? "")).toBe("## Added\n");
    // Nobody else sees a draft.
    expect(await mine(router, a)).toHaveLength(1);
  });

  it("quotes a description YAML would misread, and drops frontmatter the model wrote", async () => {
    const { t, tools } = await setup();
    const { a } = await acme(t);
    const result = saved(
      await tools(a).create({
        description: "Use when: the PR is big",
        instructions: "---\nname: other\n---\nBe brief.",
        name: "Reviewer",
      })
    );
    expect(result.skillMd).toBe(
      '---\nname: Reviewer\ndescription: "Use when: the PR is big"\n---\n\nBe brief.\n'
    );
  });

  it("refuses files without storage, or two at one path, and saves nothing", async () => {
    const { router, t, tools } = await setup({ uploads: false });
    const { a } = await acme(t);
    expect(
      errorOf(
        await tools(a).create({
          ...notes,
          files: [{ content: "x", path: "a.md" }],
        })
      )
    ).toContain("can't bundle files here");
    expect(
      errorOf(
        await tools(a).create({
          ...notes,
          files: [
            { content: "x", path: "a.md" },
            { content: "y", path: "a.md" },
          ],
        })
      )
    ).toContain("Two files have the path a.md");
    expect(await mine(router, a)).toEqual([]);
    // Without files it still works.
    saved(await tools(a).create(notes));
  });
});

describe("update_skill", () => {
  it("saves the owner's draft again, with the SKILL.md before and after, and merges files", async () => {
    const { router, t, tools } = await setup();
    const { a } = await acme(t);
    const created = saved(
      await tools(a).create({
        ...notes,
        files: [
          { content: "old", path: "templates/notes.md" },
          { content: "keep", path: "examples/one.md" },
          { content: "bye", path: "scratch.txt" },
        ],
      })
    );
    const id = created.skill.skillId;
    const updated = saved(
      await tools(a).update({
        files: [{ content: "new", path: "templates/notes.md" }],
        instructions: "Group changes by area. Link each PR.",
        removeFiles: ["scratch.txt"],
        skillId: id,
      })
    );
    expect(updated.previousSkillMd).toBe(created.skillMd);
    expect(updated.skillMd).toContain("Link each PR.");
    expect(updated.skillMd).toContain("name: Release notes");
    expect(updated.skill).toMatchObject({
      files: ["examples/one.md", "templates/notes.md"],
      state: "draft",
      version: 1,
    });

    // A rename changes the item and the frontmatter; files alone leave SKILL.md as it was.
    const renamed = saved(
      await tools(a).update({ name: "Changelog", skillId: id })
    );
    expect(renamed.skill.name).toBe("Changelog");
    expect(renamed.skillMd).toContain("name: Changelog\n");
    const filesOnly = saved(
      await tools(a).update({
        files: [{ content: "two", path: "examples/two.md" }],
        skillId: id,
      })
    );
    expect(filesOnly.skillMd).toBe(renamed.skillMd);
    const [item] = await mine(router, a);
    expect(item?.name).toBe("Changelog");
  });

  it("refuses a skill the person can only use or view, someone else's, a non-skill, and an empty change", async () => {
    const { router, t, tools } = await setup();
    const { a, b, c } = await acme(t);
    const id = saved(await tools(a).create(notes)).skill.skillId;
    await call(router.library.publishVersion, { id }, as(a));

    expect(errorOf(await tools(c).update({ name: "Mine", skillId: id }))).toBe(
      "No skill with that id that the person can see. Use the skillId create_skill returned, or ask the person which skill they mean."
    );
    await grant(t, a, b, id, "view");
    expect(
      errorOf(await tools(b).update({ name: "Mine", skillId: id }))
    ).toContain("can't change this skill");
    expect(
      errorOf(
        await tools(b).publish({ skillId: id, skillName: "Release notes" })
      )
    ).toContain("can't publish this skill");

    const prompt = await call(
      router.library.create,
      { definition: { kind: "prompt", template: "Hi" }, name: "Hello" },
      as(a)
    );
    expect(
      errorOf(await tools(a).update({ name: "x", skillId: prompt.id }))
    ).toBe("That id is a library prompt, not a skill.");
    expect(errorOf(await tools(a).update({ skillId: id }))).toContain(
      "Nothing to change"
    );
    expect(
      errorOf(await tools(a).update({ removeFiles: ["nope.md"], skillId: id }))
    ).toBe("The skill has no file at nope.md. Its files: (none).");
    // Nothing changed for anyone.
    const items = await mine(router, a);
    expect(items.find((item) => item.id === id)?.name).toBe("Release notes");
  });

  it("lets an editor change someone's draft, but not publish it", async () => {
    const { t, tools } = await setup();
    const { a, b, eng } = await acme(t);
    const id = saved(await tools(a).create(notes)).skill.skillId;
    await grant(t, a, b, id, "edit");
    const edited = saved(
      await tools(b).update({ instructions: "Shorter.", skillId: id })
    );
    expect(edited.skill.library).toEqual({
      id: a.userId,
      name: expect.any(String),
      type: "user",
    });
    expect(
      errorOf(
        await tools(b).publish({ skillId: id, skillName: "Release notes" })
      )
    ).toContain("not the person's own, so publish_skill can't publish it");
    expect(
      errorOf(
        await tools(b).publish({
          library: { name: "Platform", type: "team" },
          skillId: id,
          skillName: "Release notes",
        })
      )
    ).toContain("only a skill in the person's own library");
    expect(eng.id).toBeTruthy();
  });
});

describe("publish_skill", () => {
  it("publishes the draft as v1 in the person's library, then says when nothing changed", async () => {
    const { router, t, tools } = await setup();
    const { a } = await acme(t);
    const id = saved(await tools(a).create(notes)).skill.skillId;
    const first = published(
      await tools(a).publish({
        notes: "First cut",
        skillId: id,
        skillName: "release NOTES",
      })
    );
    expect(first).toMatchObject({
      skill: { library: { type: "personal" }, state: "published", version: 1 },
      unchanged: false,
    });
    const versions = await call(
      router.library.listVersions,
      { id, limit: 10 },
      as(a)
    );
    expect(versions.items[0]).toMatchObject({ notes: "First cut", number: 1 });

    const again = published(
      await tools(a).publish({ skillId: id, skillName: "Release notes" })
    );
    expect(again).toMatchObject({ skill: { version: 1 }, unchanged: true });

    saved(await tools(a).update({ instructions: "v2", skillId: id }));
    const second = published(
      await tools(a).publish({ skillId: id, skillName: "Release notes" })
    );
    expect(second.skill.version).toBe(2);
  });

  it("refuses a name that isn't the skill's, before publishing anything", async () => {
    const { router, t, tools } = await setup();
    const { a } = await acme(t);
    const id = saved(await tools(a).create(notes)).skill.skillId;
    expect(
      errorOf(await tools(a).publish({ skillId: id, skillName: "Something" }))
    ).toBe(
      'That skill is called "Release notes". Call publish_skill again with skillName "Release notes", so the person sees the right name before they approve.'
    );
    const [item] = await mine(router, a);
    expect(item?.latestVersionId).toBeNull();
  });

  it("publishes a copy to a team the person is in, which its members can then use", async () => {
    const { router, t, tools } = await setup();
    const { a, b, eng } = await acme(t);
    const id = saved(await tools(a).create(notes)).skill.skillId;
    const result = published(
      await tools(a).publish({
        library: { name: "eng", type: "team" },
        skillId: id,
        skillName: "Release notes",
      })
    );
    expect(result.skill).toMatchObject({
      library: { id: eng.id, name: "Eng", type: "team" },
      name: "Release notes",
      state: "published",
      version: 1,
    });
    expect(result.skill.skillId).not.toBe(id);
    // The person's own skill got its version too, as the Publish dialog does.
    const [own] = await mine(router, a);
    expect(own?.latestVersionNumber).toBe(1);

    const listed = await call(
      router.library.list,
      { kind: "skill", limit: 50, tab: "libraries" },
      as(b)
    );
    expect(listed.items.map((item) => [item.id, item.myAccess])).toEqual([
      [result.skill.skillId, "use"],
    ]);

    // The copy's next version goes in place, named by its library; without
    // one, the call is told where the skill is.
    const copy = result.skill.skillId;
    expect(
      errorOf(
        await tools(a).publish({ skillId: copy, skillName: "Release notes" })
      )
    ).toBe(
      'This skill is in the Eng team library. To publish its next version there, call again with library { type: "team", name: "Eng" }.'
    );
    saved(await tools(a).update({ instructions: "v2", skillId: copy }));
    const inPlace = published(
      await tools(a).publish({
        library: { id: eng.id, name: "Eng", type: "team" },
        skillId: copy,
        skillName: "Release notes",
      })
    );
    expect(inPlace.skill).toMatchObject({ skillId: copy, version: 2 });
  });

  it("refuses a library the person isn't in, or whose name doesn't match its id, listing the ones they can use", async () => {
    const { router, t, tools } = await setup();
    const { a, c, eng, org } = await acme(t);
    const id = saved(await tools(a).create(notes)).skill.skillId;

    const outside = errorOf(
      await tools(a).publish({
        library: { name: "Sales", type: "team" },
        skillId: id,
        skillName: "Release notes",
      })
    );
    expect(outside).toContain(`The person isn't in a team called "Sales".`);
    expect(outside).toContain(`Eng (team, id ${eng.id})`);
    expect(outside).toContain(`Acme (org, id ${org.id})`);
    // Their personal org is never a library to publish to.
    expect(outside).not.toContain("Personal");

    expect(
      errorOf(
        await tools(a).publish({
          library: { id: eng.id, name: "Platform", type: "team" },
          skillId: id,
          skillName: "Release notes",
        })
      )
    ).toBe(
      'That team is called "Eng". Call again with that name, so the person sees where it goes.'
    );

    const cs = saved(await tools(c).create(notes)).skill.skillId;
    expect(
      errorOf(
        await tools(c).publish({
          library: { id: org.id as OrgId, name: "Acme", type: "org" },
          skillId: cs,
          skillName: "Release notes",
        })
      )
    ).toContain("The person isn't in an org with that id.");
    // Nothing was published anywhere.
    expect((await mine(router, a))[0]?.latestVersionId).toBeNull();
  });
});
