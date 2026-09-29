import { parseProposedEdit } from "@workspace/code-ui/review/patch";
import { fixtureId } from "@workspace/contract/fixtures";
import type { ApprovalDecision } from "@workspace/contract/schemas/message-parts";
import type { ExecResult } from "@workspace/contract/schemas/sandbox";
import { ok } from "@workspace/shared/result";
import type { Tool, ToolExecutionOptions } from "ai";
import { describe, expect, it } from "vitest";

import { createJustBashSandbox } from "../just-bash/provider";
import type { Sandbox } from "../ports/sandbox";
import { createMemorySandbox } from "../ports/sandbox.memory";
import { proposeEdit } from "./patch";
import {
  applySandboxChange,
  baseHashOf,
  contentHash,
  createSandboxTools,
  proposeSandboxChange,
} from "./tools";

const id = fixtureId("sandbox", 1);

const source = [
  'import { total } from "./math";',
  "",
  "export function price(items: number[]) {",
  "  const sum = total(items);",
  "  return sum;",
  "}",
  "",
  "// spacer so the two changes land in separate hunks",
  "// spacer",
  "// spacer",
  "// spacer",
  "",
  "export function label(value: number) {",
  "  return `$${value}`;",
  "}",
  "",
].join("\n");

const call = (toolCallId = "call-1"): ToolExecutionOptions<unknown> => ({
  context: undefined,
  messages: [],
  toolCallId,
});

const run = (
  tools: Record<string, Tool>,
  name: string,
  input: any,
  toolCallId = "call-1"
) => {
  const execute = tools[name]?.execute;
  if (!execute) {
    throw new Error(`${name} has no execute`);
  }
  return execute(input, call(toolCallId));
};

const text = async (sandbox: Sandbox, path: string) => {
  const read = await sandbox.readFile(path);
  return read.ok ? new TextDecoder().decode(read.value) : null;
};

describe("proposeEdit", () => {
  it("proposes a patch DiffView can parse, one id per hunk", () => {
    const after = source
      .replace("  return sum;", "  const tax = sum * 0.2;\n  return sum + tax;")
      .replace("`$${value}`", "`$${value.toFixed(2)}`");
    const edit = proposeEdit("src/billing.ts", source, after);
    expect(edit?.hunks.map((hunk) => hunk.hunkId)).toEqual(["h1", "h2"]);
    const parsed = edit ? parseProposedEdit(edit) : null;
    expect(parsed?.ok && parsed.value.hunks.map((hunk) => hunk.hunkId)).toEqual(
      ["h1", "h2"]
    );
  });

  it("proposes new files and returns null for no change", () => {
    const created = proposeEdit("notes.md", "", "hello\n");
    expect(created?.hunks).toHaveLength(1);
    expect(created && parseProposedEdit(created).ok).toBe(true);
    expect(proposeEdit("a", "same", "same")).toBeNull();
  });
});

describe("sandbox tools", () => {
  it("runs bash and reads files", async () => {
    const sandbox = await createJustBashSandbox({ id });
    const streamed: string[] = [];
    const tools = createSandboxTools({
      onOutput: (toolCallId, chunk) =>
        streamed.push(`${toolCallId}:${chunk.data}`),
      sandbox,
    });
    expect(
      await run(tools, "bash", {
        command: "printf 'a\\nb\\nc\\n' > f.txt && cat f.txt",
      })
    ).toMatchObject({ exitCode: 0, status: "ran", stdout: "a\nb\nc\n" });
    expect(streamed).toEqual(["call-1:a\nb\nc\n"]);
    expect(
      await run(tools, "read", { limit: 1, offset: 2, path: "f.txt" })
    ).toEqual({
      content: "b",
      path: "f.txt",
      status: "read",
      totalLines: 4,
      truncated: false,
    });
    expect(await run(tools, "read", { path: "nope" })).toEqual({
      message: "nope: no such file or directory",
      status: "error",
    });
  });

  it("refuses binary files as text", async () => {
    const sandbox = await createJustBashSandbox({ id });
    await sandbox.writeFile("blob", new Uint8Array([0xff, 0xfe, 0x00]));
    const tools = createSandboxTools({ sandbox });
    expect(await run(tools, "read", { path: "blob" })).toMatchObject({
      status: "error",
    });
  });

  it("writes new files and reports unchanged ones", async () => {
    const sandbox = await createJustBashSandbox({ id });
    const tools = createSandboxTools({ sandbox });
    const written = await run(tools, "write", {
      content: "hi\n",
      path: "a/b.txt",
    });
    expect(written).toMatchObject({
      applied: ["h1"],
      rejected: [],
      status: "changed",
    });
    expect(await text(sandbox, "a/b.txt")).toBe("hi\n");
    expect(
      await run(tools, "write", { content: "hi\n", path: "a/b.txt" })
    ).toEqual({
      path: "a/b.txt",
      status: "unchanged",
    });
  });

  it("edits unique strings and refuses ambiguous ones", async () => {
    const sandbox = await createJustBashSandbox({ id });
    await sandbox.writeFile("x.txt", "one two one\n");
    const tools = createSandboxTools({ sandbox });
    expect(
      await run(tools, "edit", {
        newString: "1",
        oldString: "one",
        path: "x.txt",
      })
    ).toMatchObject({ status: "error" });
    expect(
      await run(tools, "edit", {
        newString: "3",
        oldString: "missing",
        path: "x.txt",
      })
    ).toEqual({ message: "oldString was not found in x.txt", status: "error" });
    await run(tools, "edit", {
      newString: "1",
      oldString: "one",
      path: "x.txt",
      replaceAll: true,
    });
    expect(await text(sandbox, "x.txt")).toBe("1 two 1\n");
    // `$&` in the replacement is literal text, not a regex back-reference.
    await run(tools, "edit", {
      newString: "$&",
      oldString: "two",
      path: "x.txt",
    });
    expect(await text(sandbox, "x.txt")).toBe("1 $& 1\n");
  });

  it("applies only the accepted hunk of a reviewed edit (D16)", async () => {
    const sandbox = await createJustBashSandbox({ id });
    await sandbox.writeFile("src/billing.ts", source);
    const input = {
      newString: source
        .replace("  return sum;", "  return sum + 1;")
        .replace("`$${value}`", "`$${value.toFixed(2)}`"),
      oldString: source,
      path: "src/billing.ts",
    };

    // The run executor proposes first, to show the reviewer.
    const proposed = await proposeSandboxChange(sandbox, {
      input,
      kind: "edit",
    });
    const hunks = proposed.ok ? proposed.value?.hunks : undefined;
    expect(hunks?.map((hunk) => hunk.hunkId)).toEqual(["h1", "h2"]);

    const decision: ApprovalDecision = {
      comments: [],
      decision: "review",
      hunks: [
        { decision: "accept", hunkId: "h1" },
        { comment: "keep integers", decision: "reject", hunkId: "h2" },
      ],
    };
    const reviews = new Map([
      [
        "call-7",
        {
          decision,
          proposed: proposed.ok ? (proposed.value ?? undefined) : undefined,
        },
      ],
    ]);
    const tools = createSandboxTools({
      reviewFor: (toolCallId) => reviews.get(toolCallId),
      sandbox,
    });
    const output = await run(tools, "edit", input, "call-7");
    expect(output).toMatchObject({
      applied: ["h1"],
      rejected: ["h2"],
      status: "changed",
    });
    const after = await text(sandbox, "src/billing.ts");
    expect(after).toContain("return sum + 1;");
    expect(after).toContain("return `$${value}`;");
  });

  it("applies nothing when every hunk is rejected, and fails on a stale file", async () => {
    const sandbox = createMemorySandbox({ files: { "a.txt": "a\n" }, id });
    const change = {
      input: { content: "b\n", path: "a.txt" },
      kind: "write" as const,
    };
    const rejected = await applySandboxChange(sandbox, change, {
      decision: { decision: "reject" },
    });
    expect(rejected).toMatchObject({ applied: [], rejected: ["h1"] });
    expect(sandbox.files().get("/work/a.txt")).toBe("a\n");

    const proposed = await proposeSandboxChange(sandbox, change);
    await sandbox.writeFile("a.txt", "changed meanwhile\n");
    const stale = await applySandboxChange(sandbox, change, {
      decision: { decision: "approve" },
      proposed: (proposed.ok && proposed.value) || undefined,
    });
    expect(stale).toMatchObject({ status: "error" });
    expect(sandbox.files().get("/work/a.txt")).toBe("changed meanwhile\n");
  });

  it("stamps a proposal with its file's hash, which the review UI ignores", async () => {
    const sandbox = createMemorySandbox({ files: { "a.txt": "a\n" }, id });
    const proposed = await proposeSandboxChange(sandbox, {
      input: { content: "b\n", path: "a.txt" },
      kind: "write",
    });
    const edit = proposed.ok ? proposed.value : null;
    if (!edit) {
      throw new Error("no proposal");
    }
    expect(baseHashOf(edit)).toBe(await contentHash("a\n"));
    const parsed = parseProposedEdit(edit);
    expect(parsed.ok && parsed.value.hunks.map((hunk) => hunk.hunkId)).toEqual([
      "h1",
    ]);
  });

  it("won't apply an approved edit to a file the user changed while it waited", async () => {
    // The user's change is far from the edit, so the patch alone can't tell.
    const sandbox = createMemorySandbox({
      files: { "src/billing.ts": source },
      id,
    });
    const change = {
      input: {
        newString: "  return sum + 1;",
        oldString: "  return sum;",
        path: "src/billing.ts",
      },
      kind: "edit" as const,
    };
    const proposed = await proposeSandboxChange(sandbox, change);
    const edited = source.replace("function label", "function formatLabel");
    await sandbox.writeFile("src/billing.ts", edited);

    const tools = createSandboxTools({
      reviewFor: () => ({
        decision: { decision: "approve" },
        proposed: (proposed.ok && proposed.value) || undefined,
      }),
      sandbox,
    });
    const output = await run(tools, "edit", change.input);
    expect(output).toEqual({
      message: expect.stringContaining("Read the file again"),
      status: "error",
    });
    expect(await text(sandbox, "src/billing.ts")).toBe(edited);

    // Proposed again from what's there now, it applies.
    const fresh = await proposeSandboxChange(sandbox, change);
    expect(
      await applySandboxChange(sandbox, change, {
        decision: { decision: "approve" },
        proposed: (fresh.ok && fresh.value) || undefined,
      })
    ).toMatchObject({ applied: ["h1"], status: "changed" });
    expect(await text(sandbox, "src/billing.ts")).toContain("return sum + 1;");
  });

  it("tells onChanged about a write or edit that landed, and nothing else", async () => {
    const sandbox = createMemorySandbox({ files: { "a.html": "a\n" }, id });
    const changed: string[] = [];
    let decision: ApprovalDecision | undefined;
    const tools = createSandboxTools({
      onChanged: (path) => {
        changed.push(path);
        return Promise.resolve();
      },
      reviewFor: () => decision && { decision },
      sandbox,
    });
    await run(tools, "write", { content: "<p>hi</p>\n", path: "index.html" });
    await run(tools, "edit", {
      newString: "b",
      oldString: "a",
      path: "a.html",
    });
    expect(changed).toEqual(["index.html", "a.html"]);

    // Unchanged, rejected, or failed: nothing landed.
    await run(tools, "write", { content: "<p>hi</p>\n", path: "index.html" });
    decision = { decision: "reject" };
    await run(tools, "write", { content: "other\n", path: "index.html" });
    decision = undefined;
    await run(tools, "edit", {
      newString: "c",
      oldString: "missing",
      path: "a.html",
    });
    expect(changed).toEqual(["index.html", "a.html"]);
  });

  it("points static pages away from the preview tool", () => {
    const tools = createSandboxTools({ sandbox: createMemorySandbox({ id }) });
    expect(tools.write?.description).toContain("need no server");
    expect(tools.preview?.description).toContain("don't start a server");
    expect(tools.preview?.description).toContain("4747");
  });

  it("explains that previews need Docker", async () => {
    const tools = createSandboxTools({
      sandbox: await createJustBashSandbox({ id }),
    });
    expect(await run(tools, "preview", { port: 3000 })).toEqual({
      message:
        "This workspace can't serve previews; previews need a Docker workspace.",
      status: "error",
    });
    const memory = createSandboxTools({ sandbox: createMemorySandbox({ id }) });
    expect(await run(memory, "preview", { port: 5173 })).toMatchObject({
      port: 5173,
      status: "exposed",
    });
  });

  describe("preview waits for a listener", () => {
    const tcp = (...rows: string[]) =>
      [
        "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
        ...rows.map(
          (row, index) =>
            `   ${index}: ${row} 00000000:00000000 00:00000000 00000000  1000        0 1234${index} 1 0000000000000000 100 0 0 10 0`
        ),
        "",
      ].join("\n");
    const tcp6 = (...rows: string[]) =>
      [
        "  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
        ...rows.map(
          (row, index) =>
            `   ${index}: ${row} 00000000:00000000 00:00000000 00000000  1000        0 2234${index} 1 0000000000000000 100 0 0 10 0`
        ),
        "",
      ].join("\n");
    const any6 = "0".repeat(32);
    // Port 5173 is 0x1435; `0A` is LISTEN, `01` ESTABLISHED.
    const listening = tcp("00000000:1435 00000000:0000 0A") + tcp6();
    const nothing =
      tcp("00000000:0BB8 00000000:0000 0A", "0200A8C0:1435 0100A8C0:D431 01") +
      tcp6();

    /** A sandbox whose socket tables are `tables`, one probe at a time. */
    const probed = (...tables: string[]) => {
      const inner = createMemorySandbox({ id });
      const probes: string[] = [];
      const exposed: number[] = [];
      const sandbox: Sandbox = {
        ...inner,
        exec: (command) => {
          probes.push(command);
          const stdout = tables[Math.min(probes.length, tables.length) - 1];
          const result: ExecResult = {
            durationMs: 1,
            exitCode: 0,
            stderr: "",
            stdout: stdout ?? "",
            timedOut: false,
            truncated: false,
          };
          return Promise.resolve(ok(result));
        },
        exposePort: (port) => {
          exposed.push(port);
          return inner.exposePort(port);
        },
      };
      const sleeps: number[] = [];
      const tools = createSandboxTools({
        sandbox,
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      });
      return { exposed, probes, sleeps, tools };
    };

    it("exposes a port something listens on", async () => {
      const { exposed, probes, tools } = probed(listening);
      expect(await run(tools, "preview", { port: 5173 })).toMatchObject({
        port: 5173,
        status: "exposed",
      });
      expect(probes).toEqual([expect.stringContaining("/proc/net/tcp6")]);
      expect(exposed).toEqual([5173]);
    });

    it("exposes nothing when nothing listens, and says how to fix it", async () => {
      const { exposed, probes, sleeps, tools } = probed(nothing);
      expect(await run(tools, "preview", { port: 5173 })).toEqual({
        message:
          "Nothing is listening on port 5173. Start the dev server in the background bound to 0.0.0.0 (e.g. `npm run dev -- --host 0.0.0.0 --port 5173 &`) and call preview again.",
        status: "error",
      });
      expect(exposed).toEqual([]);
      // About 5 s of retries before giving up.
      expect(probes).toHaveLength(10);
      expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(4500);
    });

    it("waits for a server that is still starting", async () => {
      const { exposed, probes, tools } = probed(nothing, nothing, listening);
      expect(await run(tools, "preview", { port: 5173 })).toMatchObject({
        status: "exposed",
      });
      expect(probes).toHaveLength(3);
      expect(exposed).toEqual([5173]);
    });

    it("counts a server listening only on IPv6", async () => {
      const { tools } = probed(tcp() + tcp6(`${any6}:1435 ${any6}:0000 0A`));
      expect(await run(tools, "preview", { port: 5173 })).toMatchObject({
        status: "exposed",
      });
    });

    it("refuses a server bound to localhost, which the proxy can't reach", async () => {
      const loopback6 = `${"0".repeat(24)}01000000`;
      const { exposed, tools } = probed(
        tcp("0100007F:1435 00000000:0000 0A") +
          tcp6(`${loopback6}:1435 ${any6}:0000 0A`)
      );
      expect(await run(tools, "preview", { port: 5173 })).toEqual({
        message: expect.stringContaining(
          "only listens on localhost, which the preview can't reach"
        ),
        status: "error",
      });
      expect(exposed).toEqual([]);
    });
  });
});
