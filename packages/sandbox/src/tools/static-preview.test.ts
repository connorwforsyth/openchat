import { type ChildProcess, spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureId } from "@workspace/contract/fixtures";
import type { SandboxId } from "@workspace/contract/schemas/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createJustBashSandbox } from "../just-bash/provider";
import { createMemorySandbox } from "../ports/sandbox.memory";
import { createDockerLikeEntry, previewUrlFor } from "../testing/docker-like";
import {
  ensureStaticPreview,
  isStaticPage,
  previewStaticPage,
  STATIC_PREVIEW_PORT,
  STATIC_PREVIEW_SCRIPT_PATH,
} from "./static-preview";
import { STATIC_PREVIEW_SERVER } from "./static-preview-server";

const id = fixtureId("sandbox", 1) as SandboxId;
const noSleep = () => Promise.resolve();
const START_COMMAND =
  /^nohup node \/home\/sandbox\/\.static-preview\.mjs \/work 4747 > \S+ 2>&1 < \/dev\/null &$/;
const LISTENING_ON = /on port (\d+)/;

/** A running Docker-like sandbox and the host behind it. */
const dockerLike = async () => {
  const { entry, host } = createDockerLikeEntry(false);
  const created = await entry.factory.create({
    conversationId: fixtureId("conversation", 1),
    id,
    limits: entry.limits,
  });
  if (!created.ok) {
    throw new Error("the fake didn't start");
  }
  return { host, sandbox: created.value };
};

const starts = (commands: readonly string[]) =>
  commands.filter((command) => command.startsWith("nohup node"));

describe("ensureStaticPreview", () => {
  it("writes the server outside /work, starts it, and exposes its port", async () => {
    const { host, sandbox } = await dockerLike();
    expect(await ensureStaticPreview(sandbox, { sleep: noSleep })).toEqual({
      ok: true,
      value: { port: STATIC_PREVIEW_PORT, url: previewUrlFor(id, 4747) },
    });
    const script = await sandbox.readFile(STATIC_PREVIEW_SCRIPT_PATH);
    expect(script.ok && new TextDecoder().decode(script.value)).toBe(
      STATIC_PREVIEW_SERVER
    );
    expect(STATIC_PREVIEW_SCRIPT_PATH.startsWith("/work/")).toBe(false);
    expect(starts(host.commands)).toEqual([
      expect.stringMatching(START_COMMAND),
    ]);
    expect([...(host.exposed.get(id) ?? [])]).toEqual([4747]);
  });

  it("reuses a server that's already listening", async () => {
    const { host, sandbox } = await dockerLike();
    await ensureStaticPreview(sandbox, { sleep: noSleep });
    const again = await ensureStaticPreview(sandbox, { sleep: noSleep });
    expect(again.ok && again.value?.port).toBe(STATIC_PREVIEW_PORT);
    expect(starts(host.commands)).toHaveLength(1);
    // Exposed both times: the runner may have forgotten it in between.
    expect(host.exposeCalls.get(id)).toBe(2);
  });

  it("starts it again after the sandbox stopped", async () => {
    const { host, sandbox } = await dockerLike();
    await ensureStaticPreview(sandbox, { sleep: noSleep });
    host.listening.clear();
    await ensureStaticPreview(sandbox, { sleep: noSleep });
    expect(starts(host.commands)).toHaveLength(2);
  });

  it("does nothing where there are no ports (just-bash)", async () => {
    const justBash = await createJustBashSandbox({ id });
    expect(await ensureStaticPreview(justBash)).toEqual({
      ok: true,
      value: null,
    });
    const memory = createMemorySandbox({ id });
    const commands: string[] = [];
    const watched = {
      ...memory,
      exec: (command: string) => {
        commands.push(command);
        return memory.exec(command);
      },
    };
    expect(await ensureStaticPreview(watched)).toEqual({
      ok: true,
      value: null,
    });
    expect(commands).toEqual([]);
    expect(memory.files().has(STATIC_PREVIEW_SCRIPT_PATH)).toBe(false);
  });

  it("says so when the server doesn't come up, and exposes nothing", async () => {
    const { host, sandbox } = await dockerLike();
    host.serverStarts = false;
    const result = await ensureStaticPreview(sandbox, { sleep: noSleep });
    expect(result).toEqual({
      error: expect.stringContaining("didn't come up"),
      ok: false,
    });
    expect(host.exposeCalls.get(id)).toBeUndefined();
  });
});

describe("previewStaticPage", () => {
  const recorder = () => {
    const recorded: unknown[] = [];
    const logged: string[] = [];
    return {
      logged,
      options: {
        log: (message: string) => logged.push(message),
        record: (sandboxId: SandboxId, exposed: object) => {
          recorded.push({ sandboxId, ...exposed });
          return Promise.resolve();
        },
        sleep: noSleep,
      },
      recorded,
    };
  };

  it("only reacts to pages", async () => {
    expect(["index.html", "/work/a/B.HTM", "x.html"].every(isStaticPage)).toBe(
      true
    );
    expect(
      ["app.css", "main.js", "html", "a.html.txt"].some(isStaticPage)
    ).toBe(false);
    const { host, sandbox } = await dockerLike();
    const { options, recorded } = recorder();
    await previewStaticPage(sandbox, "style.css", options);
    expect(host.commands).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it("records the preview for a page", async () => {
    const { sandbox } = await dockerLike();
    const { options, recorded } = recorder();
    await previewStaticPage(sandbox, "site/index.html", options);
    expect(recorded).toEqual([
      { port: 4747, sandboxId: id, url: previewUrlFor(id, 4747) },
    ]);
  });

  it("logs a failure instead of passing it on", async () => {
    const { host, sandbox } = await dockerLike();
    host.failExpose = true;
    const { logged, options, recorded } = recorder();
    await expect(
      previewStaticPage(sandbox, "index.html", options)
    ).resolves.toBeUndefined();
    expect(recorded).toEqual([]);
    expect(logged).toEqual([
      expect.stringContaining("couldn't expose the port"),
    ]);

    host.failExpose = false;
    const throwing = {
      ...options,
      record: () => Promise.reject(new Error("database is down")),
    };
    await expect(
      previewStaticPage(sandbox, "index.html", throwing)
    ).resolves.toBeUndefined();
    expect(logged.at(-1)).toContain("database is down");
  });
});

// The server itself, run by this machine's Node against a temporary
// directory, as the sandbox runs it against /work.
describe("the static preview server", () => {
  let dir: string;
  let outside: string;
  let server: ChildProcess;
  let port: number;

  const get = (
    path: string,
    method = "GET"
  ): Promise<{
    body: string;
    headers: Record<string, string | string[] | undefined>;
    status: number;
  }> =>
    new Promise((resolve, reject) => {
      // node:http sends the path as given, unnormalised, like a hostile client.
      const req = request({ host: "127.0.0.1", method, path, port }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () =>
          resolve({ body, headers: res.headers, status: res.statusCode ?? 0 })
        );
      });
      req.on("error", reject);
      req.end();
    });

  const startServer = (script: string, listenOn: number) =>
    spawn(process.execPath, [script, join(dir, "work"), String(listenOn)], {
      stdio: ["ignore", "pipe", "pipe"],
    });

  beforeAll(async () => {
    const base = await realpath(
      await mkdtemp(join(tmpdir(), "static-preview-"))
    );
    dir = base;
    outside = join(base, "secret.txt");
    await mkdir(join(base, "work", "sub"), { recursive: true });
    await mkdir(join(base, "work", "bare"), { recursive: true });
    await writeFile(join(base, "work", "index.html"), "<h1>home</h1>");
    await writeFile(join(base, "work", "style.css"), "h1 { color: red }");
    await writeFile(join(base, "work", "app.mjs"), "export {};");
    await writeFile(join(base, "work", "logo.svg"), "<svg/>");
    await writeFile(join(base, "work", "data.bin"), "\u0000");
    await writeFile(join(base, "work", "sub", "index.html"), "<h1>sub</h1>");
    await writeFile(outside, "not for the preview");
    await symlink(outside, join(base, "work", "link.txt"));
    const script = join(base, "server.mjs");
    await writeFile(script, STATIC_PREVIEW_SERVER);
    server = startServer(script, 0);
    port = await new Promise<number>((resolve, reject) => {
      let out = "";
      server.stdout?.on("data", (chunk: Buffer) => {
        out += chunk.toString();
        const match = LISTENING_ON.exec(out);
        if (match) {
          resolve(Number(match[1]));
        }
      });
      server.on("exit", (code) => reject(new Error(`server exited ${code}`)));
    });
  });

  afterAll(async () => {
    server?.kill();
    await rm(dir, { force: true, recursive: true });
  });

  it("serves files with their types, and no caching", async () => {
    const home = await get("/");
    expect(home).toMatchObject({ body: "<h1>home</h1>", status: 200 });
    expect(home.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(home.headers["cache-control"]).toBe("no-store");
    const types = await Promise.all(
      [
        "/style.css",
        "/app.mjs",
        "/logo.svg",
        "/data.bin",
        "/index.html?x=1",
      ].map(async (path) => (await get(path)).headers["content-type"])
    );
    expect(types).toEqual([
      "text/css; charset=utf-8",
      "text/javascript; charset=utf-8",
      "image/svg+xml",
      "application/octet-stream",
      "text/html; charset=utf-8",
    ]);
  });

  it("serves a directory's index.html, after a redirect to its slash", async () => {
    expect(await get("/sub?q=1")).toMatchObject({
      headers: { location: "/sub/?q=1" },
      status: 301,
    });
    expect(await get("/sub/")).toMatchObject({
      body: "<h1>sub</h1>",
      status: 200,
    });
    expect((await get("//sub")).headers.location).toBe("/sub/");
    expect((await get("/bare/")).status).toBe(404);
  });

  it("never serves anything outside the root", async () => {
    const attempts = [
      "/../secret.txt",
      "/sub/../../secret.txt",
      "/%2e%2e/secret.txt",
      "/sub%2F..%2F..%2Fsecret.txt",
      "/link.txt",
      "/missing.html",
    ];
    const answers = await Promise.all(attempts.map((path) => get(path)));
    for (const answer of answers) {
      expect(answer.status).toBe(404);
      expect(answer.body).not.toContain("not for the preview");
    }
    expect((await get("/%00")).status).toBe(400);
    expect((await get("/%E0%A4%A")).status).toBe(400);
  });

  it("answers only GET and HEAD", async () => {
    expect(await get("/", "HEAD")).toMatchObject({ body: "", status: 200 });
    expect(await get("/", "POST")).toMatchObject({
      headers: { allow: "GET, HEAD" },
      status: 405,
    });
  });

  it("lets a second copy exit quietly while one listens", async () => {
    const second = startServer(join(dir, "server.mjs"), port);
    const code = await new Promise<number | null>((resolve) =>
      second.on("exit", resolve)
    );
    expect(code).toBe(0);
    expect((await get("/")).status).toBe(200);
  });
});
