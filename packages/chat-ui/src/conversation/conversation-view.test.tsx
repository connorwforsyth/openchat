import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { fixtureId } from "@workspace/contract/fixtures";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { initialLeafId, pendingEdit, treeMessages } from "../fixtures";
import { localBranchPath } from "../model/branch";
import { renderWithI18n } from "../testing/render";
import { conversationSettled } from "../testing/settle";
import type { ConversationActions } from "./actions";
import { ConversationView } from "./conversation-view";
import type { MessageFeedback } from "./feedback";

// Diffs and reasoning render synchronously here (ticket 037): the real lazy
// DiffView waits on a chunk and on Shiki, which timed tests out on loaded CI
// runners. `conversation-view.lazy.test.tsx` covers the real lazy path.
vi.mock("./lazy", () => import("../testing/sync-lazy"));

const WHY = /Why\?/;
const WHAT_WENT_WRONG = /What went wrong/;
const SHARE = /Share this conversation/;
const DECISION_SENT = /Decision sent/;

const path = localBranchPath(treeMessages, initialLeafId);
if (!path) {
  throw new Error("fixture branch path");
}

const renderView = async (
  actions: ConversationActions,
  feedback?: Record<string, MessageFeedback>
) => {
  renderWithI18n(
    <div style={{ height: 800 }}>
      <ConversationView
        actions={actions}
        conversationKey="c"
        feedback={feedback}
        messages={path.messages}
        pendingApprovals={[pendingEdit]}
        siblings={path.siblings}
      />
    </div>
  );
  await conversationSettled();
};

/** The rendered row for a fixture message. */
const row = (messageId: string) => {
  const element = document.querySelector<HTMLElement>(
    `[data-message-id="${messageId}"]`
  );
  if (!element) {
    throw new Error(`no row for ${messageId}`);
  }
  return within(element);
};

// The KaTeX chunk loads here, under hookTimeout, not inside a test.
beforeAll(async () => {
  await import("./math-plugin");
});

afterEach(() => {
  cleanup();
});

describe("branches", () => {
  it("shows each fork's position and switches to a sibling", async () => {
    const onSelectBranch = vi.fn();
    await renderView({ onSelectBranch });
    const answer = fixtureId("message", 108);
    const edited = fixtureId("message", 110);

    expect(row(answer).getByText("3/3")).toBeTruthy();
    expect(row(edited).getByText("2/2")).toBeTruthy();
    // The last sibling can't go further.
    expect(
      row(answer)
        .getByRole("button", { name: "Next branch" })
        .hasAttribute("disabled")
    ).toBe(true);

    await userEvent.click(
      row(answer).getByRole("button", { name: "Previous branch" })
    );
    expect(onSelectBranch).toHaveBeenCalledWith(fixtureId("message", 107));
  });
});

describe("approvals", () => {
  it("reviews a proposed edit hunk by hunk and sends one review", async () => {
    const onDecide = vi.fn();
    await renderView({ onDecide });

    await userEvent.click(
      screen.getByRole("button", { name: "Accept change 1" })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Reject change 2" })
    );
    await userEvent.type(
      screen.getByRole("textbox", {
        name: "Comment for the agent on change 2",
      }),
      "Keep bodies out of the index"
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Submit review" })
    );

    expect(onDecide).toHaveBeenCalledWith(pendingEdit.toolCallId, {
      comments: [],
      decision: "review",
      hunks: [
        { decision: "accept", hunkId: "h1" },
        {
          comment: "Keep bodies out of the index",
          decision: "reject",
          hunkId: "h2",
        },
      ],
    });
    expect(await screen.findByText(DECISION_SENT)).toBeTruthy();
  });

  it("rejects the whole call with a reason", async () => {
    const onDecide = vi.fn();
    await renderView({ onDecide });
    await userEvent.click(screen.getByRole("button", { name: "Reject all" }));
    await userEvent.type(screen.getByRole("textbox", { name: WHY }), "Not now");
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onDecide).toHaveBeenCalledWith(pendingEdit.toolCallId, {
      decision: "reject",
      reason: "Not now",
    });
  });

  it("shows no approval controls to someone who can't decide", async () => {
    await renderView({});
    expect(screen.queryByRole("button", { name: "Approve all" })).toBeNull();
  });
});

describe("memory note", () => {
  it("undoes the memory update and says so", async () => {
    const onUndoMemory = vi.fn(() => Promise.resolve());
    await renderView({ onUndoMemory });
    const note = screen.getByText("Memory updated: Uses pnpm");
    expect(note).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndoMemory).toHaveBeenCalledWith({
      previousVersionId: fixtureId("memoryVersion", 2),
      summary: "Uses pnpm",
      versionId: fixtureId("memoryVersion", 3),
    });
    expect(await screen.findByText("Memory change undone")).toBeTruthy();
  });

  it("reports a failed undo", async () => {
    const onUndoMemory = vi.fn(() => Promise.reject(new Error("offline")));
    await renderView({ onUndoMemory });
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

describe("feedback", () => {
  const answer = fixtureId("message", 108);

  it("records a rating at once, then an optional comment and consent", async () => {
    const onFeedback = vi.fn();
    await renderView({ onFeedback });
    await userEvent.click(
      row(answer).getByRole("button", { name: "Bad answer" })
    );
    expect(onFeedback).toHaveBeenLastCalledWith({
      messageId: answer,
      rating: "down",
      shareWithMaintainers: false,
    });

    await userEvent.type(
      await screen.findByRole("textbox", { name: WHAT_WENT_WRONG }),
      "Ignored the budget"
    );
    // Tests run without the stylesheet, so the unstyled checkbox has no box
    // to click; a click event still toggles it.
    screen.getByRole("checkbox", { name: SHARE }).click();
    await userEvent.click(
      screen.getByRole("button", { name: "Send feedback" })
    );
    expect(onFeedback).toHaveBeenLastCalledWith({
      comment: "Ignored the budget",
      messageId: answer,
      rating: "down",
      shareWithMaintainers: true,
    });
  });

  it("clears the rating when the active thumb is pressed again", async () => {
    const onClearFeedback = vi.fn();
    const onFeedback = vi.fn();
    await renderView(
      { onClearFeedback, onFeedback },
      {
        [answer]: { comment: null, rating: "up", shareWithMaintainers: false },
      }
    );
    const good = row(answer).getByRole("button", { name: "Good answer" });
    expect(good.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(good);
    expect(onClearFeedback).toHaveBeenCalledWith(answer);
    expect(onFeedback).not.toHaveBeenCalled();
  });
});

describe("message actions", () => {
  it("edits a user message into a new branch", async () => {
    const onEdit = vi.fn();
    await renderView({ onEdit });
    const question = fixtureId("message", 101);
    await userEvent.click(row(question).getByRole("button", { name: "Edit" }));
    const box = screen.getByRole("textbox", { name: "Edit message" });
    await userEvent.clear(box);
    await userEvent.type(box, "Is Postgres FTS enough?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: question }),
      "Is Postgres FTS enough?"
    );
  });

  it("regenerates an answer", async () => {
    const onRegenerate = vi.fn();
    await renderView({ onRegenerate });
    const answer = fixtureId("message", 108);
    await userEvent.click(
      row(answer).getByRole("button", { name: "Regenerate" })
    );
    expect(onRegenerate).toHaveBeenCalledWith(
      expect.objectContaining({ id: answer })
    );
  });

  it("renders a streaming message without its actions", async () => {
    const streamingId = fixtureId("message", 112);
    renderWithI18n(
      <div style={{ height: 800 }}>
        <ConversationView
          actions={{ onRegenerate: vi.fn() }}
          conversationKey="c"
          messages={path.messages}
          siblings={path.siblings}
          streamingMessageId={streamingId}
        />
      </div>
    );
    await waitFor(() =>
      expect(
        row(streamingId).queryByRole("button", { name: "Regenerate" })
      ).toBeNull()
    );
    expect(
      document.querySelector(
        `[data-message-id="${streamingId}"] [aria-busy="true"]`
      )
    ).not.toBeNull();
  });
});

describe("empty conversation", () => {
  // The app always passes an error slot that renders nothing until a run
  // fails; a new chat must still show its empty state (057).
  const Nothing = () => null;

  it("shows the empty state beside an error slot that renders nothing", () => {
    renderWithI18n(
      <ConversationView
        actions={{}}
        conversationKey="new"
        empty={<p>Nothing yet</p>}
        error={<Nothing />}
        messages={[]}
        siblings={[]}
      />
    );
    expect(screen.getByText("Nothing yet")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Conversation" })).toBeNull();
  });

  it("shows a real error under the empty state", () => {
    renderWithI18n(
      <ConversationView
        actions={{}}
        conversationKey="new"
        empty={<p>Nothing yet</p>}
        error={<p role="alert">It failed</p>}
        messages={[]}
        siblings={[]}
      />
    );
    expect(screen.getByText("Nothing yet")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("It failed");
  });
});
