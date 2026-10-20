import {
  agentItem,
  fixtureId,
  me,
  modelOptions,
  org,
  teamPlatform,
} from "@workspace/contract/fixtures";
import type { LibraryItemId } from "@workspace/contract/schemas/common";
import type { ModelOption } from "@workspace/contract/schemas/models";
import { describe, expect, it } from "vitest";
import { fileCandidate } from "./mentions";
import {
  AUTO_TARGET,
  bareModelName,
  buildTargetGroups,
  contextKey,
  contextOptionsFromMe,
  contextSize,
  filterMentions,
  filterPrompts,
  filterSkills,
  filterTargetGroups,
  findTargetChoice,
  isAutoTarget,
  matchesSearch,
  modelName,
  modelVendor,
  providerLabel,
  recentChoices,
  rememberRecent,
  slashItems,
  targetKey,
  unpickedSkills,
} from "./options";
import type { MentionCandidate, PromptOption, SkillOption } from "./schemas";

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
          ["Claude Opus 5.5", true],
          ["claude-haiku-5", false],
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
    ).toBe("Claude Opus 5.5");
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

  it("takes the server's provider when it sends one (096)", () => {
    // The server knows better than the ref: a vendor it named wins.
    expect(
      modelVendor({ ...model("house", "custom:llama-x"), provider: "meta" })
    ).toBe("meta");
    const groups = buildTargetGroups(
      [
        { ...model("house", "custom:llama-x"), provider: "meta" },
        model("custom:other", "custom:other"),
      ],
      []
    );
    expect(groups.providers.map((group) => group.label)).toEqual([
      "Meta",
      "custom",
    ]);
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
      // A ref's row drops the vendor its section and row end already say.
      // An alias with no display name reads as the model id it names (114).
      ["Anthropic", ["claude-opus-5-5", "claude-haiku-4.5"]],
      ["Google", ["gemini-3-pro"]],
    ]);
  });
});

describe("model names (099)", () => {
  it("drops the vendor prefix, preferring the server's display name", () => {
    expect(bareModelName("anthropic/claude-opus-4")).toBe("claude-opus-4");
    expect(bareModelName("echo")).toBe("echo");
    expect(
      modelName({
        ...model("gateway:openai/gpt-6", "gateway:openai/gpt-6"),
        label: "openai/gpt-6",
      })
    ).toBe("gpt-6");
    expect(
      modelName({
        ...model("gateway:openai/gpt-6", "gateway:openai/gpt-6"),
        displayName: "GPT-6",
      })
    ).toBe("GPT-6");
  });

  it("labels a ref and an alias alike by the model's name (114)", () => {
    const groups = buildTargetGroups(
      [
        {
          ...model("strong", "anthropic:claude-opus-5-5"),
          displayName: "Claude Opus 5.5",
        },
        {
          ...model("anthropic:claude-haiku-5", "anthropic:claude-haiku-5"),
          displayName: "Claude Haiku 5",
        },
      ],
      []
    );
    const [strong, haiku] = groups.providers[0]?.choices ?? [];
    // An alias shows as the model it names, with nothing beside it; it
    // still sends the alias, so chats saved with it keep working.
    expect(strong?.label).toBe("Claude Opus 5.5");
    expect(strong).not.toHaveProperty("detail");
    expect(strong?.target).toEqual({ model: "strong", type: "model" });
    expect(strong?.search).toContain("strong");
    expect(haiku?.label).toBe("Claude Haiku 5");
    expect(haiku).not.toHaveProperty("detail");
    // The display name is searchable, and the choice keeps its model.
    expect(haiku?.search).toContain("claude haiku 5");
    expect(haiku?.model?.selector).toBe("anthropic:claude-haiku-5");
    expect(haiku?.vendor).toBe("anthropic");
  });

  it("names vendors from the brand list, and unknown ones as written", () => {
    expect(providerLabel("x-ai")).toBe("xAI");
    expect(providerLabel("meta-llama")).toBe("Meta");
    expect(providerLabel("acme")).toBe("acme");
  });

  it("offers Auto only when the server lists it", () => {
    expect(buildTargetGroups(modelOptions, []).autoOffered).toBe(true);
    expect(
      buildTargetGroups([model("openai:gpt-6", "openai:gpt-6")], []).autoOffered
    ).toBe(false);
  });
});

describe("contextSize (099)", () => {
  it("is compact, in tokens and roughly in words", () => {
    expect(contextSize(200_000, "en")).toEqual({
      tokens: "200K",
      words: "150K",
    });
    expect(contextSize(1_048_576, "en").tokens).toBe("1M");
  });
});

describe("recent picks (099)", () => {
  it("keeps the newest three, without repeats", () => {
    let keys: readonly string[] = [];
    for (const key of ["a", "b", "a", "c", "d"]) {
      keys = rememberRecent(keys, key);
    }
    expect(keys).toEqual(["d", "c", "a"]);
  });

  it("drops picks the list no longer offers", () => {
    const groups = buildTargetGroups(
      [model("openai:gpt-6", "openai:gpt-6")],
      [agentItem]
    );
    expect(
      recentChoices(groups, [
        "model:openai:gone",
        `agent:${agentItem.id}`,
        "model:openai:gpt-6",
      ]).map((choice) => choice.key)
    ).toEqual([`agent:${agentItem.id}`, "model:openai:gpt-6"]);
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
      "Claude Opus 5.5",
      "claude-haiku-5",
      "openai:gpt-6",
      "Reviewer",
    ]);
  });

  it("matches label, alias, ref and provider, every word in any order", () => {
    expect(labels("haiku")).toEqual(["claude-haiku-5"]);
    expect(labels("Anthropic")).toEqual(["Claude Opus 5.5", "claude-haiku-5"]);
    expect(labels("opus anth")).toEqual(["Claude Opus 5.5"]);
    // An alias still finds the model it names (114).
    expect(labels("strong")).toEqual(["Claude Opus 5.5"]);
    expect(labels("fast")).toEqual(["claude-haiku-5"]);
    expect(labels("review")).toEqual(["Reviewer"]);
    expect(labels("picks")).toEqual(["Auto"]);
    expect(labels("nothing-like-it")).toEqual([]);
  });

  it("matches a model's description, and carries it to the choice (096)", () => {
    expect(labels("hard problems")).toEqual(["Claude Opus 5.5"]);
    const strong = groups.providers[0]?.choices[0];
    expect(strong?.description).toBe("Hard problems and long documents");
    // No description, no empty second line.
    expect(groups.providers[0]?.choices[1]).not.toHaveProperty("description");
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
        case "skill":
          return `skill:${item.skill.name}`;
        case "connector":
          return `connector:${item.connector.name}`;
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

  it("finds connectors to switch for this chat, after the rest (188)", () => {
    const docs = {
      auth: "none" as const,
      availability: { state: "available" as const },
      customized: false,
      description: null,
      disabledTools: [],
      enabled: true,
      id: "0199a000-0000-7000-8000-0000000000aa" as LibraryItemId,
      lock: null,
      name: "docs",
      requiredTools: [],
      source: "instance" as const,
      title: "Company docs",
      transport: "http" as const,
    };
    expect(
      kinds(
        slashItems("", { commands: [], connectors: [docs], files, prompts })
      )
    ).toEqual(["New feature"]);
    expect(
      kinds(
        slashItems("doc", { commands: [], connectors: [docs], files, prompts })
      )
    ).toEqual(["connector:docs"]);
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

  it("lists skills after prompts, matched by name or description (127)", () => {
    const skills = [
      skill(31, "Haiku", "Short poems"),
      skill(32, "Release notes"),
    ];
    expect(
      kinds(slashItems("", { commands: ["new-file"], files, prompts, skills }))
    ).toEqual([
      "/new-file",
      "New feature",
      "skill:Haiku",
      "skill:Release notes",
    ]);
    expect(
      kinds(slashItems("poem", { commands: [], files, prompts, skills }))
    ).toEqual(["skill:Haiku"]);
    expect(
      kinds(slashItems("open:", { commands: ["open"], files, prompts, skills }))
    ).toEqual(["src/app.ts", "README.md"]);
  });
});

const skill = (n: number, name: string, description = ""): SkillOption => ({
  description,
  id: fixtureId("libraryItem", n),
  name,
});

describe("skills (127)", () => {
  const skills = [
    skill(31, "Haiku", "Short poems"),
    skill(32, "Release notes", "Group changes by area"),
  ];

  it("finds a skill by its name or its description", () => {
    expect(filterSkills(skills, "").map((each) => each.name)).toEqual([
      "Haiku",
      "Release notes",
    ]);
    expect(filterSkills(skills, "group").map((each) => each.name)).toEqual([
      "Release notes",
    ]);
  });

  it("leaves out the skills already on the message", () => {
    expect(unpickedSkills(skills, [])).toBe(skills);
    expect(
      unpickedSkills(skills, [{ id: fixtureId("libraryItem", 31) }]).map(
        (each) => each.name
      )
    ).toEqual(["Release notes"]);
  });
});
