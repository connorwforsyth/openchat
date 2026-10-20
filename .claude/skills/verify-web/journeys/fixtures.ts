import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { test as base } from "@playwright/test";

// Every journey imports `test` from here. In dev mode Next draws its error
// overlay (<nextjs-portal>) over the page on any console error, such as a
// hydration mismatch, and it swallows clicks. The overlay is hidden so the
// journey can go on, and every console error and page error is appended to
// <run dir>/evidence/console-errors.log, which a report must mention.

export const test = base.extend<{ consoleLog: undefined }>({
  consoleLog: [
    async ({ page }, use, info) => {
      const dir = join(process.env.VERIFY_RUN_DIR ?? "", "evidence");
      await mkdir(dir, { recursive: true });
      const file = join(dir, "console-errors.log");
      const log = (kind: string, text: string) =>
        appendFile(file, `[${info.title}] ${kind}: ${text}\n`).catch(
          () => undefined
        );
      page.on("console", (message) => {
        if (message.type() === "error") {
          log("console.error", message.text().slice(0, 8000));
        }
      });
      page.on("pageerror", (error) => {
        log("pageerror", error.message.slice(0, 8000));
      });
      await page.addInitScript(() => {
        const hide = () => {
          const style = document.createElement("style");
          style.textContent = "nextjs-portal { display: none !important; }";
          document.head.append(style);
        };
        if (document.head) {
          hide();
        } else {
          document.addEventListener("DOMContentLoaded", hide, { once: true });
        }
      });
      await use(undefined);
    },
    { auto: true },
  ],
});
