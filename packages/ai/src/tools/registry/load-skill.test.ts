import type {
  LibraryItemId,
  LibraryVersionId,
} from "@workspace/contract/schemas/common";
import type { Tool } from "ai";
import { describe, expect, it } from "vitest";

import type { LoadedSkill } from "../../prompts/skills";
import { aiBuiltinTools } from "./index";
import {
  loadSkill,
  loadSkillModelText,
  loadSkillTool,
  SKILL_FILE_MAX_CHARS,
  type SkillPorts,
} from "./load-skill";
import { toAiSdkTool } from "./to-ai-sdk";

const notes: LoadedSkill = {
  description: "Writes release notes.",
  files: ["templates/notes.md", "logo.png"],
  id: "11111111-1111-4111-8111-111111111111" as LibraryItemId,
  instructions: "Group changes by area.",
  name: "Release notes",
  versionId: "22222222-2222-4222-8222-222222222222" as LibraryVersionId,
};

const files: Record<string, Uint8Array> = {
  "logo.png": new Uint8Array([0x89, 0x50, 0xff, 0xfe]),
  "templates/notes.md": new TextEncoder().encode("## Added\n"),
};

const ports = (overrides: Partial<SkillPorts> = {}): SkillPorts => ({
  readFile: (_skill, path) => Promise.resolve(files[path] ?? null),
  skills: [notes],
  ...overrides,
});

describe("loadSkill", () => {
  it("returns the instructions and file list, by name or id", async () => {
    const byName = await loadSkill(ports(), { skill: "release NOTES" });
    expect(byName).toEqual({
      files: ["templates/notes.md", "logo.png"],
      instructions: "Group changes by area.",
      name: "Release notes",
      status: "loaded",
    });
    expect(await loadSkill(ports(), { skill: notes.id })).toEqual(byName);
  });

  it("loads only the skills the turn was given", async () => {
    expect(await loadSkill(ports(), { skill: "Something else" })).toEqual({
      available: ["Release notes"],
      status: "not_found",
    });
    expect(
      await loadSkill(ports({ skills: [] }), { skill: "Release notes" })
    ).toEqual({ available: [], status: "not_found" });
  });

  it("reads a bundled file by path, and nothing outside the list", async () => {
    expect(
      await loadSkill(ports(), {
        path: "./templates/notes.md",
        skill: "Release notes",
      })
    ).toEqual({
      content: "## Added\n",
      name: "Release notes",
      path: "templates/notes.md",
      status: "file",
      truncated: false,
    });
    expect(
      await loadSkill(ports(), { path: "../secrets", skill: "Release notes" })
    ).toMatchObject({ status: "no_such_file" });
  });

  it("says when a file isn't text or can't be read", async () => {
    expect(
      await loadSkill(ports(), { path: "logo.png", skill: "Release notes" })
    ).toMatchObject({ status: "unreadable" });
    expect(
      await loadSkill(
        ports({ readFile: () => Promise.reject(new Error("down")) }),
        { path: "templates/notes.md", skill: "Release notes" }
      )
    ).toMatchObject({ status: "unreadable" });
  });

  it("cuts a long file and says so", async () => {
    const long = new TextEncoder().encode("x".repeat(SKILL_FILE_MAX_CHARS + 5));
    const read = await loadSkill(
      ports({ readFile: () => Promise.resolve(long) }),
      { path: "templates/notes.md", skill: "Release notes" }
    );
    expect(read).toMatchObject({ status: "file", truncated: true });
    expect(read.status === "file" && read.content.length).toBe(
      SKILL_FILE_MAX_CHARS
    );
    expect(loadSkillModelText(read)).toContain("[Cut at");
  });
});

describe("the load_skill tool", () => {
  it("runs without asking, and is registered", () => {
    expect(loadSkillTool).toMatchObject({
      approval: "auto",
      capability: "skills",
      name: "load_skill",
    });
    expect(aiBuiltinTools.get("load_skill")).toBe(loadSkillTool);
  });

  it("gives the model the instructions as text", async () => {
    const tool: Tool = toAiSdkTool(loadSkillTool, { ports: ports() });
    const output = await tool.execute?.(
      { skill: "Release notes" },
      { context: {}, messages: [], toolCallId: "call_1" }
    );
    const read = tool.toModelOutput?.({
      input: { skill: "Release notes" },
      output,
      toolCallId: "call_1",
    });
    expect(read).toEqual({
      type: "text",
      value:
        '<skill name="Release notes">\nGroup changes by area.\n</skill>\n\nFiles it bundles:\n- templates/notes.md\n- logo.png',
    });
  });
});
