import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Page } from "@playwright/test";

// Proof artifacts for one journey step: a screenshot, the page's ARIA
// snapshot, and (optionally) the read-back side effect as JSON. They go to
// <run dir>/evidence/<feature>/, which cleanup keeps.

const runDir = (): string => {
  const dir = process.env.VERIFY_RUN_DIR;
  if (!dir) {
    throw new Error(
      "VERIFY_RUN_DIR is unset; run through playwright.verify.config.ts"
    );
  }
  return dir;
};

/** Where a journey's saved sign-in state lives (scratch; cleanup deletes it). */
export const authState = (name: string): string =>
  join(runDir(), "auth", `${name}.json`);

export const proof = async (
  page: Page,
  feature: string,
  step: string,
  sideEffect?: unknown
): Promise<void> => {
  const dir = join(runDir(), "evidence", feature);
  await mkdir(dir, { recursive: true });
  // Playwright's default `caret: "hide"` writes an inline caret-color onto
  // every textarea; on a page that hasn't hydrated yet React reports that as
  // a hydration mismatch. "initial" leaves the DOM alone.
  await page.screenshot({
    caret: "initial",
    fullPage: true,
    path: join(dir, `${step}.png`),
  });
  const aria = await page.locator("body").ariaSnapshot();
  await writeFile(
    join(dir, `${step}.aria.txt`),
    `url: ${page.url()}\n${aria}\n`
  );
  if (sideEffect !== undefined) {
    await writeFile(
      join(dir, `${step}.json`),
      `${JSON.stringify(sideEffect, null, 2)}\n`
    );
  }
};
