import { expect, type Locator, type Page } from "@playwright/test";
import {
  type ConversationId,
  conversationIdSchema,
} from "@workspace/contract/schemas/common";

import { recordTiming } from "./timings";

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
  // The server renders a look-alike shell; type once the editor is live.
  await page.waitForFunction(
    () => performance.getEntriesByName("composer:ready", "mark").length > 0
  );
  await expect(input).toBeEditable();
  await input.click();
  await input.pressSequentially(text);
  if (measure) {
    await page.evaluate((token) => {
      const holder = window as unknown as { __firstToken?: Promise<number> };
      holder.__firstToken = new Promise<number>((resolve) => {
        let start = 0;
        document.addEventListener(
          "keydown",
          (event) => {
            if (event.key === "Enter") {
              start = performance.now();
            }
          },
          { capture: true, once: true }
        );
        const seen = () =>
          [...document.querySelectorAll(".is-assistant[data-message-id]")].some(
            (node) => (node.textContent ?? "").includes(token)
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
  }
};

/** The last assistant message, once it contains `text`. */
export const expectReply = async (page: Page, text: string | RegExp) => {
  const reply = assistantMessages(page).last();
  await expect(reply).toContainText(text, { timeout: 30_000 });
  return reply;
};
