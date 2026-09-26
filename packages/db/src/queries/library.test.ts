import type { AgentDefinition } from "@workspace/contract/schemas/library";
import { newId } from "@workspace/shared/ids";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createTestDb, expectOk, seedUser, type TestDb } from "../testing";
import { listGrantsForResource, upsertGrant } from "./grants";
import {
  createMcpServer,
  createPreset,
  createVersionedItem,
  deleteVersionedItem,
  getVersion,
  getVersionedItem,
  listMcpServers,
  listOwnedItems,
  listPresets,
  listPublishedVersions,
  publishDraft,
  resolvePublishedVersion,
  setMaintainers,
  updateDraft,
  updateItemMeta,
  updateMcpServer,
} from "./library";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

const agentDefinition = (instructions: string): AgentDefinition => ({
  approvals: { default: "auto", tools: {} },
  conversationStarters: [],
  instructions,
  kind: "agent",
  knowledgeFileIds: [],
  mcpServers: [],
  model: "fast",
  parameters: {},
  sandboxProvider: null,
  skills: [],
  tools: [],
});

describe("versioned items", () => {
  test("drafts, publishes in order, and resolves what consumers run", async () => {
    const { db } = testDb;
    const owner = await seedUser(db);
    const created = await createVersionedItem(db, "agent", {
      createdBy: owner.id,
      definition: agentDefinition("v1"),
      name: "Helper",
      owner: { id: owner.id, type: "user" },
    });
    expect(created.item.draftVersionId).toBe(created.draft.id);
    expect(created.draft).toMatchObject({ number: null, status: "draft" });
    const itemId = created.item.id;

    // Nothing published yet: consumers get nothing.
    expect(await resolvePublishedVersion(db, "agent", itemId)).toMatchObject({
      error: { type: "not_found" },
    });

    const v1 = expectOk(
      await publishDraft(db, "agent", itemId, { publishedBy: owner.id })
    );
    expect(v1.version).toMatchObject({ number: 1, status: "published" });
    expect(v1.draft.definition.instructions).toBe("v1");

    expect(
      await publishDraft(db, "agent", itemId, { publishedBy: owner.id })
    ).toMatchObject({ error: { reason: "nothing_to_publish" } });

    expectOk(await updateDraft(db, "agent", itemId, agentDefinition("v2")));
    const v2 = expectOk(
      await publishDraft(db, "agent", itemId, {
        notes: "better",
        publishedBy: owner.id,
      })
    );
    expect(v2.version).toMatchObject({ notes: "better", number: 2 });

    const item = expectOk(await getVersionedItem(db, "agent", itemId));
    expect(item).toMatchObject({
      draftVersionId: v2.draft.id,
      latestVersionId: v2.version.id,
    });

    const latest = expectOk(await resolvePublishedVersion(db, "agent", itemId));
    expect(latest.definition.instructions).toBe("v2");
    const pinned = expectOk(
      await resolvePublishedVersion(db, "agent", itemId, v1.version.id)
    );
    expect(pinned.number).toBe(1);
    expect(
      await resolvePublishedVersion(db, "agent", itemId, v2.draft.id)
    ).toMatchObject({ error: { type: "not_found" } });

    expect(
      (await listPublishedVersions(db, "agent", itemId)).map((v) => v.number)
    ).toEqual([2, 1]);
    expect(expectOk(await getVersion(db, "agent", v1.version.id)).id).toBe(
      v1.version.id
    );
  });

  test("each kind has its own tables and owner listings", async () => {
    const { db } = testDb;
    const owner = await seedUser(db);
    const mine = { id: owner.id, type: "user" } as const;
    const promptItem = await createVersionedItem(db, "prompt", {
      createdBy: owner.id,
      definition: {
        kind: "prompt",
        template: "Summarise {{text}}",
        variables: [{ name: "text" }],
      },
      name: "Summarise",
      owner: mine,
    });
    const skillItem = await createVersionedItem(db, "skill", {
      createdBy: owner.id,
      definition: { kind: "skill", skillMd: "# Skill" },
      name: "Skill",
      owner: mine,
    });
    expect((await listOwnedItems(db, "prompt", mine)).map((i) => i.id)).toEqual(
      [promptItem.item.id]
    );
    expect(
      await getVersionedItem(db, "agent", skillItem.item.id)
    ).toMatchObject({
      error: { type: "not_found" },
    });
    const renamed = expectOk(
      await updateItemMeta(db, "prompt", promptItem.item.id, {
        icon: "📝",
        name: "TL;DR",
      })
    );
    expect(renamed).toMatchObject({ icon: "📝", name: "TL;DR" });
    const maintained = expectOk(
      await setMaintainers(db, "skill", skillItem.item.id, [owner.id, owner.id])
    );
    expect(maintained.maintainers).toEqual([owner.id]);
    expect(
      await updateDraft(
        db,
        "prompt",
        newId("libraryItem"),
        promptItem.draft.definition
      )
    ).toMatchObject({
      error: { type: "not_found" },
    });
  });

  test("deleting an item removes its grants", async () => {
    const { db } = testDb;
    const owner = await seedUser(db);
    const friend = await seedUser(db);
    const { item } = await createVersionedItem(db, "agent", {
      createdBy: owner.id,
      definition: agentDefinition("x"),
      name: "Gone soon",
      owner: { id: owner.id, type: "user" },
    });
    const resource = { resourceId: item.id, resourceType: "agent" } as const;
    expectOk(
      await upsertGrant(db, {
        grantedBy: owner.id,
        permission: "use",
        principal: { id: friend.id, type: "user" },
        resource,
      })
    );
    expectOk(await deleteVersionedItem(db, "agent", item.id));
    expect(await listGrantsForResource(db, resource)).toEqual([]);
    expect(await deleteVersionedItem(db, "agent", item.id)).toMatchObject({
      error: { type: "not_found" },
    });
  });
});

describe("unversioned items", () => {
  test("MCP servers keep secrets sealed and apart; presets are plain", async () => {
    const { db } = testDb;
    const owner = await seedUser(db);
    const mine = { id: owner.id, type: "user" } as const;
    const server = await createMcpServer(db, {
      createdBy: owner.id,
      definition: {
        auth: { configured: true, headerName: "Authorization", type: "header" },
        kind: "mcp_server",
        transport: "http",
        url: "https://mcp.example.test/",
      },
      name: "Docs",
      owner: mine,
      secret: { ciphertext: "sealed-bytes", keyId: "k1" },
    });
    expect(server).toMatchObject({
      secretCiphertext: "sealed-bytes",
      secretKeyId: "k1",
    });
    const cleared = expectOk(
      await updateMcpServer(db, server.id, { secret: null })
    );
    expect(cleared).toMatchObject({
      secretCiphertext: null,
      secretKeyId: null,
    });
    expect((await listMcpServers(db, mine)).map((s) => s.id)).toEqual([
      server.id,
    ]);

    const presetRow = await createPreset(db, {
      createdBy: owner.id,
      definition: {
        kind: "preset",
        model: "strong",
        parameters: { temperature: 0.2 },
      },
      name: "Careful",
      owner: mine,
    });
    expect((await listPresets(db, mine)).map((p) => p.id)).toEqual([
      presetRow.id,
    ]);
  });
});
