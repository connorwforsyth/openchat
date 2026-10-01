import { expect, type Page, test } from "@playwright/test";
import type { LibraryItemId } from "@workspace/contract/schemas/common";

import { apiFor } from "../support/api";
import {
  composer,
  composerReady,
  conversationIdOf,
  expectReply,
  plusMenu,
  send,
  userMessages,
} from "../support/chat";
import { storageStateFor } from "../support/users";

// Skills in chats (127), as a person meets them: a published skill of
// theirs is in the composer's + menu under Skills and in `/`; picking it
// puts a removable chip on the message, which goes out with it. The mock
// echoes the instructions it was sent (`[show:system]`), so the skill's
// marker in the reply shows its `SKILL.md` reached the model; the message
// keeps the skill, after a reload too. An agent with a skill attached lists
// it, and loads it with `load_skill` (the mock's `[tool:…]`), without asking.
// Publishing the skills and the agent goes through the API (the library's
// own flows); they're deleted afterwards, so later specs see Ada's library
// as it was.

test.use({ storageState: storageStateFor("ada") });
test.describe.configure({ mode: "serial" });

const HAIKU = "E2E Haiku";
const HAIKU_MARKER = "MARKER-HAIKU-127";
const NOTES = "E2E Release notes";
const NOTES_MARKER = "MARKER-NOTES-127";
const POET = "E2E Poet";

const skillMd = (name: string, marker: string) =>
  `---\nname: ${name.toLowerCase().replaceAll(" ", "-")}\ndescription: For the e2e suite.\n---\n\nAnswer as ${name} does. ${marker}\n`;

const made: LibraryItemId[] = [];
/** The release-notes skill the first test publishes; the agent's, in the second. */
let notesSkill: LibraryItemId | undefined;

const publishSkill = async (
  api: Awaited<ReturnType<typeof apiFor>>,
  name: string,
  marker: string
): Promise<LibraryItemId> => {
  const draft = await api.library.create({
    definition: { files: [], kind: "skill", skillMd: skillMd(name, marker) },
    description: `${name} for the e2e suite`,
    name,
  });
  await api.library.publishVersion({ id: draft.id });
  made.push(draft.id);
  return draft.id;
};

const skillChips = (page: Page) =>
  page.getByRole("list", { exact: true, name: "Skills" });

test.afterAll(async ({ baseURL, browser }) => {
  const context = await browser.newContext({
    baseURL,
    storageState: storageStateFor("ada"),
  });
  const api = await apiFor(context, baseURL ?? "");
  // Agents first: one may name a skill.
  for (const id of made.reverse()) {
    // biome-ignore lint/performance/noAwaitInLoops: a few deletes, in order.
    await api.library.delete({ id }).catch(() => undefined);
  }
  await context.close();
});

test("pick a skill from + and from /: a chip, sent with the message, kept in its history", async ({
  baseURL,
  page,
}) => {
  const api = await apiFor(page, baseURL ?? "");
  const haiku = await publishSkill(api, HAIKU, HAIKU_MARKER);
  const notes = await publishSkill(api, NOTES, NOTES_MARKER);
  notesSkill = notes;

  await page.goto("/");
  await composerReady(page);

  // From the + menu.
  await plusMenu(page).click();
  await page.getByRole("menuitem", { exact: true, name: "Skills" }).click();
  await page.getByRole("menuitem", { name: HAIKU }).click();
  await expect(skillChips(page)).toContainText(HAIKU);

  // From `/`: the skill becomes a chip, and its `/query` goes.
  await composer(page).click();
  await composer(page).pressSequentially("/release");
  await page.getByRole("option", { name: NOTES }).click();
  await expect(skillChips(page)).toContainText(NOTES);
  await expect(composer(page)).toHaveText("");

  // A chip comes off with ×.
  await page.getByRole("button", { name: `Remove skill ${NOTES}` }).click();
  await expect(skillChips(page)).not.toContainText(NOTES);

  await send(page, "[show:system]");
  const reply = await expectReply(page, HAIKU_MARKER);
  await expect(reply).toContainText(`The user picked the skill "${HAIKU}"`);
  await expect(reply).not.toContainText(NOTES_MARKER);
  // The chip went with the message.
  await expect(skillChips(page)).toHaveCount(0);

  // The message keeps the skill it used, with the version the turn read.
  const id = await conversationIdOf(page);
  const path = await api.messages.path({ conversationId: id });
  const user = path.messages.find((message) => message.role === "user");
  expect(user?.parts).toContainEqual({
    data: {
      skills: [{ id: haiku, name: HAIKU, versionId: expect.any(String) }],
    },
    name: "skills",
    type: "data",
  });
  expect(JSON.stringify(user?.parts)).not.toContain(notes);
  await expect(userMessages(page).first()).toContainText(
    `Used the skill ${HAIKU}`
  );
  await page.reload();
  await expect(userMessages(page).first()).toContainText(
    `Used the skill ${HAIKU}`
  );
});

test("an agent lists its skill and loads it with load_skill, without asking", async ({
  baseURL,
  page,
}) => {
  const api = await apiFor(page, baseURL ?? "");
  const notes = notesSkill ?? (await publishSkill(api, NOTES, NOTES_MARKER));
  const agent = await api.library.create({
    definition: {
      instructions: "You write release notes.",
      kind: "agent",
      model: "mock:echo",
      skills: [{ id: notes }],
    },
    name: POET,
  });
  await api.library.publishVersion({ id: agent.id });
  made.push(agent.id);

  await page.goto(`/?agent=${agent.id}`);
  await send(page, "[show:system]");
  // Listed by name and description; its instructions wait to be loaded.
  const listed = await expectReply(page, `${NOTES}: For the e2e suite.`);
  await expect(listed).not.toContainText(NOTES_MARKER);

  await send(page, `[tool:load_skill {"skill": "${NOTES}"}]`);
  await expectReply(page, "Tool result:");
  const id = await conversationIdOf(page);
  const path = await api.messages.path({ conversationId: id });
  const calls = path.messages.flatMap((message) =>
    message.parts.flatMap((part) => (part.type === "tool-call" ? [part] : []))
  );
  expect(calls.map((call) => [call.toolName, call.approval.state])).toEqual([
    ["load_skill", "not-required"],
  ]);
  const results = path.messages.flatMap((message) =>
    message.parts.flatMap((part) => (part.type === "tool-result" ? [part] : []))
  );
  expect(JSON.stringify(results)).toContain(NOTES_MARKER);
  await expect(
    page.locator('section[aria-label^="Approval needed"]')
  ).toHaveCount(0);
});
