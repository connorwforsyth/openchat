import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Markdown } from "./markdown";

// The end of a stream usually arrives with the text unchanged and only
// `streaming` flipping; that must still reach Streamdown, or the code, table
// and diagram controls stay disabled until the message remounts (144).

afterEach(cleanup);

const i18n = setupI18n({ locale: "en", messages: { en: {} } });

const FENCE = "```ts\nconst answer = 42;\n```";
const COPY = /copy code/i;

function Reply({ streaming }: { readonly streaming: boolean }) {
  return (
    <I18nProvider i18n={i18n}>
      <Markdown streaming={streaming}>{FENCE}</Markdown>
    </I18nProvider>
  );
}

describe("Markdown at the end of a stream", () => {
  it("enables the code controls even when the text didn't change", async () => {
    const { rerender } = render(<Reply streaming />);
    const whileStreaming = await screen.findByRole("button", { name: COPY });
    expect(whileStreaming).toHaveProperty("disabled", true);

    rerender(<Reply streaming={false} />);

    const settled = await screen.findByRole("button", { name: COPY });
    expect(settled).toHaveProperty("disabled", false);
  });
});
