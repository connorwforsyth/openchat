import { call } from "@orpc/server";
import type { UserId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import { saveArtifactVersion } from "@workspace/db/queries/artifacts";
import { createConversation } from "@workspace/db/queries/conversations";
import { insertMessage } from "@workspace/db/queries/messages";
import { artifactVersion } from "@workspace/db/schema/files";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantAccess } from "../context";
import { createArtifactsRouter } from "./artifacts";

// Artifacts are readable by whoever can read their conversation; to anyone
// else they don't exist.

let t: TestDb;
let db: Db;

beforeAll(async () => {
  t = await createTestDb();
  ({ db } = t);
});

afterAll(() => t.close());

const as = (userId: UserId | null) => ({
  context: {
    request: new Request("http://x"),
    session: userId ? { userId } : null,
  },
});

const seedArtifact = async () => {
  const owner = await seedUser(db);
  const stranger = await seedUser(db);
  const personal = await seedOrg(db, owner.id, { isPersonal: true });
  const chat = await createConversation(db, {
    context: { id: personal.id, type: "personal" },
    ownerId: owner.id,
  });
  const message = expectOk(
    await insertMessage(db, {
      authorId: null,
      conversationId: chat.id,
      parentId: null,
      parts: [{ text: "Here you go", type: "text" }],
      role: "assistant",
    })
  );
  const first = expectOk(
    await saveArtifactVersion(db, {
      content: "v1",
      conversationId: chat.id,
      kind: "code",
      language: "ts",
      messageId: message.id,
      title: "Draft",
    })
  );
  const second = expectOk(
    await saveArtifactVersion(db, {
      artifactId: first.artifact.id,
      content: "v2",
      conversationId: chat.id,
      kind: "code",
      language: "ts",
      messageId: message.id,
      title: "Final",
    })
  );
  return { chat, first, owner, second, stranger };
};

describe("artifacts procedures", () => {
  it("reads artifacts and their versions through the conversation", async () => {
    const { artifacts } = createArtifactsRouter({
      access: grantAccess(db),
      db,
    });
    const { chat, first, owner, second } = await seedArtifact();
    const { id } = first.artifact;

    const listed = await call(
      artifacts.list,
      { conversationId: chat.id },
      as(owner.id)
    );
    expect(listed).toEqual([
      expect.objectContaining({
        id,
        latestVersionId: second.version.id,
        title: "Final",
      }),
    ]);
    expect(await call(artifacts.get, { id }, as(owner.id))).toMatchObject({
      id,
      kind: "code",
    });
    const versions = await call(artifacts.listVersions, { id }, as(owner.id));
    expect(
      versions.map((version) => [version.number, version.content])
    ).toEqual([
      [1, "v1"],
      [2, "v2"],
    ]);
    expect(
      await call(
        artifacts.getVersion,
        { id, versionId: first.version.id },
        as(owner.id)
      )
    ).toMatchObject({ content: "v1", language: "ts", number: 1 });
  });

  it("still shows an artifact whose versions are gone, with no latest version", async () => {
    const { artifacts } = createArtifactsRouter({
      access: grantAccess(db),
      db,
    });
    const { chat, first, owner } = await seedArtifact();
    const { id } = first.artifact;
    // `latest_version_id` is `on delete set null`.
    await db.delete(artifactVersion).where(eq(artifactVersion.artifactId, id));

    expect(await call(artifacts.get, { id }, as(owner.id))).toMatchObject({
      id,
      latestVersionId: null,
    });
    expect(
      await call(artifacts.list, { conversationId: chat.id }, as(owner.id))
    ).toEqual([expect.objectContaining({ id, latestVersionId: null })]);
    expect(await call(artifacts.listVersions, { id }, as(owner.id))).toEqual(
      []
    );
  });

  it("answers NOT_FOUND to anyone who can't read the chat", async () => {
    const { artifacts } = createArtifactsRouter({
      access: grantAccess(db),
      db,
    });
    const { chat, first, stranger } = await seedArtifact();
    const other = await seedArtifact();
    const { id } = first.artifact;

    await expect(call(artifacts.get, { id }, as(null))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const attempts = [
      call(artifacts.get, { id }, as(stranger.id)),
      call(artifacts.listVersions, { id }, as(stranger.id)),
      call(
        artifacts.getVersion,
        { id, versionId: first.version.id },
        as(stranger.id)
      ),
      call(artifacts.list, { conversationId: chat.id }, as(stranger.id)),
      // A version id from another artifact doesn't resolve under this one.
      call(
        artifacts.getVersion,
        { id: other.first.artifact.id, versionId: first.version.id },
        as(other.owner.id)
      ),
    ];
    await Promise.all(
      attempts.map((attempt) =>
        expect(attempt).rejects.toMatchObject({ code: "NOT_FOUND" })
      )
    );
  });
});

describe("the Artifacts page (124)", () => {
  const router = () =>
    createArtifactsRouter({ access: grantAccess(db), db }).artifacts;

  it("lists what you own and what's shared with you, and records views", async () => {
    const artifacts = router();
    const { first, owner, stranger } = await seedArtifact();
    const { id } = first.artifact;

    const mine = await call(artifacts.listAll, { scope: "mine" }, as(owner.id));
    expect(mine.items).toEqual([
      expect.objectContaining({
        access: "owner",
        canGoToChat: true,
        id,
        ownerId: owner.id,
        viewedAt: null,
        visibility: "private",
      }),
    ]);
    expect((await call(artifacts.listAll, {}, as(stranger.id))).items).toEqual(
      []
    );
    await expect(
      call(artifacts.detail, { id }, as(stranger.id))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // A viewer share: listed under "shared", readable, but no chat to open.
    const grant = await call(
      artifacts.share,
      {
        id,
        permission: "viewer",
        principal: { id: stranger.id, type: "user" },
      },
      as(owner.id)
    );
    const shared = await call(
      artifacts.listAll,
      { scope: "shared" },
      as(stranger.id)
    );
    expect(shared.items).toEqual([
      expect.objectContaining({
        access: "viewer",
        canGoToChat: false,
        id,
        visibility: "shared",
      }),
    ]);
    const detail = await call(artifacts.detail, { id }, as(stranger.id));
    expect(detail.versions.map((version) => version.content)).toEqual([
      "v1",
      "v2",
    ]);
    expect(await call(artifacts.listGrants, { id }, as(stranger.id))).toEqual([
      expect.objectContaining({ id: grant.id, permission: "viewer" }),
    ]);

    await call(artifacts.markViewed, { id }, as(stranger.id));
    const viewed = await call(artifacts.listAll, {}, as(stranger.id));
    expect(viewed.items[0]?.viewedAt).not.toBeNull();

    // A viewer can't rename, delete or share it.
    await expect(
      call(artifacts.rename, { id, title: "Mine now" }, as(stranger.id))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(artifacts.delete, { id }, as(stranger.id))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(
        artifacts.share,
        {
          id,
          permission: "editor",
          principal: { id: stranger.id, type: "user" },
        },
        as(stranger.id)
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // They can drop the share made to them.
    await call(artifacts.unshare, { grantId: grant.id, id }, as(stranger.id));
    await expect(
      call(artifacts.get, { id }, as(stranger.id))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("filters by kind and search, and refuses a bad cursor", async () => {
    const artifacts = router();
    const { owner } = await seedArtifact();
    expect(
      (await call(artifacts.listAll, { kind: "html" }, as(owner.id))).items
    ).toEqual([]);
    expect(
      (await call(artifacts.listAll, { query: "v2" }, as(owner.id))).items
    ).toHaveLength(1);
    expect(
      (await call(artifacts.listAll, { query: "v1" }, as(owner.id))).items
    ).toHaveLength(0);
    await expect(
      call(artifacts.listAll, { cursor: "nope" }, as(owner.id))
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("renames for an editor, duplicates for a viewer, deletes for the owner", async () => {
    const artifacts = router();
    const { first, owner, stranger } = await seedArtifact();
    const { id } = first.artifact;
    await call(
      artifacts.share,
      {
        id,
        permission: "editor",
        principal: { id: stranger.id, type: "user" },
      },
      as(owner.id)
    );
    const renamed = await call(
      artifacts.rename,
      { id, title: "Release notes" },
      as(stranger.id)
    );
    expect(renamed).toMatchObject({ access: "editor", title: "Release notes" });

    const copy = await call(artifacts.duplicate, { id }, as(stranger.id));
    expect(copy).toMatchObject({
      access: "owner",
      ownerId: stranger.id,
      title: "Release notes (copy)",
      visibility: "private",
    });
    expect(
      (await call(artifacts.detail, { id: copy.id }, as(stranger.id))).versions
    ).toEqual([expect.objectContaining({ content: "v2", number: 1 })]);

    await expect(
      call(artifacts.delete, { id }, as(stranger.id))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await call(artifacts.delete, { id }, as(owner.id));
    await expect(
      call(artifacts.get, { id }, as(owner.id))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("won't share with yourself or into an org you're not in", async () => {
    const artifacts = router();
    const { first, owner, stranger } = await seedArtifact();
    const elsewhere = await seedOrg(db, stranger.id);
    const { id } = first.artifact;
    for (const principal of [
      { id: owner.id, type: "user" as const },
      { id: elsewhere.id, type: "org" as const },
    ]) {
      // biome-ignore lint/performance/noAwaitInLoops: one refusal at a time.
      await expect(
        call(
          artifacts.share,
          { id, permission: "viewer", principal },
          as(owner.id)
        )
      ).rejects.toMatchObject({ code: "VALIDATION" });
    }
  });

  it("uses an artifact in another chat, which then lists and can version it", async () => {
    const artifacts = router();
    const { first, owner, stranger } = await seedArtifact();
    const { id } = first.artifact;
    const personal = await seedOrg(db, owner.id, { isPersonal: true });
    const other = await createConversation(db, {
      context: { id: personal.id, type: "personal" },
      ownerId: owner.id,
    });

    // Someone who can't write to that chat can't attach anything to it.
    await call(
      artifacts.share,
      {
        id,
        permission: "viewer",
        principal: { id: stranger.id, type: "user" },
      },
      as(owner.id)
    );
    await expect(
      call(artifacts.use, { conversationId: other.id, id }, as(stranger.id))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await call(artifacts.use, { conversationId: other.id, id }, as(owner.id));
    expect(
      await call(artifacts.list, { conversationId: other.id }, as(owner.id))
    ).toEqual([expect.objectContaining({ id })]);
  });
});

describe("saving a person's edit (126)", () => {
  const router = () =>
    createArtifactsRouter({ access: grantAccess(db), db }).artifacts;
  const doc = (text: string) =>
    JSON.stringify({
      content: [{ content: [{ text, type: "text" }], type: "paragraph" }],
      type: "doc",
    });

  const seedDocument = async () => {
    const owner = await seedUser(db);
    const other = await seedUser(db);
    const personal = await seedOrg(db, owner.id, { isPersonal: true });
    const chat = await createConversation(db, {
      context: { id: personal.id, type: "personal" },
      ownerId: owner.id,
    });
    const message = expectOk(
      await insertMessage(db, {
        authorId: null,
        conversationId: chat.id,
        parentId: null,
        parts: [{ text: "Here you go", type: "text" }],
        role: "assistant",
      })
    );
    const made = expectOk(
      await saveArtifactVersion(db, {
        content: doc("First draft"),
        conversationId: chat.id,
        kind: "document",
        messageId: message.id,
        title: "Brief",
      })
    );
    return { chat, made, message, other, owner };
  };

  it("saves the owner's edit as the next version, made by them", async () => {
    const artifacts = router();
    const { chat, made, message, owner } = await seedDocument();
    const { id } = made.artifact;
    const saved = await call(
      artifacts.saveVersion,
      { baseVersionId: made.version.id, content: doc("Edited"), id },
      as(owner.id)
    );
    expect(saved).toMatchObject({
      artifactId: id,
      content: doc("Edited"),
      conversationId: chat.id,
      editedBy: owner.id,
      messageId: message.id,
      number: 2,
    });
    expect(await call(artifacts.get, { id }, as(owner.id))).toMatchObject({
      latestVersionId: saved.id,
    });
    const versions = await call(artifacts.listVersions, { id }, as(owner.id));
    expect(versions.map((version) => version.editedBy)).toEqual([
      null,
      owner.id,
    ]);
  });

  it("lets an editor save, not a viewer, and hides it from anyone else", async () => {
    const artifacts = router();
    const { made, other, owner } = await seedDocument();
    const { id } = made.artifact;
    const edit = { baseVersionId: made.version.id, content: doc("Mine"), id };
    await expect(
      call(artifacts.saveVersion, edit, as(other.id))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await call(
      artifacts.share,
      { id, permission: "viewer", principal: { id: other.id, type: "user" } },
      as(owner.id)
    );
    await expect(
      call(artifacts.saveVersion, edit, as(other.id))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await call(
      artifacts.share,
      { id, permission: "editor", principal: { id: other.id, type: "user" } },
      as(owner.id)
    );
    expect(await call(artifacts.saveVersion, edit, as(other.id))).toMatchObject(
      { editedBy: other.id, number: 2 }
    );
  });

  it("refuses an edit of a version that's no longer the latest", async () => {
    const artifacts = router();
    const { made, owner } = await seedDocument();
    const { id } = made.artifact;
    await call(
      artifacts.saveVersion,
      { baseVersionId: made.version.id, content: doc("One"), id },
      as(owner.id)
    );
    await expect(
      call(
        artifacts.saveVersion,
        { baseVersionId: made.version.id, content: doc("Two"), id },
        as(owner.id)
      )
    ).rejects.toMatchObject({
      code: "CONFLICT",
      data: { reason: "version_mismatch" },
    });
  });

  it("runs the kind's checks: content that isn't a document, or an unsafe link", async () => {
    const artifacts = router();
    const { made, owner } = await seedDocument();
    const { id } = made.artifact;
    await expect(
      call(
        artifacts.saveVersion,
        { baseVersionId: made.version.id, content: "# Not JSON", id },
        as(owner.id)
      )
    ).rejects.toMatchObject({
      code: "VALIDATION",
      data: {
        issues: [
          { message: "content isn't a document's JSON", path: ["content"] },
        ],
      },
    });
    const unsafe = JSON.stringify({
      content: [
        {
          content: [
            {
              marks: [{ attrs: { href: "javascript:alert(1)" }, type: "link" }],
              text: "click",
              type: "text",
            },
          ],
          type: "paragraph",
        },
      ],
      type: "doc",
    });
    await expect(
      call(
        artifacts.saveVersion,
        { baseVersionId: made.version.id, content: unsafe, id },
        as(owner.id)
      )
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(
      await call(artifacts.listVersions, { id }, as(owner.id))
    ).toHaveLength(1);
  });
});
