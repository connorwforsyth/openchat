import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { agentItem, fixtureId } from "@workspace/contract/fixtures";
import type { ModelOption } from "@workspace/contract/schemas/models";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    description: "Hard problems and long documents",
    provider: "anthropic",
  },
  option("fast", "anthropic:claude-haiku-5", "fast", false),
  option("gateway:openai/gpt-6", "gateway:openai/gpt-6", "openai/gpt-6"),
];

const FAST = /^fast/;
const STRONG = /^strong/;

const AGENTS: readonly AgentOption[] = [
  { ...agentItem, source: "mine" },
  {
    ...agentItem,
    id: fixtureId("libraryItem", 41),
    name: "Ada's drafter",
    source: "shared",
  },
];

const renderPicker = (value: RunTarget = { model: "auto", type: "model" }) => {
  const onChange = vi.fn<(target: RunTarget) => void>();
  render(
    <I18nProvider i18n={i18n}>
      <TargetPicker
        agents={AGENTS}
        models={MODELS}
        onChange={onChange}
        value={value}
      />
    </I18nProvider>
  );
  return { onChange };
};

const open = async (name: string) => {
  const trigger = screen.getByRole("button", { name });
  await userEvent.click(trigger);
  await screen.findByRole("listbox");
  return trigger;
};

const optionNames = () =>
  screen.getAllByRole("option").map((each) => each.textContent?.trim());

afterEach(() => {
  cleanup();
});

describe("TargetPicker", () => {
  it("lists Auto, then each provider, then agents, with a divider between sections", async () => {
    renderPicker();
    await open("Model or agent: Auto");
    const groups = [...document.querySelectorAll("[cmdk-group]")].map(
      (group) => group.querySelector("[cmdk-group-heading]")?.textContent ?? ""
    );
    expect(groups).toEqual([
      "",
      "Anthropic",
      "OpenAI",
      "My agents",
      "Shared with me",
    ]);
    expect(screen.getAllByRole("separator")).toHaveLength(groups.length - 1);
    // Auto says what it does; an alias shows the model behind it.
    expect(optionNames()[0]).toContain(
      "Picks a fast or strong model for each message"
    );
    expect(screen.getByRole("option", { name: STRONG }).textContent).toContain(
      "claude-opus-5-5"
    );
    // A ref's label already is its model: no second name beside it.
    expect(screen.getByRole("option", { name: "openai/gpt-6" })).toBeTruthy();
  });

  it("shows a model's description under its name, and finds it by it (096)", async () => {
    renderPicker();
    await open("Model or agent: Auto");
    const strong = screen.getByRole("option", { name: STRONG });
    const line = [...strong.querySelectorAll("span")].find(
      (span) => span.textContent === "Hard problems and long documents"
    );
    expect(line).toBeTruthy();
    // Options without one have no second line: just the mark and the name.
    expect(
      screen
        .getByRole("option", { name: "openai/gpt-6" })
        .querySelectorAll(".text-xs")
    ).toHaveLength(0);
    await userEvent.keyboard("long documents");
    await waitFor(() => expect(optionNames()).toHaveLength(1));
    expect(optionNames()[0]).toContain("strong");
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
    expect(optionNames()[0]).toContain("openai/gpt-6");

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

  it("starts on the current choice and moves with the arrow keys", async () => {
    const { onChange } = renderPicker({ model: "strong", type: "model" });
    await open("Model or agent: strong");
    const selected = () =>
      screen
        .getAllByRole("option")
        .find((each) => each.getAttribute("aria-selected") === "true")
        ?.textContent;
    await waitFor(() => expect(selected()).toContain("strong"));
    // Down skips the disabled `fast` and lands on OpenAI's model.
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith({
      model: "gateway:openai/gpt-6",
      type: "model",
    });
  });
});
