import { expect, test } from "@playwright/test";

import { createOrg, createTeam } from "../support/admin";
import { apiFor, loadWorld } from "../support/api";
import { composerReady, contextControl } from "../support/chat";
import { storageStateFor, users } from "../support/users";

// Orgs from the UI (044, D17): anyone can make one from the account menu and
// becomes its owner; Space settings follow the space you switch to;
// teams nest as deep as the org chart goes.

test.use({ storageState: storageStateFor("ada") });

test("a second org from the account menu, a nested team tree, and switching between orgs", async ({
  baseURL,
  page,
}) => {
  const world = await loadWorld();
  await page.goto("/");
  const beta = await createOrg(page, {
    name: "Beta Labs",
    owner: users.ada.name,
  });
  expect(beta).not.toBe(world.orgId);

  await createTeam(page, { name: "Research" });
  await createTeam(page, { name: "Vision", parent: "Research" });
  await createTeam(page, { name: "Robotics", parent: "— Vision" });

  const api = await apiFor(page, baseURL ?? "");
  const teams = await api.teams.list({ orgId: beta });
  const byName = new Map(teams.map((team) => [team.name, team]));
  expect(byName.get("Research")?.parentId).toBeNull();
  expect(byName.get("Vision")?.parentId).toBe(byName.get("Research")?.id);
  expect(byName.get("Robotics")?.parentId).toBe(byName.get("Vision")?.id);
  const me = await api.me.get();
  expect(
    me.orgs.find((org) => org.id === beta)?.myRole,
    "the creator owns the new org"
  ).toBe("owner");

  // Space settings follow the active space: a link to Acme's switches to
  // it, and the space switcher in the sidebar offers both (187).
  await page.goto(`/settings/space-members?space=org:${world.orgId}`);
  await expect(
    page.getByRole("heading", { name: "Space: Acme" })
  ).toBeVisible();
  await expect(page.getByText(users.ben.email)).toBeVisible();
  await page.getByRole("button", { name: "Back to app" }).click();
  await page.getByTestId("space-switcher").click();
  await expect(
    page.getByRole("menuitemradio", { name: "Beta Labs" })
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // The new org is a chat context too (D17).
  await page.goto("/");
  await composerReady(page);
  await contextControl(page, "Personal").click();
  await expect(
    page.getByRole("menuitemradio", { name: "Beta Labs" })
  ).toBeVisible();
  await page.keyboard.press("Escape");
});
