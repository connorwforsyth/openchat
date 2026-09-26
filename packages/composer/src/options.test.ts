import {
  agentItem,
  fixtureId,
  me,
  modelOptions,
  org,
  teamPlatform,
} from "@workspace/contract/fixtures";
import type { ModelOption } from "@workspace/contract/schemas/models";
import { describe, expect, it } from "vitest";

import {
  AUTO_TARGET,
  buildTargetGroups,
  contextKey,
  contextOptionsFromMe,
  filterMentions,
  filterPrompts,
  findTargetChoice,
  isAutoTarget,
  targetKey,
} from "./options";
import type { MentionCandidate, PromptOption } from "./schemas";

const model = (
  selector: string,
  target: string | null,
  available = true
): ModelOption => ({
  available,
  capabilities: [],
  contextWindow: null,
  label: selector,
  selector,
  target,
});

describe("buildTargetGroups", () => {
  it("files models under their provider and agents apart, without a second Auto", () => {
    const groups = buildTargetGroups(
      [
        ...modelOptions,
        model("openai:gpt-6", "openai:gpt-6"),
        model("fast", "anthropic:claude-haiku-5", false),
      ],
      [agentItem]
    );
    expect(groups.autoAvailable).toBe(true);
    expect(groups.agents.map((choice) => choice.label)).toEqual(["Reviewer"]);
    expect(
      groups.providers.map((group) => [
        group.provider,
        group.choices.map((choice) => [choice.label, choice.available]),
      ])
    ).toEqual([
      [
        "anthropic",
        [
          ["Strong", true],
          ["fast", false],
        ],
      ],
      ["openai", [["openai:gpt-6", true]]],
    ]);
  });

  it("marks Auto unavailable when the server says so", () => {
    expect(
      buildTargetGroups([model("auto", null, false)], []).autoAvailable
    ).toBe(false);
  });

  it("finds the current choice by target", () => {
    const groups = buildTargetGroups(modelOptions, [agentItem]);
    expect(
      findTargetChoice(groups, { id: agentItem.id, type: "agent" })?.label
    ).toBe("Reviewer");
    expect(
      findTargetChoice(groups, { model: "strong", type: "model" })?.label
    ).toBe("Strong");
    expect(findTargetChoice(groups, AUTO_TARGET)).toBeUndefined();
  });
});

describe("targetKey and isAutoTarget", () => {
  it("keys agents and models apart", () => {
    expect(targetKey({ id: agentItem.id, type: "agent" })).toBe(
      `agent:${agentItem.id}`
    );
    expect(targetKey(AUTO_TARGET)).toBe("model:auto");
    expect(isAutoTarget(AUTO_TARGET)).toBe(true);
    expect(isAutoTarget({ model: "strong", type: "model" })).toBe(false);
  });
});

describe("contextOptionsFromMe", () => {
  it("offers Personal, teams, then non-personal orgs", () => {
    const personalOrg = { ...org, id: me.personalOrgId, isPersonal: true };
    expect(
      contextOptionsFromMe({ ...me, orgs: [personalOrg, org] }, [
        "personal",
        "team",
        "org",
      ])
    ).toEqual([
      { context: { type: "personal" } },
      { context: { id: teamPlatform.id, type: "team" }, name: "Platform" },
      { context: { id: org.id, type: "org" }, name: "Example Co" },
    ]);
  });

  it("respects the instance's allowed contexts", () => {
    expect(
      contextOptionsFromMe(me, ["personal"]).map((option) =>
        contextKey(option.context)
      )
    ).toEqual(["personal"]);
  });
});

const prompt = (n: number, name: string, command?: string): PromptOption => ({
  definition: { command, kind: "prompt", template: "x", variables: [] },
  description: "",
  id: fixtureId("libraryItem", n),
  name,
});

describe("filterPrompts", () => {
  const prompts = [
    prompt(21, "Explain like I'm five", "eli5"),
    prompt(22, "Summarise", "sum"),
    prompt(23, "Release summary"),
  ];

  it("puts prefix matches on command or name first", () => {
    expect(filterPrompts(prompts, "sum").map((p) => p.name)).toEqual([
      "Summarise",
      "Release summary",
    ]);
  });

  it("lists everything for an empty query", () => {
    expect(filterPrompts(prompts, "")).toHaveLength(3);
  });

  it("finds nothing for a miss", () => {
    expect(filterPrompts(prompts, "zzz")).toEqual([]);
  });
});

describe("filterMentions", () => {
  it("matches labels, case-insensitively", () => {
    const candidates: MentionCandidate[] = [
      { id: agentItem.id, kind: "agent", label: "Reviewer" },
      { id: me.user.id, kind: "user", label: "Ada" },
    ];
    expect(filterMentions(candidates, "AD").map((c) => c.label)).toEqual([
      "Ada",
    ]);
  });
});
