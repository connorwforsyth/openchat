import { SKILL_AUTHORING_TOOLS } from "@workspace/ai/tools/registry/skill-authoring";
import type { Tool } from "ai";
import { describe, expect, it, vi } from "vitest";

import {
  checkPlanCommand,
  PLAN_READ_TOOLS,
  PLAN_REFUSED,
  planApprovalOf,
  planTitle,
  planTurn,
  planUnavailable,
} from "./plan-mode";

// Plan mode (106): a planning run can read, never write. These are the
// pure rules; `plan-mode.runs.test.ts` drives them through real runs.

describe("checkPlanCommand", () => {
  const allowed = (command: string) => {
    const checked = checkPlanCommand(command);
    if (!checked.ok) {
      throw new Error(`refused ${command}: ${checked.error}`);
    }
    return checked.value;
  };
  const refused = (command: string) => checkPlanCommand(command).ok === false;

  it.each([
    "ls",
    "ls -la src",
    "cat package.json",
    "head -n 20 README.md",
    "tail -n 5 src/index.ts",
    "wc -l src/app.ts",
    "rg TODO",
    "rg -n 'foo.*bar' src",
    'grep -rn "createRun" packages/server/src',
    "find . -name '*.ts' -type f",
    "find src -maxdepth 2",
    "git status",
    "git log --oneline -n 5",
    "git diff HEAD~1 -- src",
    "git show HEAD:README.md",
  ])("allows %s", (command) => {
    expect(allowed(command).length).toBeGreaterThan(0);
  });

  it.each([
    // Chaining, in every spelling.
    "ls; rm -rf /",
    "ls;rm -rf /",
    "ls && rm -rf /",
    "ls || rm -rf /",
    "ls & rm -rf /",
    "ls\nrm -rf /",
    "ls\r\nrm -rf /",
    // Substitution.
    "cat $(rm -rf /)",
    "cat `rm -rf /`",
    'cat "$(rm -rf /)"',
    'cat "`rm -rf /`"',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the shell's ${…} is the point.
    "cat ${HOME}",
    "cat $HOME/.bashrc",
    "cat <(rm -rf /)",
    // Pipes and redirects.
    "cat a | sh",
    "ls > out.txt",
    "ls >> out.txt",
    "cat < /etc/passwd",
    "ls 2>/dev/null",
    "ls >| out",
    // Globs and other expansions outside quotes.
    "cat *",
    "ls src/*.ts",
    "cat file?",
    "ls [a-z]*",
    "ls ~",
    "ls {a,b}",
    // Subshells, grouping, comments, escapes, history.
    "(rm -rf /)",
    "{ rm -rf /; }",
    "ls # && rm",
    "ls \\; rm -rf /",
    "ls !!",
    'cat "a\\"; rm -rf /"',
    // Unclosed quotes.
    "cat 'oops",
    'cat "oops',
    // Commands that aren't on the list, however they're spelled.
    "rm -rf /",
    "/bin/rm -rf /",
    "'rm' -rf /",
    "r''m -rf /",
    "sh -c ls",
    "bash -c 'ls'",
    "env rm -rf /",
    "xargs rm",
    "sed -i s/a/b/ file",
    "tee out.txt",
    "touch x",
    "mv a b",
    "cp a b",
    "echo hi",
    "FOO=bar ls",
    "command ls",
    "exec ls",
    "",
    "   ",
    // find's writing and executing actions.
    "find . -delete",
    "find . -exec rm {} +",
    "find . -exec rm '{}' ';'",
    "find . -execdir rm '{}' +",
    "find . -ok rm '{}' ';'",
    "find . -okdir rm '{}' ';'",
    "find . -fprint out.txt",
    "find . -fprint0 out.txt",
    "find . -fprintf out.txt '%p'",
    "find . -fls out.txt",
    // rg running a preprocessor or a hostname program.
    "rg --pre rm x",
    "rg --pre=rm x",
    "rg --pre-glob '*' x",
    "rg --hostname-bin rm x",
    // git: only status, log, diff and show, and none of their writing flags.
    "git",
    "git commit -m x",
    "git checkout -- .",
    "git reset --hard",
    "git clean -fdx",
    "git push",
    "git -c core.pager=rm log",
    "git -C / status",
    "git --exec-path=/tmp log",
    "git config core.fsmonitor rm",
    "git diff --output=out.patch",
    "git diff --output out.patch",
    "git log --outp=x",
    "git diff --ou=x",
    "git diff --ext-diff",
    "git log --ext",
    "git show --textconv HEAD",
  ])("refuses %j", (command) => {
    expect(refused(command)).toBe(true);
  });

  it("says why it refused", () => {
    const checked = checkPlanCommand("ls; rm -rf /");
    expect(checked.ok).toBe(false);
    expect(checked.ok ? "" : checked.error).toContain(";");
    const other = checkPlanCommand("rm -rf /");
    expect(other.ok ? "" : other.error).toContain("`rm`");
  });

  it("refuses a command too long to read", () => {
    expect(refused(`cat ${"a".repeat(5000)}`)).toBe(true);
  });

  it("hands bash exactly the words it checked", () => {
    // Quoted words go back single-quoted, so the shell reads them as checked.
    expect(allowed("rg -n 'foo.*bar' src")).toBe("rg -n 'foo.*bar' src");
    expect(allowed('grep "it\'s" notes.md')).toBe("grep 'it'\\''s' notes.md");
    expect(allowed("find . -name '*.ts'")).toBe("find . -name '*.ts'");
    // A quoted `;` is a literal argument, not a separator.
    expect(allowed("grep ';' a.ts")).toBe("grep ';' a.ts");
    expect(allowed("rg '$(rm -rf /)' src")).toBe("rg '$(rm -rf /)' src");
  });

  it("runs git without a pager, locks, fsmonitor or external diff programs", () => {
    expect(allowed("git status")).toBe(
      "git --no-pager --no-optional-locks -c core.fsmonitor=false status"
    );
    expect(allowed("git diff HEAD")).toBe(
      "git --no-pager --no-optional-locks -c core.fsmonitor=false diff --no-ext-diff --no-textconv HEAD"
    );
  });
});

const fakeTool = (
  execute = vi.fn(async (input: unknown) => ({ input, status: "ran" })),
  metadata?: Record<string, unknown>
): Tool =>
  ({
    description: "x",
    execute,
    inputSchema: { jsonSchema: {} },
    ...(metadata ? { metadata } : {}),
  }) as unknown as Tool;

const run = (tool: Tool | undefined, input: unknown) => {
  const execute = tool?.execute as
    | ((input: unknown, options: unknown) => Promise<unknown>)
    | undefined;
  if (!execute) {
    throw new Error("the tool has no execute");
  }
  return execute(input, { messages: [], toolCallId: "call-1" });
};

describe("planTurn", () => {
  const sandboxExec = vi.fn(async (input: unknown) => ({
    input,
    status: "ran",
  }));
  const tools: Record<string, Tool> = {
    bash: fakeTool(sandboxExec),
    create_artifact: fakeTool(),
    edit: fakeTool(),
    file_search: fakeTool(),
    github__create_issue: fakeTool(undefined, {
      annotations: { readOnlyHint: false },
    }),
    github__list_issues: fakeTool(undefined, {
      annotations: { readOnlyHint: true },
    }),
    github__lying: fakeTool(undefined, {
      annotations: { destructiveHint: true, readOnlyHint: true },
    }),
    github__unmarked: fakeTool(),
    preview: fakeTool(),
    read: fakeTool(),
    update_artifact: fakeTool(),
    update_memory: fakeTool(),
    // A builtin can't pass as read-only by claiming it: only MCP tools are
    // judged by their annotations.
    write: fakeTool(undefined, { annotations: { readOnlyHint: true } }),
  };
  const planned = planTurn({
    proposeEdits: () => Promise.resolve(undefined),
    toolApproval: Object.fromEntries(
      Object.keys(tools).map((name) => [name, "user-approval" as const])
    ),
    tools,
  });

  it("offers only reading tools and read-only MCP tools", () => {
    const kept = ["bash", "file_search", "github__list_issues", "read"];
    expect(Object.keys(planned.tools ?? {}).sort()).toEqual(kept);
    expect(Object.keys(planned.toolApproval ?? {}).sort()).toEqual(kept);
    // Nothing changes files, so nothing is proposed.
    expect(planned.proposeEdits).toBeUndefined();
  });

  it("names every tool it left out, with why, for the model to read (131)", () => {
    const left = Object.keys(tools)
      .filter((name) => !(name in (planned.tools ?? {})))
      .sort();
    expect(Object.keys(planned.unavailableTools ?? {}).sort()).toEqual(left);
    expect(planned.unavailableTools?.write).toBe(planUnavailable("write"));
    expect(planUnavailable("write")).toContain(
      "`write` isn't available while planning"
    );
  });

  it("withholds the skill tools (128): they write to the library, even with a reading tool's name in their own", () => {
    const authoring = planTurn({
      toolApproval: {},
      tools: {
        create_skill: fakeTool(),
        load_skill: fakeTool(),
        publish_skill: fakeTool(),
        update_skill: fakeTool(),
      },
    });
    expect(Object.keys(authoring.tools ?? {})).toEqual(["load_skill"]);
    expect(authoring.unavailableTools).toEqual({
      create_skill: planUnavailable("create_skill"),
      publish_skill: planUnavailable("publish_skill"),
      update_skill: planUnavailable("update_skill"),
    });
    for (const name of SKILL_AUTHORING_TOOLS) {
      expect(PLAN_READ_TOOLS).not.toContain(name);
    }
  });

  it("keeps each tool's approval as it was: nothing becomes automatic", () => {
    expect(planned.toolApproval?.github__list_issues).toBe("user-approval");
  });

  it("runs an allowed bash command, as checked", async () => {
    sandboxExec.mockClear();
    await run(planned.tools?.bash, { command: "rg -n 'a b' src" });
    expect(sandboxExec).toHaveBeenCalledOnce();
    expect(sandboxExec.mock.calls[0]?.[0]).toEqual({
      command: "rg -n 'a b' src",
    });
  });

  it.each([
    "ls; rm -rf /",
    "cat $(whoami)",
    "ls | sh",
    "ls > x",
    "ls && touch x",
    "rm -rf /",
  ])("refuses %j as a tool error, without running it", async (command) => {
    sandboxExec.mockClear();
    const output = await run(planned.tools?.bash, { command });
    expect(sandboxExec).not.toHaveBeenCalled();
    expect(output).toMatchObject({ status: "error" });
    expect((output as { message: string }).message).toContain(PLAN_REFUSED);
  });

  it("refuses bash input it can't read", async () => {
    sandboxExec.mockClear();
    const output = await run(planned.tools?.bash, { cmd: "ls" });
    expect(sandboxExec).not.toHaveBeenCalled();
    expect(output).toMatchObject({ status: "error" });
  });

  it("leaves a turn without tools alone", () => {
    const bare: Parameters<typeof planTurn>[0] = {};
    expect(planTurn(bare).tools).toBeUndefined();
  });

  it("withholds a client's bash, which nothing here can check", () => {
    const client = { description: "x", inputSchema: {} } as unknown as Tool;
    expect(planTurn({ tools: { bash: client } }).tools).toBeUndefined();
  });
});

describe("planTitle", () => {
  it("takes the plan's first heading", () => {
    expect(planTitle("# Add dark mode\n\n## Goal\nx", "ignored")).toBe(
      "Plan: Add dark mode"
    );
    expect(planTitle("Intro\n\n## Goal\nShip it", "Make it fast")).toBe(
      "Plan: Make it fast"
    );
  });

  it("falls back to the request, then to a plain name, and stays short", () => {
    expect(planTitle("", "  ")).toBe("Plan");
    expect(planTitle("", "a".repeat(400)).length).toBeLessThanOrEqual(200);
    expect(planTitle("# Plan: Already named", "")).toBe("Plan: Already named");
  });
});

describe("planApprovalOf", () => {
  const artifactId = "019a0000-0000-7000-8000-000000000001";
  it("finds the approval part a message carries", () => {
    expect(
      planApprovalOf([
        { text: "Build it", type: "text" },
        { data: { artifactId }, name: "plan-approval", type: "data" },
      ])
    ).toEqual({ artifactId });
  });

  it("ignores other data and malformed approvals", () => {
    expect(
      planApprovalOf([
        { data: { artifactId: "nope" }, name: "plan-approval", type: "data" },
        { data: { path: "a" }, name: "workspace-file", type: "data" },
      ])
    ).toBeNull();
  });
});
