import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { expect } from "@playwright/test";
import { apiFor } from "../../../../e2e/support/api";
import { composer } from "../../../../e2e/support/chat";
import { clickHydrated } from "../../../../e2e/support/hydration";
import { HOME_URL, SIGN_IN_URL } from "../../../../e2e/support/urls";
import { signIn, signUp, users } from "../../../../e2e/support/users";
import { authState, proof } from "./evidence";
import { test } from "./fixtures";

// Feature: accounts (features/accounts.md). Runs first in every journey run:
// the instance starts with no users, so this sign-up makes the admin the
// other journeys sign in as.

test("first sign-up becomes admin; sign out and sign in again", async ({
  baseURL,
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(SIGN_IN_URL);
  await proof(page, "accounts", "01-signed-out-redirect");

  await page.goto("/sign-up");
  await expect(
    page.getByText(
      "The first account on a new server becomes its administrator"
    )
  ).toBeVisible();
  await signUp(page, users.ada);
  await expect(page).toHaveURL(HOME_URL);
  await expect(composer(page)).toBeVisible();
  const me = await (await apiFor(page, baseURL ?? "")).me.get();
  expect(me.user.isAdmin).toBe(true);
  await proof(page, "accounts", "02-signed-up-home", {
    email: me.user.email,
    isAdmin: me.user.isAdmin,
  });

  await clickHydrated(
    page.getByRole("button", { name: `Account: ${users.ada.name}` })
  );
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(SIGN_IN_URL);
  await proof(page, "accounts", "03-signed-out");

  const answer = await signIn(page, users.ada);
  expect(answer.status()).toBe(200);
  await expect(composer(page)).toBeVisible();
  await proof(page, "accounts", "04-signed-in-again");

  const path = authState("ada");
  await mkdir(dirname(path), { recursive: true });
  await page.context().storageState({ path });
});
