import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { ComposerLoader, type ComposerLoaderProps } from "./composer-loader";
import { ComposerShell } from "./composer-shell";

const i18n = setupI18n({ locale: "en", messages: { en: {} } });

type Loaded = Awaited<ReturnType<NonNullable<ComposerLoaderProps["load"]>>>;

/** A load port the test resolves when it chooses. */
const deferredLoad = () => {
  let resolve: (value: Loaded) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<Loaded>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return {
    arrive: async () => resolve(await import("./composer")),
    fail: () => reject(new Error("chunk failed")),
    load: () => promise,
  };
};

const renderLoader = (load: ComposerLoaderProps["load"]) =>
  render(
    <I18nProvider i18n={i18n}>
      <ComposerLoader load={load} onSubmit={vi.fn()} />
    </I18nProvider>
  );

afterEach(() => {
  cleanup();
});

describe("ComposerShell", () => {
  it("renders the frame with a plain textarea and no editor", () => {
    const { container } = render(
      <I18nProvider i18n={i18n}>
        <ComposerShell onSubmit={vi.fn()} />
      </I18nProvider>
    );
    const input = screen.getByRole("textbox", { name: "Message" });
    expect(input.tagName).toBe("TEXTAREA");
    expect(input.getAttribute("placeholder")).toBe("Ask anything");
    expect(container.querySelector("[contenteditable]")).toBeNull();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });
});

describe("ComposerLoader", () => {
  it("hands typed text, caret and focus from the shell to the editor", async () => {
    const chunk = deferredLoad();
    const { container } = renderLoader(chunk.load);

    const shell = screen.getByRole("textbox", { name: "Message" });
    await userEvent.click(shell);
    await userEvent.keyboard("typed early");

    await chunk.arrive();
    const editor = await waitFor(() => {
      const found = container.querySelector<HTMLElement>("[contenteditable]");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(editor.textContent).toBe("typed early");
    await waitFor(() => expect(document.activeElement).toBe(editor));

    // Typing carries on where the caret was.
    await userEvent.keyboard("!");
    expect(editor.textContent).toBe("typed early!");
  });

  it("keeps the shell and says so when the editor fails to load", async () => {
    const chunk = deferredLoad();
    renderLoader(chunk.load);
    chunk.fail();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The editor didn't load"
    );
    expect(screen.getByRole("textbox", { name: "Message" }).tagName).toBe(
      "TEXTAREA"
    );
  });
});
