import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { agentItem, fixtureId } from "@workspace/contract/fixtures";
import type { ModelOption } from "@workspace/contract/schemas/models";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import type { AgentOption } from "../schemas";
import { TargetPicker } from "./target-picker";

const i18n = setupI18n({ locale: "en", messages: { en: {} } });

const option = (
  selector: string,
  target: string | null,
  label = selector,
  available = true
): ModelOption => ({
  available,
  capabilities: [],
  contextWindow: null,
  label,
  selector,
  target,
});

const MODELS: readonly ModelOption[] = [
  option("auto", null, "Auto"),
  {
    ...option("strong", "anthropic:claude-opus-5-5", "strong"),
    capabilities: ["tools", "vision", "reasoning"],
    contextWindow: 200_000,
    cost: { input: 5_000_000, output: 25_000_000, tier: 4 },
    description: "Hard problems and long documents",
    displayName: "Claude Opus 5.5",
    provider: "anthropic",
    ratings: { intelligence: 5, speed: 2 },
  },
  {
    ...option("fast", "anthropic:claude-haiku-5", "fast", false),
    displayName: "Claude Haiku 5",
    provider: "anthropic",
  },
  // An older server: no display name or vendor, so the label's prefix goes.
  {
    ...option("gateway:openai/gpt-6", "gateway:openai/gpt-6", "openai/gpt-6"),
    contextWindow: 400_000,
  },
  {
    ...option("acme:rocket-1", "acme:rocket-1", "rocket-1"),
    displayName: "Rocket 1",
    provider: "acme",
  },
];

// An alias's row reads as the model it names (114).
const FAST = /^Claude Haiku 5/;
const STRONG = /^Claude Opus 5\.5/;
const GPT = /^gpt-6/;
const ROCKET = /^Rocket 1/;
const REVIEWER = /^Reviewer/;
const AUTO = /^Auto/;
const O4_MINI = /^o4-mini/;
const TEXT_SIZE = /\btext-(xs|sm|base|lg)\b/;

const AGENTS: readonly AgentOption[] = [
  { ...agentItem, source: "mine" },
  {
    ...agentItem,
    description: "",
    id: fixtureId("libraryItem", 41),
    name: "Ada's drafter",
    source: "shared",
  },
];

const renderPicker = (
  value: RunTarget = { model: "auto", type: "model" },
  {
    models = MODELS,
    recentsKey = "user-1",
  }: { models?: readonly ModelOption[]; recentsKey?: string } = {}
) => {
  const onChange = vi.fn<(target: RunTarget) => void>();
  const view = render(
    <I18nProvider i18n={i18n}>
      <TargetPicker
        agents={AGENTS}
        models={models}
        onChange={onChange}
        recentsKey={recentsKey}
        value={value}
      />
    </I18nProvider>
  );
  return { onChange, view };
};

const open = async (name: string) => {
  const trigger = screen.getByRole("button", { name });
  await userEvent.click(trigger);
  await screen.findByRole("listbox");
  return trigger;
};

const optionNames = () =>
  screen.getAllByRole("option").map((each) => each.textContent?.trim());

const card = () =>
  document.querySelector<HTMLElement>("[data-slot=preview-pane-content]");

const groupHeadings = () =>
  [...document.querySelectorAll("[cmdk-group]")].map(
    (group) => group.querySelector("[cmdk-group-heading]")?.textContent ?? ""
  );

const vendorOf = (name: RegExp) =>
  screen
    .getByRole("option", { name })
    .querySelector("[data-slot=model-selector-vendor]")?.textContent;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TargetPicker", () => {
  it("lists Auto, then each provider, then agents, with a divider between sections", async () => {
    renderPicker();
    await open("Model or agent: Auto");
    expect(groupHeadings()).toEqual([
      "",
      "Anthropic",
      "OpenAI",
      "acme",
      "My agents",
      "Shared with me",
    ]);
    expect(screen.getAllByRole("separator")).toHaveLength(
      groupHeadings().length - 1
    );
    // Auto's row is just its name (its card says what it does); an alias
    // shows as the model behind it, not as the alias (114).
    expect(optionNames()[0]).toBe("Auto");
    expect(optionNames()[1]).toBe("Claude Opus 5.5Anthropic");
    expect(
      screen.getByRole("option", { name: STRONG }).textContent
    ).not.toContain("strong");
  });

  it("names rows without the vendor prefix, with the vendor at the end (099)", async () => {
    renderPicker();
    await open("Model or agent: Auto");
    expect(screen.getByRole("option", { name: GPT }).textContent).not.toContain(
      "openai/"
    );
    expect(vendorOf(GPT)).toBe("OpenAI");
    expect(vendorOf(ROCKET)).toBe("acme");
    // Agents have no vendor.
    expect(vendorOf(REVIEWER)).toBeUndefined();
  });

  it("draws the vendor's logo, or a letter mark for one it doesn't know (099)", async () => {
    renderPicker();
    await open("Model or agent: Auto");
    const logo = (name: RegExp) =>
      screen
        .getByRole("option", { name })
        .querySelector<HTMLElement>("[data-slot=model-selector-logo]");
    expect(logo(STRONG)?.dataset.brand).toBe("anthropic");
    expect(logo(STRONG)?.querySelector("svg path")).toBeTruthy();
    expect(logo(GPT)?.dataset.brand).toBe("openai");
    expect(logo(ROCKET)?.dataset.brand).toBeUndefined();
    expect(logo(ROCKET)?.textContent).toBe("a");
  });

  it("leaves a model's description to the card, and still finds it by it (105)", async () => {
    renderPicker();
    await open("Model or agent: Auto");
    const strong = screen.getByRole("option", { name: STRONG });
    expect(strong.textContent).not.toContain("Hard problems");
    // The name and the vendor are one size; only the colour sets it apart.
    const name = strong.querySelector("[data-slot=model-selector-name]");
    const vendor = strong.querySelector("[data-slot=model-selector-vendor]");
    expect(vendor?.className).not.toMatch(TEXT_SIZE);
    expect(name?.className).not.toMatch(TEXT_SIZE);
    expect(vendor?.className).toContain("text-muted-foreground");
    await userEvent.keyboard("long documents");
    await waitFor(() => expect(optionNames()).toHaveLength(1));
    expect(optionNames()[0]).toContain("Claude Opus 5.5");
  });

  it("finds an alias's row by the alias, and sends the alias (114)", async () => {
    const { onChange } = renderPicker();
    await open("Model or agent: Auto");
    await userEvent.keyboard("strong");
    // Auto matches too: its own words say it picks a fast or strong model.
    await waitFor(() =>
      expect(optionNames()).toEqual(["Auto", "Claude Opus 5.5Anthropic"])
    );
    // No CSS loads here, so the backdrop would swallow a real pointer.
    fireEvent.click(screen.getByRole("option", { name: STRONG }));
    expect(onChange).toHaveBeenCalledWith({ model: "strong", type: "model" });
  });

  it("keeps options without a key visible, disabled, with the reason", async () => {
    renderPicker();
    await open("Model or agent: Auto");
    const fast = screen.getByRole("option", { name: FAST });
    expect(fast.getAttribute("aria-disabled")).toBe("true");
    expect(fast.textContent).toContain("No key in this context");
  });

  it("searches every model and agent, and picks by keyboard", async () => {
    const { onChange } = renderPicker();
    const trigger = await open("Model or agent: Auto");
    await userEvent.keyboard("gpt");
    await waitFor(() => expect(optionNames()).toHaveLength(1));
    expect(optionNames()[0]).toContain("gpt-6");

    // Provider names match too: every Anthropic model, in any word order.
    const search = screen.getByRole("combobox", { name: "Models and agents" });
    await userEvent.clear(search);
    await userEvent.keyboard("anthropic");
    await waitFor(() => expect(optionNames()).toHaveLength(2));
    await userEvent.clear(search);
    await userEvent.keyboard("opus anth");
    await waitFor(() => expect(optionNames()).toHaveLength(1));

    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith({ model: "strong", type: "model" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("says when nothing matches, and Escape returns to the button", async () => {
    const { onChange } = renderPicker({
      id: AGENTS[0]?.id ?? agentItem.id,
      type: "agent",
    });
    const trigger = await open("Model or agent: Reviewer");
    await userEvent.keyboard("zzz");
    expect(await screen.findByText("Nothing matches.")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opens as a modal overlay with focus in the search (105)", async () => {
    renderPicker();
    await open("Model or agent: Auto");
    const dialog = screen.getByRole("dialog", {
      name: "Choose a model or agent",
    });
    // Modal: the page behind it is covered and inert.
    expect(document.querySelector("[data-base-ui-inert]")).toBeTruthy();
    // Not anchored to the button: no popover positioner around it.
    expect(dialog.closest("[data-side]")).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("combobox", { name: "Models and agents" })
      )
    );
  });

  it("lists a mode of a model once, under the model (105)", async () => {
    const models: readonly ModelOption[] = [
      {
        ...option("openai:o4-mini", "openai:o4-mini", "o4-mini"),
        capabilities: ["reasoning"],
      },
      option("openai:o4-mini-high", "openai:o4-mini-high", "o4-mini-high"),
    ];
    renderPicker({ model: "openai:o4-mini-high", type: "model" }, { models });
    await open("Model or agent: o4-mini");
    expect(optionNames().filter((name) => name?.startsWith("o4-mini"))).toEqual(
      ["o4-miniOpenAI"]
    );
    expect(
      screen.getByRole("option", { name: O4_MINI }).getAttribute("aria-current")
    ).toBe("true");
  });

  it("starts on the current choice and moves with the arrow keys", async () => {
    const { onChange } = renderPicker({ model: "strong", type: "model" });
    await open("Model or agent: Claude Opus 5.5");
    const selected = () =>
      screen
        .getAllByRole("option")
        .find((each) => each.getAttribute("aria-selected") === "true")
        ?.textContent;
    await waitFor(() => expect(selected()).toContain("Claude Opus 5.5"));
    // Down skips the disabled `fast` and lands on OpenAI's model.
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith({
      model: "gateway:openai/gpt-6",
      type: "model",
    });
  });

  it("hides Auto when the server doesn't offer it", async () => {
    renderPicker(
      { model: "strong", type: "model" },
      { models: MODELS.filter((model) => model.selector !== "auto") }
    );
    await open("Model or agent: Claude Opus 5.5");
    expect(groupHeadings()[0]).toBe("Anthropic");
    expect(screen.queryByRole("option", { name: AUTO })).toBeNull();
  });
});

describe("TargetPicker's preview card (099)", () => {
  it("follows the highlighted row by keyboard", async () => {
    renderPicker({ model: "strong", type: "model" });
    await open("Model or agent: Claude Opus 5.5");
    await waitFor(() =>
      expect(card()?.textContent).toContain("Claude Opus 5.5")
    );
    // Full data: the three bars, context, capabilities and the description.
    const meters = [...(card()?.querySelectorAll("meter") ?? [])];
    expect(meters.map((meter) => meter.getAttribute("aria-label"))).toEqual([
      "Speed",
      "Intelligence",
      "Cost",
    ]);
    expect(meters.map((meter) => meter.value)).toEqual([2, 5, 4]);
    const text = card()?.textContent ?? "";
    for (const part of [
      "~150K words",
      "200K tokens",
      "Vision",
      "Tool use",
      "Reasoning",
      "Hard problems and long documents",
    ]) {
      expect(text).toContain(part);
    }

    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(card()?.textContent).toContain("gpt-6"));
    // Partial data: no bars, so it says so; the context it does know.
    expect(card()?.querySelectorAll("meter")).toHaveLength(0);
    expect(card()?.textContent).toContain("No ratings or prices for gpt-6");
    expect(card()?.textContent).toContain("400K tokens");
    expect(card()?.textContent).not.toContain("Vision");
  });

  it("follows the current choice the model list settles on, until the person moves (132)", async () => {
    // Opened before the list loads: the choice is the guess, Auto.
    const { onChange, view } = renderPicker(
      { model: "auto", type: "model" },
      { models: [] }
    );
    await open("Model or agent: Auto");
    await waitFor(() =>
      expect(card()?.textContent).toContain("Picks a fast or strong model")
    );
    const settle = (value: RunTarget) =>
      view.rerender(
        <I18nProvider i18n={i18n}>
          <TargetPicker
            agents={AGENTS}
            models={MODELS}
            onChange={onChange}
            recentsKey="user-1"
            value={value}
          />
        </I18nProvider>
      );
    settle({ model: "strong", type: "model" });
    await waitFor(() =>
      expect(card()?.textContent).toContain("Claude Opus 5.5")
    );
    // Once the person has moved, a change of choice leaves them there.
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(card()?.textContent).toContain("gpt-6"));
    settle({ model: "acme:rocket-1", type: "model" });
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith({
      model: "gateway:openai/gpt-6",
      type: "model",
    });
  });

  it("follows the pointer too, and shows an agent's own description", async () => {
    renderPicker();
    await open("Model or agent: Auto");
    await waitFor(() =>
      expect(card()?.textContent).toContain("Picks a fast or strong model")
    );
    fireEvent.pointerMove(screen.getByRole("option", { name: ROCKET }));
    await waitFor(() => expect(card()?.textContent).toContain("Rocket 1"));
    fireEvent.pointerMove(screen.getByRole("option", { name: REVIEWER }));
    await waitFor(() =>
      expect(card()?.textContent).toBe("ReviewerReviews diffs hunk by hunk.")
    );
  });
});

describe("TargetPicker's Recently used (099)", () => {
  const pick = async (name: RegExp) => {
    await open("Model or agent: Auto");
    // The dialog's backdrop covers the page; these tests load no CSS, so the
    // panel isn't lifted above it and a real pointer can't reach a row.
    fireEvent.click(screen.getByRole("option", { name }));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  };

  it("remembers the last three picks per user, newest first", async () => {
    const { view } = renderPicker();
    await pick(STRONG);
    await pick(GPT);
    await pick(REVIEWER);
    await pick(ROCKET);
    await open("Model or agent: Auto");
    expect(groupHeadings()[0]).toBe("Recently used");
    const recent = document.querySelector("[cmdk-group]");
    expect(
      [...(recent?.querySelectorAll("[cmdk-item]") ?? [])].map((row) =>
        row.getAttribute("data-value")
      )
    ).toEqual([
      "recent:model:acme:rocket-1",
      `recent:agent:${agentItem.id}`,
      "recent:model:gateway:openai/gpt-6",
    ]);
    expect(
      JSON.parse(localStorage.getItem("composer:recent-targets:user-1") ?? "[]")
    ).toHaveLength(3);
    // Searching hides the section: a match shows once, in its own group.
    await userEvent.keyboard("rocket");
    await waitFor(() => expect(optionNames()).toHaveLength(1));
    view.unmount();

    // Someone else on this browser has their own list.
    renderPicker(undefined, { recentsKey: "user-2" });
    await open("Model or agent: Auto");
    expect(groupHeadings()).not.toContain("Recently used");
  });

  it("works for the session when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderPicker();
    await pick(STRONG);
    await open("Model or agent: Auto");
    expect(groupHeadings()[0]).toBe("Recently used");
  });
});
