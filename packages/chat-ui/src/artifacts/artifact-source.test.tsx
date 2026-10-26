import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { cleanup, render } from "@testing-library/react";
import { fixtureId } from "@workspace/contract/fixtures";
import { type ReactNode, StrictMode, Suspense, use } from "react";
import { afterEach, expect, it } from "vitest";

import { artifactPlan } from "../fixtures";
import { ArtifactView } from "./artifact-view";

// Its own file: the highlighter is a page-wide singleton, and this must be
// the first code view on the page, before the highlighter has loaded.

afterEach(cleanup);

const source =
  "export const answer = 42;\nexport const question = 'unknown';\n";

const codeText = () =>
  document.querySelector("diffs-container")?.shadowRoot?.querySelector("pre")
    ?.textContent ?? "";

function Suspend({ until }: { readonly until: Promise<void> }) {
  use(until);
  return null;
}

const asIs = (content: ReactNode) => content;
const ignore = () => undefined;

const i18n = setupI18n({ locale: "en", messages: { en: {} } });

const view = (suspend: Promise<void> | null) => (
  <StrictMode>
    <I18nProvider i18n={i18n}>
      <Suspense fallback={null}>
        <div style={{ display: "flex", flexDirection: "column", height: 600 }}>
          <ArtifactView
            artifact={{ ...artifactPlan, kind: "code", title: "answer.ts" }}
            header={asIs}
            onSelect={ignore}
            versions={[
              {
                artifactId: artifactPlan.id,
                content: source,
                conversationId: artifactPlan.conversationId,
                createdAt: artifactPlan.createdAt,
                id: fixtureId("artifactVersion", 99),
                language: "typescript",
                messageId: artifactPlan.messageId,
                number: 1,
              },
            ]}
          />
        </div>
        {suspend ? <Suspend until={suspend} /> : null}
      </Suspense>
    </I18nProvider>
  </StrictMode>
);

// A sibling suspending hides the view and detaches its refs; showing it
// again reattaches them to the same element, as a route or a lazy chunk
// loading beside it does in the app.
it("draws the source when it's hidden and shown before highlighting", async () => {
  const { rerender } = render(view(null));
  let resume: () => void = ignore;
  const suspend = new Promise<void>((resolve) => {
    resume = resolve;
  });
  rerender(view(suspend));
  resume();
  await expect.poll(codeText, { timeout: 20_000 }).toContain("answer = 42");
});
