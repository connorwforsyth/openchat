import { parseProposedEdit } from "@workspace/code-ui/review/patch";
import { fixtureId } from "@workspace/contract/fixtures";
import type { ApprovalDecision } from "@workspace/contract/schemas/message-parts";
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
});
