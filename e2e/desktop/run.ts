import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// `test:desktop`: runs the Electron smoke test where it can run. macOS only
// for now (ticket 122: macOS first), and only with the electron package
// installed; elsewhere it says why and passes, so the task is safe to run
// anywhere. Extra arguments go to Playwright.

const here = dirname(fileURLToPath(import.meta.url));

const electronInstalled = () => {
  try {
    createRequire(join(here, "../../apps/desktop/package.json")).resolve(
      "electron/package.json"
    );
    return true;
  } catch {
    return false;
  }
};

if (process.platform !== "darwin") {
  console.log("test:desktop: skipped, the desktop smoke test runs on macOS");
  process.exit(0);
}
if (!electronInstalled()) {
  console.log("test:desktop: skipped, electron isn't installed (bun install)");
  process.exit(0);
}

const result = spawnSync(
  "bunx",
  [
    "playwright",
    "test",
    "--config",
    join(here, "playwright.config.ts"),
    ...process.argv.slice(2),
  ],
  { cwd: here, stdio: "inherit" }
);
process.exit(result.status ?? 1);
