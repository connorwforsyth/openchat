import { setupI18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen } from "@testing-library/react";
import {
  type AnnotationsData,
  annotationsParts,
} from "@workspace/ai/messages/annotations";
import type { Message } from "@workspace/contract/schemas/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import { treeMessages } from "../fixtures";
import type { AnswerPhase } from "../model/run-activity";
import { RunActivityProvider } from "./approval-state";
import { MessageRow } from "./message-row";

// Reasoning renders synchronously here; see conversation-view.test.
vi.mock("./lazy", () => import("../testing/sync-lazy"));

const i18n = setupI18n({ locale: "en", messages: { en: {} } });

const THOUGHT_FOR = /Thought for/;
const WORKING = /Still working/;
const ANNOTATIONS_TAG = /artifact-annotations/;

const base = treeMessages.find((message) => message.role === "assistant");
if (!base) {
  throw new Error("fixture answer");
}

const reasoning = {
  text: "Slow could mean latency or relevance.",
  type: "reasoning",
} as const;
const answer = { text: "Both can work at 2M rows.", type: "text" } as const;

const row = ({
  parts,
  phase,
  status = "partial",
  streaming,
}: {
  readonly parts: Message["parts"];
  readonly phase?: AnswerPhase;
  readonly status?: Message["status"];
  readonly streaming: boolean;
}) => (
  <I18nProvider i18n={i18n}>
    <RunActivityProvider
      value={{
        answers: new Map(phase ? [[base.id, phase]] : []),
        decisions: new Map(),
      }}
    >
      <MessageRow
        approvals={undefined}
        feedback={undefined}
        message={{ ...base, parts, status }}
        results={[]}
        siblings={undefined}
        streaming={streaming}
      />
    </RunActivityProvider>
  </I18nProvider>
);

afterEach(() => {
  cleanup();
});

describe("thinking", () => {
  it("stays open while it streams and collapses once the answer moves on", () => {
    const view = render(row({ parts: [reasoning], streaming: true }));
    expect(screen.getByText("Thinking…")).toBeTruthy();
    expect(screen.getByText(reasoning.text)).toBeTruthy();

    view.rerender(row({ parts: [reasoning, answer], streaming: true }));
    expect(screen.queryByText("Thinking…")).toBeNull();
    expect(screen.getByText(THOUGHT_FOR)).toBeTruthy();
    expect(screen.queryByText(reasoning.text)).toBeNull();
    expect(screen.getByText(answer.text)).toBeTruthy();
  });
});

describe("the answer's status line", () => {
  it("says Thinking… from the send, as the thinking row it becomes, then gives way to the answer", async () => {
    const view = render(row({ parts: [], streaming: true }));
    expect(screen.getByRole("status").textContent).toBe("Thinking…");

    // The model's thinking arrives: the same title, in the same place.
    view.rerender(
      row({
        parts: [{ text: "Considering.", type: "reasoning" }],
        streaming: true,
      })
    );
    expect(await screen.findByText("Thinking…")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();

    view.rerender(row({ parts: [answer], streaming: true }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a page opened mid-answer where its run stands", () => {
    const view = render(
      row({ parts: [answer], phase: "running", streaming: false })
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(WORKING)).toBeNull();

    view.rerender(row({ parts: [], phase: "running", streaming: false }));
    expect(screen.getByRole("status").textContent).toBe("Thinking…");

    view.rerender(row({ parts: [], phase: "queued", streaming: false }));
    expect(screen.getByRole("status").textContent).toBe(
      "Waiting for the answer before it…"
    );

    view.rerender(row({ parts: [answer], phase: "waiting", streaming: false }));
    expect(screen.getByRole("status").textContent).toBe(
      "Waiting for your approval."
    );

    view.rerender(row({ parts: [answer], streaming: false }));
    expect(screen.getByRole("status").textContent).toBe(
      "This answer stopped early."
    );

    view.rerender(
      row({ parts: [answer], status: "complete", streaming: false })
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("notes on an artifact", () => {
  const user = treeMessages.find((message) => message.role === "user");
  if (!user) {
    throw new Error("fixture question");
  }

  it("shows the notes people wrote, not the block the model read", () => {
    const data: AnnotationsData = {
      artifactId: "0192a000-0000-7000-8000-000000000021" as never,
      kind: "site",
      notes: [
        {
          mark: { shape: "point", x: 0.4, y: 0.3 },
          note: "Make the heading bigger.",
          target: { selector: "h1", text: "Hello", type: "element" },
          version: 2,
          versionId: "0192a000-0000-7000-8000-000000000022" as never,
        },
      ],
      title: "Landing page",
    };
    render(
      <I18nProvider i18n={i18n}>
        <MessageRow
          approvals={undefined}
          feedback={undefined}
          message={{ ...user, parts: [...annotationsParts(data)] }}
          results={[]}
          siblings={undefined}
          streaming={false}
        />
      </I18nProvider>
    );
    expect(screen.getByText("1 note on Landing page")).toBeTruthy();
    expect(screen.getByText("Make the heading bigger.")).toBeTruthy();
    expect(screen.getByText("“Hello”")).toBeTruthy();
    expect(screen.queryByText(ANNOTATIONS_TAG)).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
