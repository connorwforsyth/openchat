import { type Browser, expect, type Page, test } from "@playwright/test";
import type {
  ConversationId,
  LibraryItemId,
} from "@workspace/contract/schemas/common";

import { apiFor, loadWorld } from "../support/api";
import {
  conversationIdOf,
  expectReply,
  pickTarget,
  send,
  targetPicker,
} from "../support/chat";
import { storageStateFor, type UserName } from "../support/users";

// PLAN.md §11 M1 step 5, sharing. Cy publishes an agent to Eng; Ben, in
// Eng › Platform, can use it but not read it, then (with `view`) read and
// duplicate it; removing Cy from the org leaves it working. Ada shares a
// personal agent with Ben: it's under "Shared with me", he can use it, and
// can't edit it until Ada grants `edit`. Ben chats with both in the UI:
// "Use in chat" from the library, and the composer's agent picker (044).
// Publishing and granting go through the API (the builder's own flows).

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

/** The rail's Library panel, where the tabs live on a wide screen (181). */
const libraryPanel = (page: Page) =>
  page.getByRole("navigation", { name: "Library" });

const HOME_URL_WITH_AGENT = /\/\?agent=[0-9a-f-]{36}$/;

const agentDefinition = {
  instructions: INSTRUCTIONS,
  kind: "agent" as const,
  model: "mock:echo",
};

let published: LibraryItemId;
/** Ben's chat with the published agent, which he comes back to. */
let benChat: ConversationId;

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
  await libraryPanel(ben.page).getByRole("link", { name: "Spaces" }).click();
  await expect(
    ben.page.getByRole("link", { exact: true, name: "Release helper" })
  ).toBeVisible();

  // `use` only: the item, not its instructions; no duplicating.
  const seen = await ben.api.library.get({ id: published });
  expect(seen.myAccess).toBe("use");
  expect(seen.definition).toBeNull();
  await expect(ben.api.library.duplicate({ id: published })).rejects.toThrow();

  // …but it runs: "Use in chat" on its card starts a chat with it (044).
  await ben.page
    .getByRole("link", { name: "Use in chat Release helper" })
    .click();
  await expect(ben.page).toHaveURL(HOME_URL_WITH_AGENT);
  await expect(targetPicker(ben.page, "Release helper")).toBeVisible();
  await send(ben.page, "Ship it?");
  await expectReply(ben.page, "Echo: Ship it?");
  benChat = await conversationIdOf(ben.page);
  // The chat keeps the agent, so reopening it carries on with it.
  expect(
    (await ben.api.conversations.get({ id: benChat })).defaultTarget
  ).toEqual({ id: published, type: "agent" });

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

  // Ben's chat with it carries on, with the agent still picked.
  const ben = await signedIn(browser, baseURL ?? "", "ben");
  await ben.page.goto(`/c/${benChat}`);
  await expect(targetPicker(ben.page, "Release helper")).toBeVisible();
  await send(ben.page, "Still there?");
  await expectReply(ben.page, "Echo: Still there?");
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
  await libraryPanel(ben.page)
    .getByRole("link", { name: "Shared with me" })
    .click();
  await expect(
    ben.page.getByRole("link", { exact: true, name: "Ada's drafter" })
  ).toBeVisible();
  // In a new chat, the composer's picker lists it under "Shared with me".
  await ben.page.goto("/");
  await pickTarget(ben.page, {
    group: "Shared with me",
    name: "Ada's drafter",
  });
  await send(ben.page, "Draft this");
  await expectReply(ben.page, "Echo: Draft this");
  const drafted = await ben.api.conversations.get({
    id: await conversationIdOf(ben.page),
  });
  expect(drafted.defaultTarget).toEqual({ id: agent.id, type: "agent" });

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
