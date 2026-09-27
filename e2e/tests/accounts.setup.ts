import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import {
  type Browser,
  expect,
  type Page,
  test as setup,
} from "@playwright/test";

import { apiFor, saveWorld } from "../support/api";
import { clickHydrated, hydrated } from "../support/hydration";
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
// invitation; an org gets a team tree (Eng › Platform); the others join by
// invitation link. Every later spec starts from the browser state and the
// ids saved here.

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
  invitationId: string
) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto(`/invite/${invitationId}`);
  await expect(
    page.getByRole("heading", { name: "You've been invited" })
  ).toBeVisible();
  await page.getByRole("link", { name: "Create account" }).click();
  await expect(page).toHaveURL(SIGN_UP_FOR_INVITE_URL);
  await signUp(page, user);
  // Back on the invitation, now signed in, to accept it.
  await expect(page).toHaveURL(new RegExp(`/invite/${invitationId}`));
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

    // Orgs have no "create" screen yet (only the API); teams and invitations do.
    const org = await ada.orgs.create({ name: "Acme", slug: "acme" });

    await page.goto(`/admin/${org.id}/teams`);
    await expect(page.getByText("No teams yet")).toBeVisible();
    await page.getByLabel("Team name").fill("Eng");
    await clickHydrated(page.getByRole("button", { name: "Create team" }));
    await expect(page.getByText("Eng", { exact: true })).toBeVisible();
    await page.getByLabel("Team name").fill("Platform");
    await page.getByRole("combobox", { name: "Inside" }).click();
    await page.getByRole("option", { name: "Eng" }).click();
    await clickHydrated(page.getByRole("button", { name: "Create team" }));
    await expect(page.getByText("Platform", { exact: true })).toBeVisible();

    const teams = await ada.teams.list({ orgId: org.id });
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

    // Invite Ben from the members screen; the link is /invite/<id>.
    await page.goto(`/admin/${org.id}/members`);
    await page.getByLabel("Email").fill(users.ben.email);
    await clickHydrated(page.getByRole("button", { name: "Invite" }));
    await expect(page.getByText(users.ben.email)).toBeVisible();
    const invitations = await ada.orgs.listInvitations({ orgId: org.id });
    const benInvite = invitations.find(
      (invitation) => invitation.email === users.ben.email
    );
    expect(benInvite?.status).toBe("pending");
    if (!benInvite) {
      throw new Error("no invitation for Ben");
    }
    const cyInvite = await ada.orgs.invite({
      email: users.cy.email,
      orgId: org.id,
      teamIds: [eng.id],
    });

    const ben = await joinByInvite(browser, baseURL, users.ben, benInvite.id);
    const benMe = await (await apiFor(ben.page, baseURL)).me.get();
    expect(benMe.user.isAdmin).toBe(false);
    expect(benMe.orgs.map((each) => each.name)).toContain("Acme");

    const cy = await joinByInvite(browser, baseURL, users.cy, cyInvite.id);
    const cyMe = await (await apiFor(cy.page, baseURL)).me.get();
    expect(cyMe.teams.map((each) => each.team.name)).toContain("Eng");

    // Ben works in Platform (and so, through the tree, under Eng).
    await ada.teams.addMember({
      role: "member",
      teamId: platform.id,
      userId: benMe.user.id,
    });

    await saveState(page, "ada");
    await saveState(ben.page, "ben");
    await saveState(cy.page, "cy");
    await saveWorld({ eng: eng.id, orgId: org.id, platform: platform.id });
    await ben.context.close();
    await cy.context.close();
  }
);
