import { fixtureId } from "@workspace/contract/fixtures";
import { describe, expect, it } from "vitest";

import {
  createMemorySandbox,
  createMemorySandboxFactory,
  resolvePath,
} from "./sandbox.memory";

const id = fixtureId("sandbox", 1);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("memory Sandbox", () => {
  it("runs PLAN.md's just-bash check", async () => {
    const sandbox = createMemorySandbox({ id });
    const result = await sandbox.exec("ls && echo hi > a.txt && cat a.txt");
    expect(result).toMatchObject({
      ok: true,
      value: { exitCode: 0, stdout: "hi\n" },
    });
    expect(sandbox.files().get("/work/a.txt")).toBe("hi\n");
  });

  it("stops a chain at the first failure and reports unknown commands", async () => {
    const sandbox = createMemorySandbox({ id });
    const result = await sandbox.exec("false && echo never");
    expect(result.ok && result.value).toMatchObject({
      exitCode: 1,
      stdout: "",
    });
    const missing = await sandbox.exec("npm install");
    expect(missing.ok && missing.value).toMatchObject({
      exitCode: 127,
      stderr: "npm: command not found\n",
    });
  });

  it("streams output and supports appends, quotes and custom commands", async () => {
    const sandbox = createMemorySandbox({
      commands: { node: () => ({ exitCode: 0, stdout: "v24\n" }) },
      id,
    });
    const chunks: string[] = [];
    await sandbox.exec("echo 'a b' > f && echo c >> f && cat f && node", {
      onOutput: (chunk) => chunks.push(chunk.data),
    });
    expect(sandbox.files().get("/work/f")).toBe("a b\nc\n");
    expect(chunks).toEqual(["a b\nc\n", "v24\n"]);
  });

  it("reads, writes and lists files", async () => {
    const sandbox = createMemorySandbox({ files: { "src/index.ts": "x" }, id });
    await sandbox.writeFile("src/lib/util.ts", "y");
    const read = await sandbox.readFile("/work/src/lib/util.ts");
    expect(read.ok && decode(read.value)).toBe("y");
    const top = await sandbox.listFiles(".");
    expect(top.ok && top.value.map((e) => [e.path, e.type])).toEqual([
      ["/work/src", "directory"],
    ]);
    const all = await sandbox.listFiles("src", { recursive: true });
    expect(all.ok && all.value.map((e) => e.path)).toEqual([
      "/work/src/index.ts",
      "/work/src/lib",
      "/work/src/lib/util.ts",
    ]);
    expect(await sandbox.readFile("nope.txt")).toEqual({
      error: { path: "nope.txt", type: "not_found" },
      ok: false,
    });
  });

  it("refuses paths that climb out of the root", async () => {
    expect(resolvePath("../../../etc/passwd").ok).toBe(false);
    expect(resolvePath("a/../b")).toEqual({ ok: true, value: "/work/b" });
    const sandbox = createMemorySandbox({ id });
    expect((await sandbox.writeFile("/../x", "y")).ok).toBe(false);
  });

  it("exposes ports on a sandbox origin", async () => {
    const sandbox = createMemorySandbox({ id });
    expect(await sandbox.exposePort(5173)).toEqual({
      ok: true,
      value: { port: 5173, url: `https://${id}-5173.sandbox.test` },
    });
    expect((await sandbox.exposePort(70_000)).ok).toBe(false);
  });

  it("refuses everything after destroy", async () => {
    const sandbox = createMemorySandbox({ id });
    await sandbox.destroy();
    expect(await sandbox.exec("ls")).toEqual({
      error: { type: "destroyed" },
      ok: false,
    });
    expect(await sandbox.status()).toEqual({
      error: { type: "destroyed" },
      ok: false,
    });
  });
});

describe("memory SandboxFactory", () => {
  const limits = { cpu: 1, diskMb: null, memoryMb: 512, network: false };
  const conversationId = fixtureId("conversation", 1);

  it("creates, attaches and restores from a snapshot", async () => {
    const factory = createMemorySandboxFactory();
    const created = await factory.create({ conversationId, id, limits });
    if (!created.ok) {
      throw new Error("create failed");
    }
    await created.value.writeFile("a.txt", "kept");
    const snapshot = await created.value.snapshot();
    if (!snapshot.ok) {
      throw new Error("snapshot failed");
    }
    await created.value.writeFile("b.txt", "not kept");

    expect((await factory.attach(id)).ok).toBe(true);

    const restored = await factory.create({
      conversationId,
      id: fixtureId("sandbox", 2),
      limits,
      snapshotRef: snapshot.value.ref,
    });
    const listing = restored.ok
      ? await restored.value.listFiles(".")
      : undefined;
    expect(listing?.ok && listing.value.map((e) => e.path)).toEqual([
      "/work/a.txt",
    ]);
  });

  it("reports unknown sandboxes and snapshots", async () => {
    const factory = createMemorySandboxFactory();
    expect((await factory.attach(id)).ok).toBe(false);
    expect(
      (
        await factory.create({
          conversationId,
          id,
          limits,
          snapshotRef: "nope",
        })
      ).ok
    ).toBe(false);
  });
});
