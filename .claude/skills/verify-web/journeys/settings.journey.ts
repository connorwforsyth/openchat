import { expect } from "@playwright/test";
import { apiFor } from "../../../../e2e/support/api";
import { composerReady } from "../../../../e2e/support/chat";
import { clickHydrated } from "../../../../e2e/support/hydration";
import { HOME_URL } from "../../../../e2e/support/urls";
import { users } from "../../../../e2e/support/users";
import { authState, proof } from "./evidence";
import { test } from "./fixtures";
import { rail, settings, sidebar } from "./handles";

// Feature: full-screen settings (features/settings.md): settings open over
// the page from the account menu, ⌘, or their address, fill the window,
// switch sections in place, and close back to where they were opened. The
// Appearance section's sidebar layout changes the shell behind them.

test.use({ storageState: authState("ada") });

const PROFILE_URL = /\/settings(\/profile)?$/;
const KEYS_URL = /\/settings\/keys$/;
const APPEARANCE_URL = /\/settings\/appearance$/;

test("settings open full screen, switch sections, change the layout, and close back", async ({
  baseURL,
  page,
}) => {
  const me = await (await apiFor(page, baseURL ?? "")).me.get();
  const layoutKey = `sidebar-layout:${me.user.id}`;
  await page.goto("/");
  await composerReady(page);

  await clickHydrated(
    page.getByRole("button", { name: `Account: ${users.ada.name}` })
  );
  await page.getByRole("menuitem", { name: "Settings" }).click();
  const view = settings(page);
  await expect(view).toBeVisible();
  await expect(page).toHaveURL(PROFILE_URL);
  await expect(view.getByText(users.ada.email)).toBeVisible();
  const viewport = page.viewportSize();
  const box = await view.boundingBox();
  expect(box, "settings fill the window").toMatchObject({
    height: viewport?.height,
    width: viewport?.width,
    x: 0,
    y: 0,
  });
  await proof(page, "settings", "01-open-from-account-menu");

  const sections = view.getByRole("navigation", { name: "Settings sections" });
  await sections.getByRole("button", { name: "Provider keys" }).click();
  await expect(page).toHaveURL(KEYS_URL);
  await expect(
    view.getByRole("heading", { level: 1, name: "Provider keys" })
  ).toBeVisible();
  await proof(page, "settings", "02-section-keys");

  await sections.getByRole("button", { name: "Appearance" }).click();
  await expect(page).toHaveURL(APPEARANCE_URL);
  const layout = view.getByRole("group", { name: "Sidebar layout" });
  await layout.getByRole("button", { name: "Classic" }).click();
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), layoutKey))
    .toContain("classic");
  await proof(page, "settings", "03-layout-classic", {
    [layoutKey]: await page.evaluate(
      (key) => localStorage.getItem(key),
      layoutKey
    ),
  });

  await view.getByRole("button", { name: "Back to app" }).click();
  await expect(view).toBeHidden();
  await expect(page).toHaveURL(HOME_URL);
  await expect(rail(page), "Classic has no rail").toBeHidden();
  await expect(
    sidebar(page)
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Library" })
  ).toBeVisible();
  await proof(page, "settings", "04-classic-shell");

  // The shortcuts load after boot, as the palette's do; retry until bound.
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+Comma");
    await expect(view).toBeVisible({ timeout: 1000 });
  }).toPass();
  await sections.getByRole("button", { name: "Appearance" }).click();
  await layout.getByRole("button", { name: "Rail (recommended)" }).click();
  await page.keyboard.press("Escape");
  await expect(view).toBeHidden();
  await expect(page).toHaveURL(HOME_URL);
  await expect(rail(page)).toBeVisible();
  await proof(page, "settings", "05-rail-again");

  await page.goto("/settings/memory");
  await expect(view).toBeVisible();
  await expect(
    view.getByRole("heading", { level: 1, name: "Memory" })
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(view).toBeHidden();
  await expect(page).toHaveURL(HOME_URL);
  await proof(page, "settings", "06-address-closes-to-home");
});
