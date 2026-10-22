import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { fixtureId } from "@workspace/contract/fixtures";
import { useCallback, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { type SnippetItem, snippetMenuItems } from "../snippet";
import { createTestProviders } from "../testing/providers";
import { SnippetEditor, type SnippetMenu } from "./snippet-editor";

afterEach(() => {
  cleanup();
});

const PROMPT = fixtureId("libraryItem", 20);
const EXPLAIN = /Explain a concept/;

const menu = (
  onPick: SnippetMenu["onPick"] = (item: SnippetItem) =>
    item.kind === "variable" ? `{{${item.name}}}` : null
): SnippetMenu => ({
  items: (query) =>
    snippetMenuItems(query, {
      newVariable: true,
      prompts: [{ id: PROMPT, kind: "prompt", name: "Explain a concept" }],
      variables: [{ kind: "variable", name: "current_date" }],
    }),
  onPick,
  title: "Insert",
});

function Controlled({
  initial,
  onValue,
  snippets,
}: {
  readonly initial: string;
  readonly onValue: (value: string) => void;
  readonly snippets?: SnippetMenu;
}) {
  const [value, setValue] = useState(initial);
  const change = useCallback(
    (next: string) => {
      setValue(next);
      onValue(next);
    },
    [onValue]
  );
  return (
    <>
      <span id="label">Notes</span>
      <SnippetEditor
        aria-labelledby="label"
        menu={snippets}
        onValueChange={change}
        value={value}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

const renderEditor = (initial: string, snippets?: SnippetMenu) => {
  const onValue = vi.fn();
  const view = render(
    createTestProviders().wrap(
      <Controlled initial={initial} onValue={onValue} snippets={snippets} />
    )
  );
  return { onValue, view };
};

const shown = () => screen.getByTestId("value").textContent;

/** Puts the caret at the end of the text (End differs by platform). */
const focusEnd = async () => {
  const box = await screen.findByRole("textbox", { name: "Notes" });
  box.focus();
  const selection = window.getSelection();
  selection?.selectAllChildren(box);
  selection?.collapseToEnd();
  return box;
};

describe("snippet editor", () => {
  it("opens the menu on / and inserts the variable picked", async () => {
    renderEditor("Today is ", menu());
    await focusEnd();
    await userEvent.keyboard("/");
    expect(await screen.findByRole("listbox", { name: "Insert" })).toBeTruthy();
    await userEvent.click(screen.getByRole("option", { name: "current_date" }));
    await waitFor(() => expect(shown()).toBe("Today is {{current_date}}"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("filters by what's typed after /, and Enter picks", async () => {
    renderEditor("", menu());
    await focusEnd();
    await userEvent.keyboard("/date");
    await waitFor(() =>
      expect(
        screen.getAllByRole("option").map((each) => each.textContent)
      ).toEqual(["current_date"])
    );
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(shown()).toBe("{{current_date}}"));
  });

  it("selects a new variable's name so typing names it", async () => {
    renderEditor(
      "Explain ",
      menu((item) => (item.kind === "new-variable" ? "{{variable}}" : null))
    );
    await focusEnd();
    await userEvent.keyboard("/");
    await userEvent.click(
      await screen.findByRole("option", { name: "New variable" })
    );
    await userEvent.keyboard("topic");
    await waitFor(() => expect(shown()).toBe("Explain {{topic}}"));
  });

  it("inserts a fetched snippet once it arrives, across lines", async () => {
    renderEditor(
      "Start\n",
      menu((item) =>
        item.kind === "prompt"
          ? Promise.resolve("Explain {{topic}}.\n\nKeep it short.")
          : null
      )
    );
    await focusEnd();
    await userEvent.keyboard("/expl");
    await userEvent.click(await screen.findByRole("option", { name: EXPLAIN }));
    await waitFor(() =>
      expect(shown()).toBe("Start\nExplain {{topic}}.\n\nKeep it short.")
    );
  });

  it("keeps blank lines exactly as they were while typing", async () => {
    const { onValue } = renderEditor("\nfirst\n\n\nsecond\n", menu());
    await focusEnd();
    await userEvent.keyboard("third");
    await waitFor(() =>
      expect(onValue).toHaveBeenLastCalledWith("\nfirst\n\n\nsecond\nthird")
    );
  });

  it("shows a value set from outside without reporting it back", async () => {
    const onValue = vi.fn();
    const providers = createTestProviders();
    const view = render(
      providers.wrap(
        <>
          <span id="label">Notes</span>
          <SnippetEditor
            aria-labelledby="label"
            onValueChange={onValue}
            value="before"
          />
        </>
      )
    );
    const box = await screen.findByRole("textbox", { name: "Notes" });
    view.rerender(
      providers.wrap(
        <>
          <span id="label">Notes</span>
          <SnippetEditor
            aria-labelledby="label"
            onValueChange={onValue}
            value={"after\n\nall"}
          />
        </>
      )
    );
    await waitFor(() =>
      expect(
        [...box.querySelectorAll("p")].map((each) => each.textContent)
      ).toEqual(["after", "", "all"])
    );
    expect(onValue).not.toHaveBeenCalled();
  });
});
