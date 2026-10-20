import { expect, type Page } from "@playwright/test";
import { type OrgId, orgIdSchema } from "@workspace/contract/schemas/common";

import { clickHydrated } from "./hydration";

// The admin screens as a person uses them: the account menu's "New
// organisation", the team tree, and invitations from Members (044). They
// live in Space settings now (187), over the app, for the active space.

const SPACE_SETTINGS_URL =
  /\/settings\/space-subspaces\?space=org(?::|%3A)([0-9a-f-]{36})$/;
const INVITE_LINK = /\/invite\/[A-Za-z0-9_-]{32,}$/;

/** Opens the account menu in the sidebar footer. */
export const openAccountMenu = async (page: Page, name: string) => {
  await clickHydrated(page.getByRole("button", { name: `Account: ${name}` }));
};

/** Creates an org from the account menu; the app lands on its sub-spaces. */
export const createOrg = async (
  page: Page,
  { name, owner }: { readonly name: string; readonly owner: string }
): Promise<OrgId> => {
  await openAccountMenu(page, owner);
  await page.getByRole("menuitem", { name: "New organisation" }).click();
  const dialog = page.getByRole("dialog", { name: "New organisation" });
  await dialog.getByLabel("Organisation name").fill(name);
  await dialog.getByRole("button", { name: "Create organisation" }).click();
  await expect(page).toHaveURL(SPACE_SETTINGS_URL);
  await expect(
    page.getByRole("heading", { name: `Space: ${name}` })
  ).toBeVisible();
  return orgIdSchema.parse(SPACE_SETTINGS_URL.exec(page.url())?.[1]);
};

/** Adds a team on the teams page, top level or inside `parent`. */
export const createTeam = async (
  page: Page,
  { name, parent }: { readonly name: string; readonly parent?: string }
) => {
  await page.getByLabel("Team name").fill(name);
  if (parent) {
    await page.getByRole("combobox", { name: "Inside" }).click();
    await page.getByRole("option", { exact: true, name: parent }).click();
  }
  await clickHydrated(page.getByRole("button", { name: "Create team" }));
  await expect(page.getByText(name, { exact: true })).toBeVisible();
};

/**
 * Invites `email` from the members page (into `team`, if given) and
 * returns the one-time invite link the page shows.
 */
export const invite = async (
  page: Page,
  { email, team }: { readonly email: string; readonly team?: string }
): Promise<string> => {
  await page.getByLabel("Email").fill(email);
  if (team) {
    await page.getByRole("combobox", { exact: true, name: "Team" }).click();
    await page.getByRole("option", { name: team }).click();
  }
  await clickHydrated(page.getByRole("button", { name: "Invite" }));
  await expect(page.getByText(email)).toBeVisible();
  const link = page.getByLabel("Invite link");
  await expect(link).toHaveValue(INVITE_LINK);
  return await link.inputValue();
};
