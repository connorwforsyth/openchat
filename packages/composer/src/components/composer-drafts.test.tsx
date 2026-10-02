import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { agentItem, fixtureId } from "@workspace/contract/fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { textToDoc } from "../doc";
import { DRAFT_SAVE_DELAY_MS } from "../drafts";
import {
  type Draft,
  draftNodeSchema,
  NEW_CHAT_DRAFT_KEY,
} from "../ports/draft-store";
import { createMemoryDraftStore } from "../ports/draft-store.memory";
import type { PromptHistoryEntry } from "../prompt-history";
import type { ComposerValue, SkillOption } from "../schemas";
import { Composer, type ComposerProps } from "./composer";

// Ticket 147: drafts kept per chat, and ArrowUp recall.

/** Skills in the + menu, named with their descriptions. */
const HAIKU_ITEM = /^Haiku/;

const i18n = setupI18n({ locale: "en", messages: { en: {} } });

const haiku: SkillOption = {
  description: "Answers in haiku",
  id: fixtureId("libraryItem", 40),
  name: "Haiku",
};

const draftOf = (text: string, skills: Draft["skills"] = []): Draft => ({
  doc: draftNodeSchema.parse(textToDoc(text)),
  skills,
  templateId: null,
  version: 1,
});

const view = (props: Partial<ComposerProps>) => (
  <I18nProvider i18n={i18n}>
    <Composer agents={[agentItem]} onSubmit={vi.fn()} {...props} />
  </I18nProvider>
);

const renderComposer = (props: Partial<ComposerProps> = {}) => {
  const onSubmit = vi.fn<(value: ComposerValue) => void>();
  const result = render(view({ onSubmit, ...props }));
  const editor = screen.getByRole("textbox", { name: "Message" });
  return {
    ...result,
    editor,
    onSubmit,
    rerenderWith: (next: Partial<ComposerProps>) =>
      result.rerender(view({ onSubmit, ...props, ...next })),
  };
};

const pause = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, DRAFT_SAVE_DELAY_MS + 50);
  });

afterEach(() => {
  cleanup();
});

describe("drafts (147)", () => {
  it("restores a chat's draft, mentions and skills included", async () => {
    const store = createMemoryDraftStore({
      c1: {
        ...draftOf("", [haiku]),
        doc: draftNodeSchema.parse({
          content: [
            {
              content: [
                { text: "ask ", type: "text" },
                {
                  attrs: { id: agentItem.id, kind: "agent", label: "Reviewer" },
                  type: "mention",
                },
              ],
              type: "paragraph",
            },
          ],
          type: "doc",
        }),
      },
    });
    const { editor, onSubmit } = renderComposer({
      draft: { key: "c1", store },
    });
    await waitFor(() => expect(editor.textContent).toBe("ask @Reviewer"));
    expect(screen.getByText("Haiku")).toBeTruthy();

    await userEvent.click(editor);
    await userEvent.keyboard("{Enter}");
    const value = onSubmit.mock.lastCall?.[0];
    expect(value?.mentions).toEqual([
      { end: 13, id: agentItem.id, kind: "agent", label: "Reviewer", start: 4 },
    ]);
    expect(value?.skills).toEqual([{ id: haiku.id, name: "Haiku" }]);
  });

  it("saves as typing pauses and clears on send", async () => {
    const store = createMemoryDraftStore();
    const { editor } = renderComposer({ draft: { key: "c1", store } });
    await userEvent.click(editor);
    await userEvent.keyboard("half a thought");
    expect(store.writes).toEqual([]);
    await pause();
    expect(store.load("c1")).toEqual({
      ok: true,
      value: draftOf("half a thought"),
    });

    await userEvent.keyboard("{Enter}");
    expect(store.load("c1")).toEqual({ ok: true, value: null });
    await pause();
    expect(store.load("c1")).toEqual({ ok: true, value: null });
  });

  it("swaps drafts when switching chats, saving the one left at once", async () => {
    const store = createMemoryDraftStore({ c2: draftOf("for chat two") });
    const { editor, rerenderWith } = renderComposer({
      draft: { key: "c1", store },
    });
    await userEvent.click(editor);
    await userEvent.keyboard("for chat one");

    rerenderWith({ draft: { key: "c2", store } });
    await waitFor(() => expect(editor.textContent).toBe("for chat two"));
    expect(store.load("c1")).toEqual({
      ok: true,
      value: draftOf("for chat one"),
    });

    rerenderWith({ draft: { key: "c3", store } });
    await waitFor(() => expect(editor.textContent).toBe(""));
    rerenderWith({ draft: { key: "c1", store } });
    await waitFor(() => expect(editor.textContent).toBe("for chat one"));
  });

  it("writes what's pending when the page goes away", async () => {
    const store = createMemoryDraftStore();
    const { editor } = renderComposer({ draft: { key: "c1", store } });
    await userEvent.click(editor);
    await userEvent.keyboard("closing the tab");
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    expect(store.load("c1")).toEqual({
      ok: true,
      value: draftOf("closing the tab"),
    });
  });

  it("gives what's typed after a new chat's first send to the chat it made", async () => {
    const store = createMemoryDraftStore();
    const { editor, rerenderWith } = renderComposer({
      draft: { key: NEW_CHAT_DRAFT_KEY, store },
    });
    await userEvent.click(editor);
    await userEvent.keyboard("first{Enter}");
    await userEvent.keyboard("and then");
    rerenderWith({ draft: { key: "made", store } });
    await pause();
    expect(editor.textContent).toBe("and then");
    expect(store.load("made")).toEqual({
      ok: true,
      value: draftOf("and then"),
    });
    expect(store.load(NEW_CHAT_DRAFT_KEY)).toEqual({ ok: true, value: null });
  });

  it("lets the host's fill replace a restored draft (138)", async () => {
    const store = createMemoryDraftStore({ c1: draftOf("saved") });
    const { editor, rerenderWith } = renderComposer({
      draft: { key: "c1", store },
    });
    await waitFor(() => expect(editor.textContent).toBe("saved"));
    rerenderWith({
      draft: { key: "c1", store },
      fill: { id: 1, text: "Edit the image a.png: " },
    });
    await waitFor(() =>
      expect(editor.textContent).toBe("Edit the image a.png: ")
    );
    await pause();
    expect(store.load("c1")).toEqual({
      ok: true,
      value: draftOf("Edit the image a.png: "),
    });
  });

  it("keeps a picked skill as the draft", async () => {
    const store = createMemoryDraftStore();
    renderComposer({ draft: { key: "c1", store }, skills: [haiku] });
    await userEvent.click(
      screen.getByRole("button", { name: "Add to message" })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Skills" })
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: HAIKU_ITEM })
    );
    await pause();
    const saved = store.load("c1");
    expect(saved.ok && saved.value?.skills).toEqual([
      { id: haiku.id, name: "Haiku" },
    ]);
  });
});

describe("prompt recall (147)", () => {
  const history: readonly PromptHistoryEntry[] = [
    { id: "m1", prompt: "first question" },
    { id: "m3", prompt: "second\nquestion" },
  ];

  it("walks back with ArrowUp and forward to empty with ArrowDown", async () => {
    const { editor, onSubmit } = renderComposer({ history });
    await userEvent.click(editor);
    await userEvent.keyboard("{ArrowUp}");
    expect(editor.textContent).toBe("secondquestion");
    await userEvent.keyboard("{ArrowUp}");
    expect(editor.textContent).toBe("first question");
    // The oldest: ArrowUp just moves the caret.
    await userEvent.keyboard("{ArrowUp}");
    expect(editor.textContent).toBe("first question");
    await userEvent.keyboard("{ArrowDown}");
    expect(editor.textContent).toBe("secondquestion");
    await userEvent.keyboard("{ArrowDown}");
    expect(editor.textContent).toBe("");

    await userEvent.keyboard("{ArrowUp}{ArrowUp}{Enter}");
    expect(onSubmit.mock.lastCall?.[0].text).toBe("first question");
  });

  it("leaves typed text alone, and stops once a recall is edited", async () => {
    const { editor } = renderComposer({ history });
    await userEvent.click(editor);
    // Typed text: the caret moves (to the start), and again stays put.
    await userEvent.keyboard("mine{ArrowUp}{ArrowUp}");
    expect(editor.textContent).toBe("mine");
    // Erased (a Backspace too many on an empty composer does nothing).
    await userEvent.keyboard("{End}");
    await userEvent.keyboard("{Backspace}".repeat(6));
    expect(editor.textContent).toBe("");
    await userEvent.keyboard("{ArrowUp}");
    expect(editor.textContent).toBe("secondquestion");
    await userEvent.keyboard("!{ArrowUp}");
    expect(editor.textContent).toBe("secondquestion!");
  });

  it("doesn't fire while the mention menu is open", async () => {
    const { editor } = renderComposer({ history });
    await userEvent.click(editor);
    await userEvent.keyboard("@");
    const listbox = await screen.findByRole("listbox");
    await userEvent.keyboard("{ArrowUp}");
    expect(editor.textContent).toBe("@");
    expect(within(listbox).getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("does nothing without a history", async () => {
    const { editor } = renderComposer();
    await userEvent.click(editor);
    await userEvent.keyboard("{ArrowUp}");
    expect(editor.textContent).toBe("");
  });
});
