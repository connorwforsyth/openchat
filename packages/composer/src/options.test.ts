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
import { fileCandidate } from "./mentions";
import {
  AUTO_TARGET,
  buildTargetGroups,
  contextKey,
  contextOptionsFromMe,
  filterMentions,
  filterPrompts,
  filterTargetGroups,
  findTargetChoice,
  isAutoTarget,
  matchesSearch,
  modelVendor,
  providerLabel,
  slashItems,
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
  it("groups agents by where they come from, in library-tab order", () => {
    const agent = (name: string, source?: "mine" | "shared" | "libraries") => ({
      ...agentItem,
      id: fixtureId("libraryItem", 100 + name.length),
      name,
      source,
    });
    const groups = buildTargetGroups(modelOptions, [
      agent("Team helper", "libraries"),
      agent("Mine", "mine"),
      agent("From Ada", "shared"),
    ]);
    expect(
      groups.agentGroups.map((group) => [
        group.source,
        group.choices.map((choice) => choice.label),
      ])
    ).toEqual([
      ["mine", ["Mine"]],
      ["shared", ["From Ada"]],
      ["libraries", ["Team helper"]],
    ]);
    expect(groups.agents.map((choice) => choice.label)).toEqual([
      "Mine",
      "From Ada",
      "Team helper",
    ]);
  });

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

describe("model vendors", () => {
  it("reads the vendor after the colon for a gateway ref, else the provider", () => {
    expect(modelVendor(model("gateway:anthropic/claude-haiku-4.5", null))).toBe(
      "anthropic"
    );
    expect(modelVendor(model("fast", "gateway:openai/gpt-6"))).toBe("openai");
    expect(modelVendor(model("strong", "anthropic:claude-opus-5-5"))).toBe(
      "anthropic"
    );
    expect(modelVendor(model("ollama:llama3.3:70b", null))).toBe("ollama");
    expect(modelVendor(model("mystery", null))).toBe("");
  });

  it("names known vendors and leaves the rest as written", () => {
    expect(providerLabel("openai")).toBe("OpenAI");
    expect(providerLabel("xai")).toBe("xAI");
    expect(providerLabel("acme")).toBe("acme");
  });

  it("groups a gateway's models under their vendors, beside direct ones", () => {
    const groups = buildTargetGroups(
      [
        model("strong", "anthropic:claude-opus-5-5"),
        model(
          "gateway:anthropic/claude-haiku-4.5",
          "gateway:anthropic/claude-haiku-4.5"
        ),
        model("gateway:google/gemini-3-pro", "gateway:google/gemini-3-pro"),
      ],
      []
    );
    expect(
      groups.providers.map((group) => [
        group.label,
        group.choices.map((choice) => choice.label),
      ])
    ).toEqual([
      ["Anthropic", ["strong", "gateway:anthropic/claude-haiku-4.5"]],
      ["Google", ["gateway:google/gemini-3-pro"]],
    ]);
    // An alias shows the model it stands for; a ref doesn't repeat itself.
    expect(groups.providers[0]?.choices.map((choice) => choice.detail)).toEqual(
      ["claude-opus-5-5", undefined]
    );
  });
});

describe("filterTargetGroups", () => {
  const groups = buildTargetGroups(
    [
      ...modelOptions,
      model("fast", "anthropic:claude-haiku-5"),
      model("openai:gpt-6", "openai:gpt-6"),
    ],
    [agentItem]
  );
  const labels = (query: string) => {
    const shown = filterTargetGroups(groups, query, "Auto picks a model");
    return [
      ...(shown.auto ? ["Auto"] : []),
      ...shown.providers.flatMap((group) =>
        group.choices.map((choice) => choice.label)
      ),
      ...shown.agentGroups.flatMap((group) =>
        group.choices.map((choice) => choice.label)
      ),
    ];
  };

  it("lists everything for an empty query", () => {
    expect(labels("  ")).toEqual([
      "Auto",
      "Strong",
      "fast",
      "openai:gpt-6",
      "Reviewer",
    ]);
  });

  it("matches label, alias, ref and provider, every word in any order", () => {
    expect(labels("haiku")).toEqual(["fast"]);
    expect(labels("Anthropic")).toEqual(["Strong", "fast"]);
    expect(labels("opus anth")).toEqual(["Strong"]);
    expect(labels("review")).toEqual(["Reviewer"]);
    expect(labels("picks")).toEqual(["Auto"]);
    expect(labels("nothing-like-it")).toEqual([]);
  });

  it("drops groups left empty", () => {
    const shown = filterTargetGroups(groups, "gpt", "Auto");
    expect(shown.providers.map((group) => group.provider)).toEqual(["openai"]);
    expect(shown.agentGroups).toEqual([]);
  });

  it("matchesSearch ignores case and word order", () => {
    expect(matchesSearch("anthropic claude-opus", "OPUS Anthropic")).toBe(true);
    expect(matchesSearch("anthropic claude-opus", "opus google")).toBe(false);
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

describe("filterMentions with files", () => {
  const candidates: MentionCandidate[] = [
    fileCandidate("docs/adr.md"),
    { id: me.user.id, kind: "user", label: "Ada" },
    fileCandidate("src/app.ts"),
  ];

  it("lists people before files, and finds files by path", () => {
    expect(filterMentions(candidates, "ad").map((c) => c.label)).toEqual([
      "Ada",
      "adr.md",
    ]);
    expect(filterMentions(candidates, "src").map((c) => c.label)).toEqual([
      "app.ts",
    ]);
  });
});

describe("slashItems", () => {
  const prompts = [prompt(24, "New feature", "newfeat")];
  const files = [fileCandidate("src/app.ts"), fileCandidate("README.md")];
  const kinds = (items: ReturnType<typeof slashItems>) =>
    items.map((item) => {
      switch (item.kind) {
        case "command":
          return `/${item.command}`;
        case "file":
          return item.file.path;
        default:
          return item.prompt.name;
      }
    });

  it("offers the host's commands, in a fixed order, before prompts", () => {
    expect(
      kinds(
        slashItems("", { commands: ["preview", "new-file"], files, prompts })
      )
    ).toEqual(["/new-file", "/preview", "New feature"]);
    expect(
      kinds(slashItems("new", { commands: ["new-file"], files, prompts }))
    ).toEqual(["/new-file", "New feature"]);
  });

  it("offers no commands the host didn't ask for", () => {
    expect(kinds(slashItems("", { commands: [], files, prompts }))).toEqual([
      "New feature",
    ]);
  });

  it("lists files to open after /open:", () => {
    expect(
      kinds(slashItems("open:", { commands: ["open"], files, prompts }))
    ).toEqual(["src/app.ts", "README.md"]);
    expect(
      kinds(slashItems("open:read", { commands: ["open"], files, prompts }))
    ).toEqual(["README.md"]);
  });
});
