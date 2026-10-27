import { expect, type Page } from "@playwright/test";
import { apiFor } from "../../../../e2e/support/api";
import {
  assistantMessages,
  composer,
  conversationIdOf,
  send,
} from "../../../../e2e/support/chat";
import { signUp, users } from "../../../../e2e/support/users";
import { authState, proof } from "./evidence";
import { test } from "./fixtures";

// Feature: the outputs card (night 2, decision 4). The chat's artifacts and
// what the agent is working on, in a card at the chat column's top end that
// stays open, collapses to the header button and is remembered per person.

test.use({
  storageState: authState("ada"),
  video: { mode: "on", size: { height: 900, width: 1440 } },
});

const FEATURE = "outputs-card";
const APPROVE = /^Approve( all)?$/;

const card = (page: Page) =>
  page.getByRole("region", { name: "Artifacts and tasks" });
const toggle = (page: Page) =>
  page
    .locator('[data-slot="app-header"]')
    .getByRole("button", { name: "Artifacts and tasks" });

const site = (title: string) =>
  `[tool:create_artifact ${JSON.stringify({
    content: JSON.stringify({
      files: {
        "index.html": `<!doctype html><html><body><h1>${title}</h1></body></html>`,
      },
    }),
    title,
    type: "site",
  })}]`;

const approve = async (page: Page) => {
  const approval = page.locator(
    'section[aria-label="Approval needed for create_artifact"]:not([aria-busy="true"])'
  );
  await expect(approval).toBeVisible();
  await approval.getByRole("button", { name: APPROVE }).click();
};

test("the card lists artifacts and tasks, stays open, and is remembered", async ({
  baseURL,
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  const tag = `o${Date.now().toString(36)}`;
  const title = `Site ${tag}`;
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/");
  await send(page, site(title));

  // Waiting on a decision shows as a task.
  await expect(card(page).getByText("Waiting for approval")).toBeVisible();
  await proof(page, FEATURE, "01-waiting-for-approval");
  await approve(page);
  const row = card(page).getByRole("button", { name: title });
  await expect(row).toBeVisible();
  await expect(card(page).getByText("Tasks")).toHaveCount(0, {
    timeout: 30_000,
  });
  await proof(page, FEATURE, "02-artifact-listed");

  // A pick opens it beside the chat; the card stays over the column.
  await row.click();
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect(card(page)).toBeVisible();
  await proof(page, FEATURE, "03-open-beside-preview");

  // A slow answer as a task; a message sent while it works joins it (the
  // answer starts again with both), so it's still one task, for the latest.
  await send(page, `[slow] ${tag}`);
  await expect(card(page).getByText("Working…")).toBeVisible();
  const input = composer(page);
  await input.click();
  await page.keyboard.type(`More [slow] ${tag}`);
  await page.keyboard.press("Enter");
  await expect(card(page).getByText(`More [slow] ${tag}`)).toBeVisible();
  await expect(card(page).getByText("Working…")).toHaveCount(1);
  await proof(page, FEATURE, "04-running-with-a-follow-up");

  // A task takes you to its turn.
  await card(page)
    .getByRole("button", { name: `[slow] ${tag}` })
    .first()
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.activeElement?.matches("[data-message-id]") ?? false
      )
    )
    .toBe(true);

  // A second tab lists the same tasks, from the server.
  const other = await page.context().newPage();
  await other.setViewportSize({ height: 900, width: 1440 });
  await other.goto(page.url());
  await expect(card(other).getByText("Tasks")).toBeVisible();
  await proof(other, FEATURE, "05-second-tab");
  await other.close();
  await expect(assistantMessages(page).last()).toContainText("Slow reply", {
    timeout: 90_000,
  });
  await expect(card(page).getByText("Tasks")).toHaveCount(0, {
    timeout: 90_000,
  });

  // Collapsed, it stays collapsed after a reload; A brings it back.
  await toggle(page).click();
  await expect(card(page)).toHaveCount(0);
  await page.reload();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(card(page)).toHaveCount(0);
  await proof(page, FEATURE, "06-collapsed-after-reload");
  await page.locator("body").click({ position: { x: 5, y: 400 } });
  await page.keyboard.press("a");
  await expect(card(page)).toBeVisible();
  await expect(card(page).locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
  await expect(toggle(page)).toBeFocused();
  await page.keyboard.press("a");
  await expect(card(page)).toBeVisible();

  // Widths: the card floats where there's room and is a peek below that.
  await [1440, 1280, 1024, 800, 600].reduce(async (previous, width) => {
    await previous;
    await page.setViewportSize({ height: 900, width });
    await proof(page, FEATURE, `07-width-${width}`);
  }, Promise.resolve());
  // With the panel open at 1024 the column is too narrow: the button peeks.
  await page.setViewportSize({ height: 900, width: 1024 });
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await toggle(page).click();
  await expect(card(page)).toBeVisible();
  await proof(page, FEATURE, "08-narrow-peek");
  await page.mouse.click(400, 500);
  await expect(card(page)).toHaveCount(0);
  await page.setViewportSize({ height: 900, width: 1440 });
  await expect(card(page)).toBeVisible();

  // Someone the chat is shared with sees the same card.
  const chat = await conversationIdOf(page);
  const api = await apiFor(page, baseURL ?? "");
  const org =
    (await api.orgs.list())[0] ??
    (await api.orgs.create({ name: "Acme", slug: `acme-${tag}` }));
  // A fresh person each run, so the journey reruns on the same instance.
  const viewer = { ...users.cy, email: `cy-${tag}@e2e.test` };
  const invitation = await api.orgs.invite({
    email: viewer.email,
    orgId: org.id,
  });
  const cy = await browser.newContext({ baseURL, storageState: undefined });
  const cyPage = await cy.newPage();
  await cyPage.setViewportSize({ height: 900, width: 1440 });
  await cyPage.goto(`/invite/${invitation.token}`);
  await cyPage.getByRole("link", { name: "Create account" }).click();
  await signUp(cyPage, viewer);
  await cyPage
    .getByRole("button", { name: "Accept invitation" })
    .click({ timeout: 30_000 });
  const cyMe = await (await apiFor(cyPage, baseURL ?? "")).me.get();
  await api.grants.create({
    permission: "viewer",
    principal: { id: cyMe.user.id, type: "user" },
    resourceId: chat,
    resourceType: "conversation",
  });
  await cyPage.goto(`/c/${chat}`);
  await expect(card(cyPage).getByRole("button", { name: title })).toBeVisible();
  await proof(cyPage, FEATURE, "09-shared-viewer");
  await cy.close();
});
