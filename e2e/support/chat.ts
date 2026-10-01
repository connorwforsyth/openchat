import { expect, type Locator, type Page } from "@playwright/test";
import {
  type ConversationId,
  conversationIdSchema,
} from "@workspace/contract/schemas/common";

import { recordSendPhases, recordTiming, watchRequests } from "./timings";

// Driving the chat screen the way a person does: type in the composer,
// press Enter, watch the reply stream in.

export const composer = (page: Page): Locator =>
  page.getByRole("textbox", { name: "Message" });

export const assistantMessages = (page: Page): Locator =>
  page.locator(".is-assistant[data-message-id]");

export const userMessages = (page: Page): Locator =>
  page.locator(".is-user[data-message-id]");

const CHAT_PATH = /\/c\/([0-9a-f-]{36})/;

/** The conversation the page shows, once the address has one. */
export const conversationIdOf = async (page: Page): Promise<ConversationId> => {
  await expect(page).toHaveURL(CHAT_PATH);
  const match = CHAT_PATH.exec(page.url());
  return conversationIdSchema.parse(match?.[1]);
};

/**
 * Waits for the live composer. The server renders a look-alike shell, which
 * the editor replaces once it loads: a menu opened or a button pressed in
 * the shell is gone with it.
 */
export const composerReady = async (page: Page) => {
  await page.waitForFunction(
    () => performance.getEntriesByName("composer:ready", "mark").length > 0
  );
  await expect(composer(page)).toBeEditable();
};

/**
 * Types `text` and sends it with Enter. With `measure`, records first-token
 * latency: from the Enter keydown to the first streamed text of the reply
 * (`measure.token`) on screen, both timed inside the page.
 */
export const send = async (
  page: Page,
  text: string,
  {
    measure,
  }: {
    readonly measure?: { readonly token: string; readonly where: string };
  } = {}
) => {
  const input = composer(page);
  await composerReady(page);
  await input.click();
  await input.pressSequentially(text);
  if (measure) {
    await watchRequests(page);
    await page.evaluate((token) => {
      const holder = window as unknown as {
        __firstToken?: Promise<number>;
        __sentAt?: number;
      };
      holder.__firstToken = new Promise<number>((resolve) => {
        let start = 0;
        document.addEventListener(
          "keydown",
          (event) => {
            if (event.key === "Enter") {
              start = performance.now();
              holder.__sentAt = start;
            }
          },
          { capture: true, once: true }
        );
        // Only answers that weren't on screen before this send count.
        const earlier = new Set(
          [...document.querySelectorAll(".is-assistant[data-message-id]")].map(
            (node) => node.getAttribute("data-message-id")
          )
        );
        const seen = () =>
          [...document.querySelectorAll(".is-assistant[data-message-id]")].some(
            (node) =>
              !earlier.has(node.getAttribute("data-message-id")) &&
              (node.textContent ?? "").includes(token)
          );
        const observer = new MutationObserver(() => {
          if (start > 0 && seen()) {
            observer.disconnect();
            resolve(performance.now() - start);
          }
        });
        observer.observe(document.body, {
          characterData: true,
          childList: true,
          subtree: true,
        });
      });
    }, measure.token);
  }
  await input.press("Enter");
  if (measure) {
    const latency = await page.evaluate(
      () =>
        (window as unknown as { __firstToken: Promise<number> }).__firstToken
    );
    await recordTiming("first token", latency, measure.where);
    const sentAt = await page.evaluate(
      () => (window as unknown as { __sentAt: number }).__sentAt
    );
    await recordSendPhases(page, sentAt, measure.where);
  }
};

/** The last assistant message, once it contains `text`. */
export const expectReply = async (page: Page, text: string | RegExp) => {
  const reply = assistantMessages(page).last();
  await expect(reply).toContainText(text, { timeout: 30_000 });
  return reply;
};

/** The chat header (D14): title and branches at the start, Share and Workspace at the end. */
export const chatHeader = (page: Page): Locator =>
  page.locator('[data-slot="app-header"]');

/**
 * The composer's chat context chip, showing `label`. It's there only until
 * the first message locks the context; wait for `composerReady` before
 * opening it, or the menu goes with the shell.
 */
export const contextChip = (page: Page, label: string): Locator =>
  page
    .locator('[data-slot="composer"]')
    .getByRole("button", { name: `Chat context: ${label}` });

/** Opens the header's Share menu and returns its locked "Chat context" group. */
export const lockedContext = async (page: Page): Promise<Locator> => {
  await chatHeader(page).getByRole("button", { name: "Share" }).click();
  return page.getByRole("group", { name: "Chat context" });
};

/**
 * Opens the chat's Workspace panel from the header (060: one panel with the
 * files, preview and artifacts; no tabs) and returns it.
 */
export const openWorkspace = async (page: Page): Promise<Locator> => {
  const toggle = chatHeader(page).getByRole("button", { name: "Workspace" });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") {
    await toggle.click();
  }
  return page.getByRole("region", { name: "Workspace" });
};

const ANY_TARGET = /^Model or agent:/;

/** The composer's model and agent picker, showing `label`. */
export const targetPicker = (page: Page, label?: string): Locator =>
  page.getByRole("button", {
    name: label === undefined ? ANY_TARGET : `Model or agent: ${label}`,
  });

/**
 * Picks what answers from the composer's picker: `name` in the menu group
 * labelled `group` ("My agents", "Shared with me", "Team & org agents", or
 * a provider).
 */
export const pickTarget = async (
  page: Page,
  { group, name }: { readonly group: string; readonly name: string }
) => {
  await composerReady(page);
  await targetPicker(page).click();
  await page
    .getByRole("group", { name: group })
    .getByRole("menuitemradio", { name })
    .click();
  await expect(targetPicker(page, name)).toBeVisible();
};
