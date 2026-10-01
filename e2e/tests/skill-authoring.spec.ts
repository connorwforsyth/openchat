import { expect, type Page, test } from "@playwright/test";

import { apiFor } from "../support/api";
import {
  composer,
  composerReady,
  expectReply,
  plusMenu,
  send,
} from "../support/chat";
import { planDirective, resultArg } from "../support/mock-llm";
import { storageStateFor } from "../support/users";

// Writing a skill in a chat (128), as a person meets it: the model creates
// a skill, edits it and publishes it (the mock plays the three calls, the
// later two with the id the first returned), and each call waits for an
// Approve that says what it will do. The transcript shows each step as a
// skill card; the edit shows its SKILL.md diff. Once it's published, the
// skill is in the composer's + menu straight away, without a reload, and
// picking it puts its instructions in front of the model. It's deleted
// afterwards, so later specs see Ada's library as it was.

test.use({ storageState: storageStateFor("ada") });
test.describe.configure({ mode: "serial" });

const NAME = "E2E Standup notes";
const MARKER = "MARKER-STANDUP-128";
const APPROVE = /^Approve$/;
const PLAN_DONE = /Plan done after 3 steps/;
const LIBRARY_LINK = /^\/library\/[0-9a-f-]{36}$/;

test.afterAll(async ({ baseURL, browser }) => {
  const context = await browser.newContext({
    baseURL,
    storageState: storageStateFor("ada"),
  });
  const api = await apiFor(context, baseURL ?? "");
  const mine = await api.library.list({
    kind: "skill",
    limit: 100,
    query: NAME,
    tab: "mine",
  });
  for (const item of mine.items) {
    // biome-ignore lint/performance/noAwaitInLoops: one or two deletes.
    await api.library.delete({ id: item.id }).catch(() => undefined);
  }
  await context.close();
});

/** Approves the one call the run waits on, once its card says `what`. */
const approve = async (page: Page, toolName: string, what: string) => {
  const card = page.locator(
    `section[aria-label="Approval needed for ${toolName}"]:not([aria-busy="true"])`
  );
  await expect(card).toBeVisible();
  await expect(card).toContainText(what);
  await card.getByRole("button", { name: APPROVE }).click();
};

const skillCards = (page: Page) =>
  page.getByRole("region", { exact: true, name: `Skill: ${NAME}` });

test("the model creates, edits and publishes a skill, each approved; it's in + at once", async ({
  page,
}) => {
  await page.goto("/");
  await composerReady(page);
  await send(
    page,
    planDirective([
      [
        {
          args: {
            description: "Turns a list of updates into standup notes.",
            instructions: "Write three bullets: done, doing, blocked.",
            name: NAME,
          },
          name: "create_skill",
        },
      ],
      [
        {
          args: {
            instructions: `Write three bullets: done, doing, blocked. ${MARKER}`,
            skillId: resultArg("skillId"),
          },
          name: "update_skill",
        },
      ],
      [
        {
          args: { skillId: resultArg("skillId"), skillName: NAME },
          name: "publish_skill",
        },
      ],
    ])
  );

  // Create: the card says what it makes, and nothing is saved until Approve.
  await approve(
    page,
    "create_skill",
    `The agent wants to create the skill ${NAME} as a draft in your library.`
  );
  await expect(skillCards(page).first()).toContainText("Draft · v1");
  await expect(skillCards(page).first()).toContainText("In your library");

  // Edit: the new draft, with its SKILL.md diff.
  await approve(
    page,
    "update_skill",
    "The agent wants to change a skill's draft."
  );
  const edited = skillCards(page).nth(1);
  await expect(edited).toContainText("Changed a skill");
  await edited.getByRole("button", { name: "Changes to SKILL.md" }).click();
  await expect(edited).toContainText(MARKER);

  // Publish: the approval says where it goes.
  await approve(
    page,
    "publish_skill",
    `The agent wants to publish the skill ${NAME} in your library.`
  );
  const live = skillCards(page).nth(2);
  await expect(live).toContainText("Published · v1");
  await expect(
    live.getByRole("link", { name: "Open in Library" })
  ).toHaveAttribute("href", LIBRARY_LINK);
  await expectReply(page, PLAN_DONE);

  // In the + menu straight away, without a reload; picking it sends its
  // instructions with the next message.
  await plusMenu(page).click();
  await page.getByRole("menuitem", { exact: true, name: "Skills" }).click();
  await page.getByRole("menuitem", { name: NAME }).click();
  await expect(
    page.getByRole("list", { exact: true, name: "Skills" })
  ).toContainText(NAME);
  await composer(page).click();
  await send(page, "[show:system]");
  const reply = await expectReply(page, MARKER);
  await expect(reply).toContainText(`The user picked the skill "${NAME}"`);
});
