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
