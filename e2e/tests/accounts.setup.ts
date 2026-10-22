import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import {
  type Browser,
  expect,
  type Page,
  test as setup,
} from "@playwright/test";

import { createOrg, createTeam, invite } from "../support/admin";
import { apiFor, saveWorld } from "../support/api";
import { hydrated } from "../support/hydration";
import { HOME_URL, SIGN_IN_URL, SIGN_UP_FOR_INVITE_URL } from "../support/urls";
import {
  signUp,
  storageStateFor,
  type TestUser,
  type UserName,
  users,
} from "../support/users";

// PLAN.md §11 M1 steps 1 and 2 on a server that has never had a user:
// the first sign-up becomes the admin; nobody else gets in without an
// invitation; an org, made from the account menu, gets a team tree
// (Eng › Platform); the others join by the invite links Members shows, each
// into a team. All through the UI (044); the API only reads back. Every
// later spec starts from the browser state and the ids saved here.

// Four sign-ups inside Better Auth's sign-up rate limit window (3 per 10 s)
// wait some of it out (support/users.ts), so this takes longer than most.
setup.describe.configure({ mode: "serial", timeout: 180_000 });

const saveState = async (page: Page, name: UserName) => {
  const path = storageStateFor(name);
  await mkdir(dirname(path), { recursive: true });
  await page.context().storageState({ path });
};

/** Signs a new browser up through the invitation link, and accepts it. */
const joinByInvite = async (
  browser: Browser,
  baseURL: string,
  user: TestUser,
  link: string
) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto(link);
  await expect(
    page.getByRole("heading", { name: "You've been invited" })
  ).toBeVisible();
  await page.getByRole("link", { name: "Create account" }).click();
  await expect(page).toHaveURL(SIGN_UP_FOR_INVITE_URL);
  await signUp(page, user);
  // Back on the invitation, now signed in, to accept it.
  await expect(page).toHaveURL(new RegExp(`${new URL(link).pathname}$`));
  await (
    await hydrated(page.getByRole("button", { name: "Accept invitation" }))
  ).click();
  await expect(page).toHaveURL(HOME_URL);
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  return { context, page };
};

setup(
  "the first sign-up becomes the admin; the org gets a team tree; others join by invite",
  async ({ baseURL, browser, page }) => {
    if (!baseURL) {
      throw new Error("baseURL is required");
    }
    // Signed out, the app sends you to sign in.
    await page.goto("/");
    await expect(page).toHaveURL(SIGN_IN_URL);

    await page.goto("/sign-up");
    await expect(
      page.getByText(
        "The first account on a new server becomes its administrator"
      )
    ).toBeVisible();
    await signUp(page, users.ada);
    await expect(page).toHaveURL(HOME_URL);
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();

    const ada = await apiFor(page, baseURL);
    const adaMe = await ada.me.get();
    expect(adaMe.user.isAdmin).toBe(true);

    // An org from the account menu (044); it opens on its (empty) sub-spaces.
    const orgId = await createOrg(page, {
      name: "Acme",
      owner: users.ada.name,
    });
    await expect(page.getByText("No sub-spaces yet")).toBeVisible();
    await createTeam(page, { name: "Eng" });
    await createTeam(page, { name: "Platform", parent: "Eng" });

    const teams = await ada.teams.list({ orgId });
    const eng = teams.find((team) => team.name === "Eng");
    const platform = teams.find((team) => team.name === "Platform");
    expect(eng?.parentId).toBeNull();
    expect(platform?.parentId).toBe(eng?.id);
    if (!(eng && platform)) {
      throw new Error("the team tree wasn't created");
    }

    // A second person can't just sign up: the server is invite-only now.
    const stranger = await browser.newContext({ baseURL });
    const strangerPage = await stranger.newPage();
    await strangerPage.goto("/sign-up");
    await signUp(strangerPage, users.ben);
    await expect(
      strangerPage.getByText("This server is invite-only")
    ).toBeVisible();
    await stranger.close();

    // Invitations from Members, each into a team; the page shows the
    // one-time link, and its Copy button puts it on the clipboard (042's
    // token: /invite/<token>).
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: baseURL,
      });
    await page.goto(`/admin/${orgId}/members`);
    const benLink = await invite(page, {
      email: users.ben.email,
      team: "Platform",
    });
    await page.getByRole("button", { name: "Copy" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      benLink
    );
    const cyLink = await invite(page, { email: users.cy.email, team: "Eng" });
    expect(cyLink).not.toBe(benLink);
    const invitations = await ada.orgs.listInvitations({ orgId });
    expect(
      invitations
        .filter((invitation) => invitation.status === "pending")
        .map((invitation) => [invitation.email, invitation.teamIds])
    ).toEqual(
      expect.arrayContaining([
        [users.ben.email, [platform.id]],
        [users.cy.email, [eng.id]],
      ])
    );

    // Ben works in Platform (and so, through the tree, under Eng); Cy in Eng.
    const ben = await joinByInvite(browser, baseURL, users.ben, benLink);
    const benMe = await (await apiFor(ben.page, baseURL)).me.get();
    expect(benMe.user.isAdmin).toBe(false);
    expect(benMe.orgs.map((each) => each.name)).toContain("Acme");
    expect(benMe.teams.map((each) => each.team.name)).toContain("Platform");

    const cy = await joinByInvite(browser, baseURL, users.cy, cyLink);
    const cyMe = await (await apiFor(cy.page, baseURL)).me.get();
    expect(cyMe.teams.map((each) => each.team.name)).toContain("Eng");

    await saveState(page, "ada");
    await saveState(ben.page, "ben");
    await saveState(cy.page, "cy");
    await saveWorld({ eng: eng.id, orgId, platform: platform.id });
    await ben.context.close();
    await cy.context.close();
  }
);
