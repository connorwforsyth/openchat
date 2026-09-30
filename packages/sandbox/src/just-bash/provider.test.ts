import { fixtureId } from "@workspace/contract/fixtures";
import { Bash, DefenseInDepthBox } from "just-bash";
import { afterEach, describe, expect, it } from "vitest";

import type { Sandbox } from "../ports/sandbox";
import { installHostAsyncHook } from "../testing/host-async-hook";
import {
  createJustBashFactory,
  createJustBashSandbox,
  defenseInDepthFor,
  liveKey,
} from "./provider";
import { createMemorySnapshotStore } from "./snapshot-store";
import { encodeState } from "./state";

const id = fixtureId("sandbox", 1);
const conversationId = fixtureId("conversation", 1);
const limits = { cpu: 1, diskMb: 64, memoryMb: 512, network: false };
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const must = async <T>(
  result: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>
): Promise<T> => {
  const settled = await result;
  if (!settled.ok) {
    throw new Error(JSON.stringify(settled.error));
  }
  return settled.value;
};

describe("just-bash Sandbox", () => {
  it("runs PLAN.md's just-bash check", async () => {
    const sandbox = await createJustBashSandbox({ id });
    const chunks: string[] = [];
    const result = await must(
      sandbox.exec("ls && echo hi > a.txt && cat a.txt", {
        onOutput: (chunk) => chunks.push(chunk.data),
      })
    );
    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: "hi\n",
      timedOut: false,
      truncated: false,
    });
    expect(chunks).toEqual(["hi\n"]);
    expect(decode(await must(sandbox.readFile("a.txt")))).toBe("hi\n");
  });

  it("runs real bash: pipes, loops and text tools", async () => {
    const sandbox = await createJustBashSandbox({ id });
    const result = await must(
      sandbox.exec(
        "for n in 3 1 2; do echo $n; done | sort | tr '\\n' ',' && echo '{\"a\":1}' | jq .a"
      )
    );
    expect(result.stdout).toBe("1,2,3,1\n");
  });

  it("reports failures as exit codes, not errors", async () => {
    const sandbox = await createJustBashSandbox({ id });
    const result = await must(sandbox.exec("cat missing.txt"));
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("missing.txt");
  });

  it("times out long commands", async () => {
    const sandbox = await createJustBashSandbox({ id });
    const result = await must(sandbox.exec("sleep 10", { timeoutMs: 100 }));
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it("reads, writes and lists files under the workdir", async () => {
    const sandbox = await createJustBashSandbox({ id });
    await must(sandbox.writeFile("src/lib/util.ts", "y"));
    await must(sandbox.writeFile("/work/src/index.ts", "x"));
    const top = await must(sandbox.listFiles("."));
    expect(top.map((entry) => [entry.path, entry.type])).toEqual([
      ["/work/src", "directory"],
    ]);
    const all = await must(sandbox.listFiles("src", { recursive: true }));
    expect(all.map((entry) => entry.path)).toEqual([
      "/work/src/index.ts",
      "/work/src/lib",
      "/work/src/lib/util.ts",
    ]);
    expect(all[0]).toMatchObject({ size: 1, type: "file" });
    expect(await sandbox.readFile("nope.txt")).toEqual({
      error: { path: "nope.txt", type: "not_found" },
      ok: false,
    });
    expect((await sandbox.readFile("../../etc/passwd")).ok).toBe(false);
  });

  it("has no ports to preview", async () => {
    const sandbox = await createJustBashSandbox({ id });
    expect(await sandbox.exposePort(3000)).toEqual({
      error: { operation: "exposePort", type: "unsupported" },
      ok: false,
    });
  });

  it("refuses everything after destroy and forgets its workspace", async () => {
    const store = createMemorySnapshotStore();
    const sandbox = await createJustBashSandbox({ id, store });
    await must(sandbox.writeFile("a.txt", "x"));
    expect(store.keys()).toEqual([liveKey(id)]);
    await must(sandbox.destroy());
    expect(await sandbox.exec("ls")).toEqual({
      error: { type: "destroyed" },
      ok: false,
    });
    expect(store.keys()).toEqual([]);
  });
});

describe("just-bash SandboxFactory", () => {
  const listing = async (sandbox: Sandbox) =>
    (await must(sandbox.listFiles(".", { recursive: true }))).map(
      (entry) => entry.path
    );

  it("snapshots and restores a workspace, including links and modes", async () => {
    const store = createMemorySnapshotStore();
    const factory = createJustBashFactory({ store });
    const sandbox = await must(factory.create({ conversationId, id, limits }));
    await must(
      sandbox.exec(
        "mkdir -p app && echo 'echo run' > app/run.sh && chmod 755 app/run.sh && ln -s app/run.sh run"
      )
    );
    const { ref } = await must(sandbox.snapshot());
    await must(sandbox.writeFile("later.txt", "not in the snapshot"));

    const restored = await must(
      factory.create({
        conversationId,
        id: fixtureId("sandbox", 2),
        limits,
        snapshotRef: ref,
      })
    );
    expect(await listing(restored)).toEqual([
      "/work/app",
      "/work/app/run.sh",
      "/work/run",
    ]);
    const run = await must(restored.exec("bash run && stat -c %a app/run.sh"));
    expect(run.stdout).toBe("run\n755\n");
  });

  it("reattaches to a saved workspace after a restart", async () => {
    const store = createMemorySnapshotStore();
    const before = createJustBashFactory({ store });
    const sandbox = await must(before.create({ conversationId, id, limits }));
    await must(sandbox.exec("echo kept > notes.md"));

    // A new factory over the same store is a new process.
    const after = createJustBashFactory({ store });
    const attached = await must(after.attach(id));
    const read = await must(attached.readFile("notes.md"));
    expect(decode(read)).toBe("kept\n");
    expect(await listing(attached)).toEqual(["/work/notes.md"]);
  });

  it("finds a fresh sandbox after a restart before its first command", async () => {
    const store = createMemorySnapshotStore();
    await must(
      createJustBashFactory({ store }).create({ conversationId, id, limits })
    );
    expect((await createJustBashFactory({ store }).attach(id)).ok).toBe(true);
  });

  it("reports unknown sandboxes, missing snapshots and corrupt state", async () => {
    const store = createMemorySnapshotStore();
    const factory = createJustBashFactory({ store });
    expect(await factory.attach(id)).toMatchObject({
      error: { type: "unavailable" },
      ok: false,
    });
    expect(
      await factory.create({ conversationId, id, limits, snapshotRef: "nope" })
    ).toEqual({ error: { path: "nope", type: "not_found" }, ok: false });

    await store.save(liveKey(id), new TextEncoder().encode("{not json"));
    expect(await factory.attach(id)).toMatchObject({
      error: { type: "unavailable" },
      ok: false,
    });
    // Entries outside the workdir are ignored rather than restored.
    await store.save(
      liveKey(id),
      encodeState({
        entries: [{ mode: 493, path: "/etc", type: "directory" }],
        version: 1,
      })
    );
    const attached = await must(factory.attach(id));
    expect(await listing(attached)).toEqual([]);
  });

  it("caps the workspace at the disk limit", async () => {
    const sandbox = await createJustBashSandbox({ id, limits: { diskMb: 1 } });
    const written = await sandbox.writeFile(
      "big.bin",
      new Uint8Array(2_000_000)
    );
    expect(written).toMatchObject({
      error: { type: "limit_exceeded" },
      ok: false,
    });
  });
});

// 076: `next dev` died mid tool call. React's development renderer times
// every promise and timer from a process-wide async hook, which runs inside
// the command's async context, where just-bash's defense-in-depth layer
// throws; a throw from an async hook exits Node.
describe("just-bash under a host's async hooks", () => {
  /** Timers, pipes and loops: every kind of async work a command makes. */
  const COMMAND =
    "sleep 0.01; echo a | grep a | wc -l; for n in 1 2; do echo $n; done";
  const OUTPUT = "1\n1\n2\n";

  it("keeps the layer by default, which a dev-mode hook trips", async () => {
    const sandbox = await createJustBashSandbox({ id });
    using hook = installHostAsyncHook();
    const result = await must(sandbox.exec(COMMAND));
    expect(result.stdout).toBe(OUTPUT);
    // Under React's hook, each of these would have exited the process.
    expect(hook.thrown).toContain("SecurityViolationError");
  });

  it("runs cleanly under the hook with the layer off, as under next dev", async () => {
    const sandbox = await createJustBashSandbox({ defenseInDepth: false, id });
    using hook = installHostAsyncHook();
    const result = await must(sandbox.exec(COMMAND));
    expect(result.stdout).toBe(OUTPUT);
    expect(hook.thrown).toEqual([]);
  });

  it("turns the layer off under next dev alone", () => {
    expect(defenseInDepthFor({ NODE_ENV: "development" })).toBe(false);
    expect(defenseInDepthFor({ NODE_ENV: "production" })).toBe(true);
    expect(defenseInDepthFor({ NODE_ENV: "test" })).toBe(true);
    expect(defenseInDepthFor({})).toBe(true);
  });

  describe("an interpreter that throws", () => {
    afterEach(() => DefenseInDepthBox.resetInstance());

    it("is the command's error, not a rejection", async () => {
      // The layer is one per process: another Bash that set it up
      // differently makes this one's exec throw.
      DefenseInDepthBox.resetInstance();
      await new Bash({
        defenseInDepth: { auditMode: true, enabled: true },
      }).exec("true");
      const sandbox = await createJustBashSandbox({ id });
      expect(await sandbox.exec("echo hi")).toMatchObject({
        error: {
          message: expect.stringContaining("conflict"),
          type: "unavailable",
        },
        ok: false,
      });
    });
  });
});
