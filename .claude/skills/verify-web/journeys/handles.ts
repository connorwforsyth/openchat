import type { Locator, Page } from "@playwright/test";

// Stable handles on the signed-in shell, shared by the journeys. The repo's
// own helpers (e2e/support/chat.ts, users.ts, api.ts) cover the composer,
// messages, sign-in and API read-backs.

/** The panel beside the rail: the chat list, or a page's own panel. */
export const sidebar = (page: Page): Locator =>
  page.getByRole("complementary", { name: "Chats" });

/** The thin rail at the window's edge (wide screens only). */
export const rail = (page: Page): Locator =>
  page.getByRole("navigation", { name: "Sidebar rail" });

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A chat's row in the sidebar. Its accessible name is the title, plus a
 * status ("Unread", "Working", …) while the chat needs attention, which
 * also moves it into the Priority section.
 */
export const chatRow = (page: Page, title: string): Locator =>
  sidebar(page).getByRole("button", {
    name: new RegExp(
      `^${escapeRegExp(title)}( (Unread|Working|Waiting for your approval|The last run failed))?$`
    ),
  });

/** Full-screen settings: a modal dialog over whatever page opened it. */
export const settings = (page: Page): Locator =>
  page.getByRole("dialog", { name: "Settings" });
