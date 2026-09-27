import type { Page } from "@playwright/test";

import { hydrated } from "./hydration";

// The accounts the suite creates, on a server that starts empty every run
// (e2e/support/serve.ts). Throwaway test values for that server only.

export interface TestUser {
  readonly email: string;
  readonly name: string;
  readonly password: string;
}

const PASSWORD = "e2e-only-password-7Kq2";

export const users = {
  /** The first sign-up: instance admin and owner of the Acme org. */
  ada: { email: "ada@e2e.test", name: "Ada Admin", password: PASSWORD },
  /** Joins by invite into Eng › Platform. */
  ben: { email: "ben@e2e.test", name: "Ben Builder", password: PASSWORD },
  /** Joins by invite into Eng; publishes an agent, then is removed. */
  cy: { email: "cy@e2e.test", name: "Cy Author", password: PASSWORD },
} as const satisfies Record<string, TestUser>;

export type UserName = keyof typeof users;

/** Where each account's signed-in browser state is saved by accounts.setup.ts. */
export const storageStateFor = (name: UserName): string =>
  new URL(`../.auth/${name}.json`, import.meta.url).pathname;

/**
 * Clicks an auth form's submit button and waits for Better Auth's answer.
 * Sign-in and sign-up are rate limited (3 per 10 s per client address, and
 * every browser here is the same address, 127.0.0.1), so a 429 waits out
 * `X-Retry-After` and submits again, as a patient person would.
 */
const AUTH_SUBMIT = /\/api\/auth\/sign-(in|up)\//;

const submitAuth = async (page: Page, button: string) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const answer = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        AUTH_SUBMIT.test(candidate.url())
    );
    const submit = page.getByRole("button", { exact: true, name: button });
    // biome-ignore lint/performance/noAwaitInLoops: each retry follows the last answer.
    await (await hydrated(submit)).click();
    const response = await answer;
    if (response.status() !== 429) {
      return response;
    }
    const seconds = Number(response.headers()["x-retry-after"] ?? "10");
    await page.waitForTimeout(seconds * 1000 + 250);
  }
  throw new Error(`${button}: still rate limited after 5 attempts`);
};

export const signIn = async (page: Page, user: TestUser, next = "/") => {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  return submitAuth(page, "Sign in");
};

/** Fills and submits the sign-up form on the current page. */
export const signUp = async (page: Page, user: TestUser) => {
  await page.getByLabel("Name").fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  return submitAuth(page, "Create account");
};
