import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { Markdown } from "./markdown";

// As `renderWithI18n` (testing/render), but as a wrapper, so `rerender` keeps the provider.
const i18n = setupI18n({ locale: "en", messages: { en: {} } });
const wrapper = ({ children }: { readonly children: ReactNode }) => (
  <I18nProvider i18n={i18n}>{children}</I18nProvider>
);

// The real path: Streamdown's code block, the code plugin, and Shiki (WASM)
// loading from its own chunk. Generous waits for a loaded CI runner.
const SHIKI_TIMEOUT = 20_000;

const body = () =>
  document.querySelector<HTMLElement>('[data-streamdown="code-block-body"]');

/** Resolves once the block's body carries the plugin's colours. */
const coloured = async () => {
  const element = await vi.waitFor(
    () => {
      const found = body();
      if (!found?.querySelector("[data-code-ready]")) {
        throw new Error("code block not coloured yet");
      }
      return found;
    },
    { interval: 50, timeout: SHIKI_TIMEOUT }
  );
  return element;
};

const tokenColours = (element: HTMLElement) =>
  [...element.querySelectorAll<HTMLElement>("code span span")].map((span) =>
    span.style.getPropertyValue("--sdm-c")
  );

// Shiki's chunk and WASM load under hookTimeout, not inside a test.
beforeAll(async () => {
  const { loadTokenizer } = await import("./code-highlighter");
  await loadTokenizer("ts");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("code blocks in markdown", () => {
  it("ends a streamed fence highlighted with theme tokens", async () => {
    const [first, ...rest] = [
      "Here:\n\n```ts\nconst",
      "Here:\n\n```ts\nconst answer = 4",
      "Here:\n\n```ts\nconst answer = 42;\n// done",
      "Here:\n\n```ts\nconst answer = 42;\n// done\n```\n",
    ];
    const view = render(<Markdown streaming>{first}</Markdown>, {
      wrapper,
    });
    for (const chunk of rest) {
      view.rerender(<Markdown streaming>{chunk}</Markdown>);
    }
    view.rerender(<Markdown>{`${rest.at(-1)}\nThat's it.`}</Markdown>);

    await vi.waitFor(
      async () => {
        const element = await coloured();
        expect(element.textContent).toContain("// done");
        const colours = tokenColours(element);
        expect(colours.some((colour) => colour.includes("var(--chart"))).toBe(
          true
        );
      },
      { timeout: SHIKI_TIMEOUT }
    );
  });

  it("renders an unknown language as plain text", async () => {
    render(<Markdown>{"```zzz-made-up\nhello <world>\n```"}</Markdown>, {
      wrapper,
    });
    const element = await coloured();
    expect(element.textContent).toContain("hello <world>");
  });

  it("keeps a 2,000-line block responsive", {
    timeout: 2 * SHIKI_TIMEOUT,
  }, async () => {
    const lines = Array.from(
      { length: 2000 },
      (_, index) => `const value${index} = compute(${index}, "s${index}");`
    );
    const fence = (code: string) => `\`\`\`ts\n${code}`;
    const view = render(
      <Markdown streaming>{fence(lines.join("\n"))}</Markdown>,
      { wrapper }
    );
    const element = await coloured();
    await vi.waitFor(
      () => {
        expect(element.querySelectorAll("code > span")).toHaveLength(2000);
      },
      { timeout: SHIKI_TIMEOUT }
    );

    // A streamed chunk on a long block re-tokenises one line, so it shows
    // coloured in the same render. Re-tokenising the whole block would go
    // through the sliced, asynchronous path and leave the old 2,000 lines up.
    // There's no wall-clock budget. Rendering 2,000 lines takes about 160 ms
    // on an idle laptop, 1.3 s at 4x CPU throttling and up to 3.6 s on a busy
    // CI runner, so a fixed budget fails on load, not on a regression.
    act(() => {
      view.rerender(
        <Markdown streaming>
          {fence(`${lines.join("\n")}\nconst more = 1;`)}
        </Markdown>
      );
    });
    expect(body()?.querySelectorAll("code > span")).toHaveLength(2001);
    const last = body()?.querySelector<HTMLElement>("code > span:last-child");
    expect(last?.textContent).toBe("const more = 1;");
    const colours = last ? tokenColours(last) : [];
    expect(colours.some((colour) => colour.includes("var(--chart"))).toBe(true);
  });

  it("still copies and downloads the code", async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    render(<Markdown>{"```ts\nconst copied = true;\n```"}</Markdown>, {
      wrapper,
    });
    await coloured();

    await userEvent.click(page.getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledWith("const copied = true;\n");

    await userEvent.click(page.getByRole("button", { name: "Download file" }));
    expect(createObjectURL).toHaveBeenCalled();
  });
});
