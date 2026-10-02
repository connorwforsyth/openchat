import { describe, expect, it } from "vitest";

import { composeInstructions } from "./compose";
import { BASE, FRAGMENTS } from "./generated";

const base = [
  { source: "base/10-identity.md", text: "You are helpful." },
  { source: "base/20-safety.md", text: "" },
  { source: "base/50-formatting.md", text: "Use Markdown." },
];

describe("composeInstructions", () => {
  it("is empty when no layer has text", () => {
    expect(composeInstructions({})).toEqual({ sections: [], text: "" });
    expect(
      composeInstructions({ agent: "", base: BASE, dynamic: [], mentions: "" })
    ).toEqual({ sections: [], text: "" });
  });

  it("adds nothing for the base files as they are today", () => {
    expect(composeInstructions({ agent: "Be terse.", base: BASE })).toEqual({
      sections: [{ layer: "agent", source: "agent", text: "Be terse." }],
      text: "Be terse.",
    });
  });

  it("orders the layers: base, agent, dynamic, mentions, memory", () => {
    const composed = composeInstructions({
      agent: "Be terse.",
      base,
      dynamic: [FRAGMENTS.workspace],
      memory: "## Memory",
      mentions: "<workspace-file/>",
    });
    expect(composed.sections).toEqual([
      {
        layer: "base",
        source: "base/10-identity.md",
        text: "You are helpful.",
      },
      { layer: "base", source: "base/50-formatting.md", text: "Use Markdown." },
      { layer: "agent", source: "agent", text: "Be terse." },
      {
        layer: "dynamic",
        source: "fragments/workspace.md",
        text: FRAGMENTS.workspace.text,
      },
      {
        layer: "mentions",
        source: "fragments/mentions.md",
        text: "<workspace-file/>",
      },
      { layer: "memory", source: "fragments/memory.md", text: "## Memory" },
    ]);
    expect(composed.text).toBe(
      [
        "You are helpful.",
        "Use Markdown.",
        "Be terse.",
        FRAGMENTS.workspace.text,
        "<workspace-file/>",
        "## Memory",
      ].join("\n\n")
    );
  });

  it("keeps the agent's instructions exactly when nothing follows them", () => {
    expect(composeInstructions({ agent: "\n  Be terse.\n\n" }).text).toBe(
      "\n  Be terse.\n\n"
    );
    expect(
      composeInstructions({ agent: "Be terse.\n", mentions: "<file/>" }).text
    ).toBe("Be terse.\n\n\n<file/>");
  });

  it("trims what comes before a memory section, as the memory wrapper always has", () => {
    expect(
      composeInstructions({ memory: "## Memory", preceding: "\n  Be terse.\n" })
    ).toEqual({
      sections: [
        { layer: "preceding", source: "preceding", text: "\n  Be terse.\n" },
        { layer: "memory", source: "fragments/memory.md", text: "## Memory" },
      ],
      text: "Be terse.\n\n## Memory",
    });
    expect(
      composeInstructions({ memory: "## Memory", preceding: "  " }).text
    ).toBe("## Memory");
    expect(composeInstructions({ memory: "## Memory" }).text).toBe("## Memory");
  });

  it("puts the artifact kinds' instructions after the fragments and before the mentions", () => {
    const composed = composeInstructions({
      dynamic: [FRAGMENTS.workspace],
      kinds: [
        { source: "kinds/html", text: "" },
        { source: "kinds/site", text: "Sites are static." },
      ],
      mentions: "<workspace-file/>",
    });
    expect(
      composed.sections.map(({ layer, source }) => [layer, source])
    ).toEqual([
      ["dynamic", "fragments/workspace.md"],
      ["kinds", "kinds/site"],
      ["mentions", "fragments/mentions.md"],
    ]);
    expect(composed.text).toBe(
      [FRAGMENTS.workspace.text, "Sites are static.", "<workspace-file/>"].join(
        "\n\n"
      )
    );
  });

  it("adds nothing for kinds whose instructions are empty", () => {
    expect(
      composeInstructions({
        agent: "Be terse.",
        kinds: [{ source: "kinds/html", text: "" }],
      })
    ).toEqual(composeInstructions({ agent: "Be terse." }));
  });
});

describe("composeInstructions with skills (127)", () => {
  it("puts skills after the agent and before the turn's fragments, each with its source", () => {
    const composed = composeInstructions({
      agent: "Be terse.",
      dynamic: [FRAGMENTS.workspace],
      skills: [
        { source: "skill:a@1", text: "Skill A." },
        { source: "fragments/skills.md", text: "" },
      ],
    });
    expect(
      composed.sections.map(({ layer, source }) => [layer, source])
    ).toEqual([
      ["agent", "agent"],
      ["skills", "skill:a@1"],
      ["dynamic", "fragments/workspace.md"],
    ]);
    expect(composed.text).toBe(
      `Be terse.\n\nSkill A.\n\n${FRAGMENTS.workspace.text}`
    );
  });
});
