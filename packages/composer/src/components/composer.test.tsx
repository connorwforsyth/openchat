import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  agentItem,
  fixtureId,
  modelOptions,
  teamPlatform,
  userAda,
  userBo,
} from "@workspace/contract/fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import {
  type ComposerValue,
  composerValueSchema,
  type PromptOption,
} from "../schemas";
import { Composer, type ComposerProps, READY_MARK } from "./composer";

// No catalog: macros keep their source messages outside production, so the
// English text renders as written.
const i18n = setupI18n({ locale: "en", messages: { en: {} } });

const summarise: PromptOption = {
  definition: {
    command: "summarise",
    kind: "prompt",
    template: "Summarise the thread above in three bullets.",
    variables: [],
  },
  description: "",
  id: fixtureId("libraryItem", 30),
  name: "Summarise",
};

const explain: PromptOption = {
  definition: {
    command: "explain",
    kind: "prompt",
    template: "Explain {{topic}} to {{audience}}.",
    variables: [
      { description: "What to explain", name: "topic" },
      { default: "a new hire", name: "audience" },
    ],
  },
  description: "",
  id: fixtureId("libraryItem", 31),
  name: "Explain",
};

// Options' accessible names include their hints (`/summarise`, emails).
const SUMMARISE = /Summarise/;
const EXPLAIN = /Explain/;
const REVIEWER = /Reviewer/;
const PLATFORM = /Platform/;
const BO = /Bo/;

const renderComposer = (props: Partial<ComposerProps> = {}) => {
  const onSubmit = vi.fn<(value: ComposerValue) => void>();
  const result = render(
    <I18nProvider i18n={i18n}>
      <Composer
        agents={[agentItem]}
        onSubmit={onSubmit}
        people={[userAda, userBo]}
        prompts={[summarise, explain]}
        {...props}
      />
    </I18nProvider>
  );
  const editor = screen.getByRole("textbox", { name: "Message" });
  return { ...result, editor, onSubmit };
};

const lastValue = (onSubmit: ReturnType<typeof renderComposer>["onSubmit"]) => {
  const value = onSubmit.mock.lastCall?.[0];
  if (value === undefined) {
    throw new Error("onSubmit was not called");
  }
  return composerValueSchema.parse(value);
};

const paste = (target: HTMLElement, fill: (data: DataTransfer) => void) => {
  const data = new DataTransfer();
  fill(data);
  target.dispatchEvent(
    new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    })
  );
};

afterEach(() => {
  cleanup();
});

describe("Composer", () => {
  it("sends on Enter, adds a line on Shift+Enter, and clears", async () => {
    const { editor, onSubmit } = renderComposer();
    await userEvent.click(editor);
    await userEvent.keyboard("Hello{Shift>}{Enter}{/Shift}there");
    expect(onSubmit).not.toHaveBeenCalled();

    await userEvent.keyboard("{Enter}");
    expect(lastValue(onSubmit)).toEqual({
      attachments: [],
      mentions: [],
      templateId: null,
      text: "Hello\nthere",
    });
    expect(editor.textContent).toBe("");
    expect(document.activeElement).toBe(editor);
  });

  it("marks when the editor is ready", async () => {
    performance.clearMarks(READY_MARK);
    renderComposer();
    await waitFor(() =>
      expect(performance.getEntriesByName(READY_MARK)).toHaveLength(1)
    );
  });

  it("doesn't send blank text", async () => {
    const { editor, onSubmit } = renderComposer();
    await userEvent.click(editor);
    await userEvent.keyboard("   {Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty(
      "disabled",
      true
    );
  });

  it("pastes plain text only", async () => {
    const { editor, onSubmit } = renderComposer();
    await userEvent.click(editor);
    paste(editor, (data) => {
      data.setData("text/html", "<h1>Title</h1><p><b>bold</b></p>");
      data.setData("text/plain", "Title\nbold");
    });
    expect(editor.querySelector("h1, b, strong")).toBeNull();
    await userEvent.keyboard("{Enter}");
    expect(lastValue(onSubmit).text).toBe("Title\nbold");
  });

  it("shows stop while streaming, and Enter doesn't send", async () => {
    const onStop = vi.fn();
    const { editor, onSubmit } = renderComposer({
      onStop,
      status: "streaming",
    });
    await userEvent.click(editor);
    await userEvent.keyboard("next question{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(editor.textContent).toBe("next question");
  });

  it("inserts a template from the / menu", async () => {
    const { editor, onSubmit } = renderComposer();
    await userEvent.click(editor);
    await userEvent.keyboard("/sum");

    const listbox = await screen.findByRole("listbox", { name: "Prompts" });
    expect(editor.getAttribute("aria-controls")).toBe(listbox.id);
    const option = screen.getByRole("option", { name: SUMMARISE });
    expect(option.getAttribute("aria-selected")).toBe("true");
    expect(editor.getAttribute("aria-activedescendant")).toBe(option.id);

    await userEvent.keyboard("{Enter}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(editor.textContent).toBe(
      "Summarise the thread above in three bullets."
    );

    await userEvent.keyboard("{Enter}");
    expect(lastValue(onSubmit).templateId).toBe(summarise.id);
  });

  it("closes the menu on Escape and keeps the typed text", async () => {
    const { editor } = renderComposer();
    await userEvent.click(editor);
    await userEvent.keyboard("/ex");
    expect(await screen.findByRole("listbox")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(editor.textContent).toBe("/ex");
  });

  it("asks for a template's variables, then fills them in", async () => {
    const { editor, onSubmit } = renderComposer();
    await userEvent.click(editor);
    await userEvent.keyboard("Please /expl");
    await userEvent.click(await screen.findByRole("option", { name: EXPLAIN }));

    const topic = screen.getByRole("textbox", { name: "topic" });
    await waitFor(() => expect(document.activeElement).toBe(topic));
    expect(screen.getByRole("textbox", { name: "audience" })).toHaveProperty(
      "value",
      "a new hire"
    );
    expect(screen.queryByRole("listbox")).toBeNull();

    // A blank variable without a default blocks the insert.
    await userEvent.click(
      screen.getByRole("button", { name: "Insert prompt" })
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Fill in every field"
    );
    expect(topic.getAttribute("aria-invalid")).toBe("true");

    await userEvent.fill(topic, "branching");
    await userEvent.keyboard("{Enter}");
    expect(screen.queryByRole("textbox", { name: "topic" })).toBeNull();
    expect(editor.textContent).toBe("Please Explain branching to a new hire.");
    expect(document.activeElement).toBe(editor);

    await userEvent.keyboard("{Enter}");
    expect(lastValue(onSubmit)).toMatchObject({
      templateId: explain.id,
      text: "Please Explain branching to a new hire.",
    });
  });

  it("inserts @ mentions and submits them as tokens", async () => {
    const { editor, onSubmit } = renderComposer();
    await userEvent.click(editor);
    await userEvent.keyboard("ask @re");
    expect(
      await screen.findByRole("listbox", { name: "Mention" })
    ).toBeTruthy();
    await userEvent.keyboard("{Enter}about @b");
    await screen.findByRole("option", { name: BO });
    await userEvent.keyboard("{ArrowDown}{ArrowUp}{Tab}");
    expect(editor.textContent).toBe("ask @Reviewer about @Bo ");

    await userEvent.keyboard("{Enter}");
    expect(lastValue(onSubmit).mentions).toEqual([
      { end: 13, id: agentItem.id, kind: "agent", label: "Reviewer", start: 4 },
      { end: 23, id: userBo.id, kind: "user", label: "Bo", start: 20 },
    ]);
  });

  it("removes a whole mention with one Backspace", async () => {
    const { editor } = renderComposer();
    await userEvent.click(editor);
    await userEvent.keyboard("hi @ad");
    await screen.findByRole("listbox");
    await userEvent.keyboard("{Enter}{Backspace}{Backspace}");
    expect(editor.textContent?.trim()).toBe("hi");
  });

  it("adds files from the picker, lists them and removes one", async () => {
    const onAttachmentsChange = vi.fn();
    const { container, editor, onSubmit } = renderComposer({
      onAttachmentsChange,
    });
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) {
      throw new Error("no file input");
    }
    await userEvent.upload(input, [
      new File(["hello"], "notes.txt", { type: "text/plain" }),
      new File(["{}"], "data.json", { type: "application/json" }),
    ]);

    const list = await screen.findByRole("list", { name: "Attachments" });
    expect(list.textContent).toContain("notes.txt");
    expect(list.textContent).toContain("data.json");
    expect(onAttachmentsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ file: expect.any(File) }),
      expect.objectContaining({ file: expect.any(File) }),
    ]);

    await userEvent.click(
      screen.getByRole("button", { name: "Remove notes.txt" })
    );
    expect(screen.queryByText("notes.txt")).toBeNull();
    expect(document.activeElement).toBe(editor);

    // Files alone are enough to send.
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    const value = lastValue(onSubmit);
    expect(value.text).toBe("");
    expect(value.attachments.map((a) => a.file.name)).toEqual(["data.json"]);
    expect(screen.queryByRole("list", { name: "Attachments" })).toBeNull();
  });

  it("attaches pasted files and rejects ones over the limits", async () => {
    const onAttachmentsRejected = vi.fn();
    const { editor } = renderComposer({
      attachmentLimits: { accept: ["image/*"], maxFileSize: 4, maxFiles: 1 },
      onAttachmentsRejected,
    });
    paste(editor, (data) => {
      data.items.add(new File(["png"], "shot.png", { type: "image/png" }));
      data.items.add(new File(["pdf"], "doc.pdf", { type: "application/pdf" }));
      data.items.add(new File(["large"], "big.png", { type: "image/png" }));
    });

    const list = await screen.findByRole("list", { name: "Attachments" });
    expect(list.textContent).toContain("shot.png");
    expect(onAttachmentsRejected).toHaveBeenCalledWith([
      { code: "type", fileName: "doc.pdf" },
      { code: "size", fileName: "big.png", maxFileSize: 4 },
    ]);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("doc.pdf isn't a supported file type.");
    expect(alert.textContent).toContain("big.png is larger than");
    expect(screen.getByRole("button", { name: "Attach files" })).toHaveProperty(
      "disabled",
      true
    );
    expect(editor.textContent).toBe("");
  });

  it("picks a target and a context", async () => {
    const onTargetChange = vi.fn();
    const onContextChange = vi.fn();
    renderComposer({
      context: { type: "personal" },
      contexts: [
        { context: { type: "personal" } },
        { context: { id: teamPlatform.id, type: "team" }, name: "Platform" },
      ],
      models: modelOptions,
      onContextChange,
      onTargetChange,
      target: { model: "auto", type: "model" },
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Model or agent: Auto" })
    );
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: REVIEWER })
    );
    expect(onTargetChange).toHaveBeenCalledWith({
      id: agentItem.id,
      type: "agent",
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Chat context: Personal" })
    );
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: PLATFORM })
    );
    expect(onContextChange).toHaveBeenCalledWith({
      id: teamPlatform.id,
      type: "team",
    });
  });

  it("shows a locked context without a menu", () => {
    renderComposer({ context: { type: "personal" }, contextLocked: true });
    const chip = screen.getByRole("button", {
      name: "Chat context: Personal, locked",
    });
    expect(chip.getAttribute("aria-disabled")).toBe("true");
    expect(chip.getAttribute("aria-haspopup")).toBeNull();
  });

  it("disables everything when disabled", () => {
    const { editor } = renderComposer({ disabled: true });
    expect(editor.getAttribute("contenteditable")).toBe("false");
    expect(screen.getByRole("button", { name: "Attach files" })).toHaveProperty(
      "disabled",
      true
    );
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty(
      "disabled",
      true
    );
  });
});
