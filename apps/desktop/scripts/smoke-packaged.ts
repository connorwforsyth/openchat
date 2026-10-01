import { type ChildProcess, spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FuseV1Options, getCurrentFuseWire } from "@electron/fuses";
import { type Browser, chromium, type Page } from "@playwright/test";

import { identityOf, readBrand } from "./brand";
import { PATHS } from "./builder-config";

// `bun run package:smoke` after `bun run desktop:package` (ticket 119): the
// packaged app, as a person gets it. Playwright's `_electron` can't drive it,
// since the fuses turn off the Node inspector it attaches through, so this
// launches the binary with Chromium's own debugging port and connects over
// CDP. It checks the fuses, that the first-run window appears, and, with
// `--instance <url>` (the e2e server, say), that connecting loads the
// server's page. Then it quits the app and leaves nothing running.

const appDir = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const instanceIndex = args.indexOf("--instance");
const instance = instanceIndex >= 0 ? args[instanceIndex + 1] : undefined;
const TIMEOUT_MS = 30_000;

function fail(message: string): never {
  throw new Error(message);
}

const brand = readBrand(process.env);
if (!brand.ok) {
  fail(brand.error.join("\n"));
}
const { name } = identityOf(brand.value.brand);

/** The packaged binary for this platform, as electron-builder lays it out. */
const binary = (): string => {
  const release = join(appDir, PATHS.output);
  const candidates = {
    darwin: [`mac-${process.arch}`, "mac", "mac-universal"].map((dir) =>
      join(release, dir, `${name}.app`, "Contents", "MacOS", name)
    ),
    linux: [
      join(
        release,
        "linux-unpacked",
        identityOf(brand.value.brand).executableName
      ),
    ],
    win32: [join(release, "win-unpacked", `${name}.exe`)],
  }[process.platform as "darwin" | "linux" | "win32"];
  return (
    candidates?.find((path) => existsSync(path)) ??
    fail(`no packaged app in ${release}; run \`bun run desktop:package\``)
  );
};

const until = async <T>(
  what: string,
  probe: () => T | undefined | Promise<T | undefined>
): Promise<T> => {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    // biome-ignore lint/performance/noAwaitInLoops: polling, one probe at a time
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    await new Promise((settle) => setTimeout(settle, 200));
  }
  return fail(`timed out waiting for ${what}`);
};

/** The wire's bytes: ASCII "1" and "0" (the package doesn't export its enum). */
const ON = 49;
const OFF = 48;

const checkFuses = async (path: string) => {
  const wire = await getCurrentFuseWire(path);
  const expected: [FuseV1Options, number][] = [
    [FuseV1Options.RunAsNode, OFF],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, OFF],
    [FuseV1Options.EnableNodeCliInspectArguments, OFF],
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, ON],
    [FuseV1Options.OnlyLoadAppFromAsar, ON],
  ];
  for (const [fuse, state] of expected) {
    if (Number(wire[fuse]) !== state) {
      fail(`fuse ${FuseV1Options[fuse]} is wrong: ${String(wire[fuse])}`);
    }
  }
  console.log("smoke: fuses ok");
};

const firstRunPage = async (browser: Browser): Promise<Page> =>
  until("the first-run window", () =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => page.url().endsWith("/renderer/index.html"))
  );

const main = async () => {
  const path = binary();
  await checkFuses(path);

  const userData = mkdtempSync(join(tmpdir(), "desktop-smoke-"));
  // No global shortcut: a test never takes a key from the person here.
  writeFileSync(
    join(userData, "settings.json"),
    JSON.stringify({ quickAi: { shortcut: null } })
  );
  let child: ChildProcess | undefined;
  let browser: Browser | undefined;
  try {
    child = spawn(path, ["--remote-debugging-port=0"], {
      // Its own process group, so quitting reaches every helper.
      detached: true,
      env: { ...process.env, DESKTOP_USER_DATA: userData },
      stdio: "ignore",
    });
    const exited = new Promise<number | null>((settle) =>
      child?.once("exit", settle)
    );
    // Chromium writes the port it chose into the user data folder.
    const portFile = join(userData, "DevToolsActivePort");
    const port = await until("the debugging port", () =>
      existsSync(portFile)
        ? readFileSync(portFile, "utf8").split("\n")[0] || undefined
        : undefined
    );
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const setup = await firstRunPage(browser);
    await setup.getByLabel("Server address").waitFor({ timeout: TIMEOUT_MS });
    console.log(`smoke: "${name}" launched; first-run window shown`);

    if (instance) {
      await setup.getByLabel("Server address").fill(instance);
      await setup.getByRole("button", { name: "Connect" }).click();
      const { origin } = new URL(instance);
      const page = await until("the instance's page", () =>
        browser
          ?.contexts()
          .flatMap((context) => context.pages())
          .find((each) => each.url().startsWith(origin))
      );
      await page.waitForLoadState("domcontentloaded");
      console.log(`smoke: connected; the window shows ${page.url()}`);
    }

    await browser.close();
    browser = undefined;
    process.kill(-(child.pid as number), "SIGTERM");
    const code = await Promise.race([
      exited,
      new Promise<"timeout">((settle) =>
        setTimeout(() => settle("timeout"), 10_000)
      ),
    ]);
    if (code === "timeout") {
      fail("the app didn't quit on SIGTERM");
    }
    child = undefined;
    console.log("smoke: quit cleanly");
  } finally {
    await browser?.close().catch(() => undefined);
    if (child?.pid && child.exitCode === null) {
      process.kill(-child.pid, "SIGKILL");
    }
    rmSync(userData, { force: true, recursive: true });
  }
};

await main();
