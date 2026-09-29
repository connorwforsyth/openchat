import { expect, test } from "@playwright/test";

import { createOrg, createTeam } from "../support/admin";
import { apiFor, loadWorld } from "../support/api";
import { composerReady, contextChip } from "../support/chat";
import { storageStateFor, users } from "../support/users";

// Orgs from the UI (044, D17): anyone can make one from the account menu and
// becomes its owner; the admin heading switches between the orgs you run;
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

  // Switch to Acme from the heading, on the same admin page…
  await page.getByRole("link", { name: "Members" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${beta}/members$`));
  await page.getByRole("button", { name: "Organisation: Beta Labs" }).click();
  await page.getByRole("menuitemradio", { name: "Acme" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${world.orgId}/members$`));
  await expect(
    page.getByRole("button", { name: "Organisation: Acme" })
  ).toBeVisible();
  await expect(page.getByText(users.ben.email)).toBeVisible();

  // …and back.
  await page.getByRole("button", { name: "Organisation: Acme" }).click();
  await page.getByRole("menuitemradio", { name: "Beta Labs" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${beta}/members$`));

  // The new org is a chat context too (D17).
  await page.goto("/");
  await composerReady(page);
  await contextChip(page, "Personal").click();
  await expect(
    page.getByRole("menuitemradio", { name: "Beta Labs" })
  ).toBeVisible();
  await page.keyboard.press("Escape");
});
