import { type Browser, expect, test } from "@playwright/test";
import type { ApiClient } from "@workspace/client/api";
import type {
  ConversationId,
  LibraryItemId,
} from "@workspace/contract/schemas/common";

import { apiFor, eventually, loadWorld } from "../support/api";
import { storageStateFor, type UserName } from "../support/users";

// PLAN.md §11 M1 step 5, sharing. Cy publishes an agent to Eng; Ben, in
// Eng › Platform, can use it but not read it, then (with `view`) read and
// duplicate it; removing Cy from the org leaves it working. Ada shares a
// personal agent with Ben: it's under "Shared with me", he can use it, and
// can't edit it until Ada grants `edit`.

test.describe.configure({ mode: "serial" });

const INSTRUCTIONS = "Always mention the release checklist.";

const signedIn = async (browser: Browser, baseURL: string, who: UserName) => {
  const context = await browser.newContext({
    baseURL,
    storageState: storageStateFor(who),
  });
  const page = await context.newPage();
  return { api: await apiFor(context, baseURL), context, page };
};

const agentDefinition = {
  instructions: INSTRUCTIONS,
  kind: "agent" as const,
  model: "mock:echo",
};

/** A turn with an agent, through the API; returns the reply's text. */
const askAgent = async (
  api: ApiClient,
  agentId: LibraryItemId,
  text: string
) => {
  const chat = await api.conversations.create({
    context: { type: "personal" },
  });
  const run = await api.runs.create({
    conversationId: chat.id,
    input: { parentId: null, parts: [{ text, type: "text" }], type: "message" },
    target: { id: agentId, type: "agent" },
  });
  const done = await eventually(
    () => api.runs.get({ id: run.runId }),
    (current) =>
      ["succeeded", "failed", "cancelled"].includes(current.state.status)
  );
  expect(done.state.status).toBe("succeeded");
  return replyIn(api, chat.id);
};

const replyIn = async (api: ApiClient, conversationId: ConversationId) => {
  const path = await api.messages.path({ conversationId });
  return path.messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) =>
      message.parts.flatMap((part) => (part.type === "text" ? [part.text] : []))
    )
    .join("\n");
};

let published: LibraryItemId;

test("an agent published to Eng is usable, not readable, in Platform", async ({
  baseURL,
  browser,
}) => {
  const world = await loadWorld();
  const cy = await signedIn(browser, baseURL ?? "", "cy");
  const draft = await cy.api.library.create({
    definition: agentDefinition,
    description: "Helps with releases",
    name: "Release helper",
  });
  await cy.api.library.publishVersion({ id: draft.id });
  const copy = await cy.api.library.publishToLibrary({
    id: draft.id,
    target: { id: world.eng, type: "team" },
  });
  published = copy.id;
  expect(copy.owner).toEqual({ id: world.eng, type: "team" });

  const ben = await signedIn(browser, baseURL ?? "", "ben");
  // Under the team libraries, in the UI.
  await ben.page.goto("/library");
  await ben.page.getByRole("tab", { name: "Team & org" }).click();
  await expect(ben.page.getByText("Release helper")).toBeVisible();

  // `use` only: the item, not its instructions; no duplicating.
  const seen = await ben.api.library.get({ id: published });
  expect(seen.myAccess).toBe("use");
  expect(seen.definition).toBeNull();
  await expect(ben.api.library.duplicate({ id: published })).rejects.toThrow();

  // …but it runs. (Through the API: the composer's picker lists models
  // only, so there's no way yet to pick an agent in the chat UI.)
  expect(await askAgent(ben.api, published, "Ship it?")).toContain(
    "Echo: Ship it?"
  );

  // With `view`, Ben reads it and can make his own copy.
  await cy.api.grants.create({
    permission: "view",
    principal: { id: world.platform, type: "team" },
    resourceId: published,
    resourceType: "agent",
  });
  const viewed = await ben.api.library.get({ id: published });
  expect(viewed.myAccess).toBe("view");
  expect(
    viewed.definition?.kind === "agent" ? viewed.definition.instructions : null
  ).toBe(INSTRUCTIONS);
  const mine = await ben.api.library.duplicate({
    id: published,
    name: "My release helper",
  });
  expect(mine.myAccess).toBe("owner");

  await cy.context.close();
  await ben.context.close();
});

test("removing the publisher from the org leaves the agent working", async ({
  baseURL,
  browser,
}) => {
  const world = await loadWorld();
  const ada = await signedIn(browser, baseURL ?? "", "ada");
  const cyId = (
    await ada.api.orgs.members({ limit: 50, orgId: world.orgId })
  ).items.find((member) => member.user.name === "Cy Author")?.user.id;
  if (!cyId) {
    throw new Error("Cy isn't in Acme");
  }
  await ada.api.orgs.removeMember({ orgId: world.orgId, userId: cyId });

  const ben = await signedIn(browser, baseURL ?? "", "ben");
  expect(await askAgent(ben.api, published, "Still there?")).toContain(
    "Echo: Still there?"
  );
  await ada.context.close();
  await ben.context.close();
});

test("a personal agent shared with Ben: use it, and edit only once granted", async ({
  baseURL,
  browser,
}) => {
  const ada = await signedIn(browser, baseURL ?? "", "ada");
  const ben = await signedIn(browser, baseURL ?? "", "ben");
  const benId = (await ben.api.me.get()).user.id;
  const agent = await ada.api.library.create({
    definition: agentDefinition,
    name: "Ada's drafter",
  });
  await ada.api.library.publishVersion({ id: agent.id });
  const grant = await ada.api.grants.create({
    permission: "use",
    principal: { id: benId, type: "user" },
    resourceId: agent.id,
    resourceType: "agent",
  });

  await ben.page.goto("/library");
  await ben.page.getByRole("tab", { name: "Shared with me" }).click();
  await expect(ben.page.getByText("Ada's drafter")).toBeVisible();
  expect(await askAgent(ben.api, agent.id, "Draft this")).toContain(
    "Echo: Draft this"
  );

  // Not his to edit…
  await expect(
    ben.api.library.update({ description: "Ben was here", id: agent.id })
  ).rejects.toThrow();
  // …until Ada says so.
  await ada.api.grants.update({ id: grant.id, permission: "edit" });
  const edited = await ben.api.library.update({
    description: "Ben was here",
    id: agent.id,
  });
  expect(edited.description).toBe("Ben was here");
  await ada.context.close();
  await ben.context.close();
});
