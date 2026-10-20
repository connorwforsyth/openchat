import { expect } from "@playwright/test";
import { composerReady } from "../../../../e2e/support/chat";
import { HOME_URL } from "../../../../e2e/support/urls";
import { authState, proof } from "./evidence";
import { test } from "./fixtures";
import { rail, sidebar } from "./handles";

// Feature: rail and panels (features/rail.md): the rail switches the panel
// beside it between Chats, Scheduled, Library and Artifacts; the panel's top
// row holds the space switcher and the Dot entry; Toggle sidebar collapses
// the panel and the choice survives a reload.

test.use({ storageState: authState("ada") });

const LAYOUT_KEY = "chat-ui:layout";
const CHATS_BUTTON = /^Chats\b/;
const PERSONAL_SPACE = /^Personal/;
const DOTS_URL = /\/dots$/;

test("the rail switches panels, and the collapsed panel survives a reload", async ({
  page,
}) => {
  await page.goto("/");
  await composerReady(page);
  await expect(rail(page)).toBeVisible();
  await expect(
    sidebar(page).getByRole("navigation", { name: "Primary" })
  ).toBeVisible();
  await proof(page, "rail", "01-chats-panel");

  const panels = [
    { name: "Scheduled", path: "/schedules", shows: "Nothing scheduled yet." },
    { name: "Library", path: "/library", shows: "Shared with me" },
    { name: "Artifacts", path: "/artifacts", shows: "Nothing yet." },
  ] as const;
  for (const [index, panel] of panels.entries()) {
    const link = rail(page).getByRole("link", { name: panel.name });
    // biome-ignore lint/performance/noAwaitInLoops: each panel follows the last click.
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${panel.path}$`));
    await expect(link).toHaveAttribute("aria-current", "page");
    const nav = page.getByRole("navigation", { name: panel.name });
    await expect(nav.getByRole("heading", { name: panel.name })).toBeVisible();
    await expect(nav.getByText(panel.shows)).toBeVisible();
    await proof(page, "rail", `0${index + 2}-${panel.path.slice(1)}-panel`);
  }

  await rail(page).getByRole("button", { name: CHATS_BUTTON }).click();
  await expect(page).toHaveURL(HOME_URL);
  await expect(
    sidebar(page).getByRole("navigation", { name: "Primary" })
  ).toBeVisible();

  const spaces = page.getByTestId("space-switcher");
  await expect(spaces).toHaveAccessibleName("Space: Personal");
  await spaces.click();
  await expect(
    page.getByRole("menuitemradio", { name: PERSONAL_SPACE })
  ).toBeVisible();
  await proof(page, "rail", "05-space-switcher");
  await page.keyboard.press("Escape");

  await sidebar(page).getByRole("link", { name: "Make your Dot" }).click();
  await expect(page).toHaveURL(DOTS_URL);
  await expect(
    page.getByRole("heading", { name: "Meet your Dot" })
  ).toBeVisible();
  await proof(page, "rail", "06-dot-onboarding");

  await page.goto("/");
  await composerReady(page);
  const toggle = rail(page).getByRole("button", { name: "Toggle sidebar" });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await composerReady(page);
  await expect(toggle, "collapsed survives a reload").toHaveAttribute(
    "aria-expanded",
    "false"
  );
  const stored = await page.evaluate(
    (key) => localStorage.getItem(key),
    LAYOUT_KEY
  );
  await proof(page, "rail", "07-collapsed-after-reload", {
    [LAYOUT_KEY]: stored,
  });

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    sidebar(page).getByRole("navigation", { name: "Primary" })
  ).toBeVisible();
});
