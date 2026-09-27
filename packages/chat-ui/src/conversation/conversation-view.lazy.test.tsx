import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { initialLeafId, pendingEdit, treeMessages } from "../fixtures";
import { localBranchPath } from "../model/branch";
import { renderWithI18n } from "../testing/render";
import { ConversationView } from "./conversation-view";

// The one test on the real lazy path (ticket 037): the DiffView chunk, then
// @pierre/diffs highlighting with Shiki on the main thread (no worker pool in
// tests), and only then visible hunk controls. Every other conversation test
// uses the synchronous stand-in, so this file alone carries the slow path,
// with timeouts sized for a loaded CI runner rather than a laptop.

const LAZY_TIMEOUT = 60_000;

const path = localBranchPath(treeMessages, initialLeafId);
if (!path) {
  throw new Error("fixture branch path");
}

afterEach(() => {
  cleanup();
});

describe("approvals on the real lazy DiffView", () => {
  it("loads the diff, reviews it hunk by hunk and sends one review", {
    timeout: 2 * LAZY_TIMEOUT,
  }, async () => {
    const onDecide = vi.fn();
    renderWithI18n(
      <div style={{ height: 800 }}>
        <ConversationView
          actions={{ onDecide }}
          conversationKey="c"
          messages={path.messages}
          pendingApprovals={[pendingEdit]}
          siblings={path.siblings}
        />
      </div>
    );

    // Slotted into the diff's shadow DOM, the controls exist before they
    // show; wait until the highlighted diff actually displays them.
    const accept = page.getByRole("button", { name: "Accept change 1" });
    await expect.element(accept, { timeout: LAZY_TIMEOUT }).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Reject change 2" }), {
        timeout: LAZY_TIMEOUT,
      })
      .toBeVisible();

    await userEvent.click(accept);
    await userEvent.click(
      page.getByRole("button", { name: "Reject change 2" })
    );
    await userEvent.type(
      page.getByRole("textbox", {
        name: "Comment for the agent on change 2",
      }),
      "Keep bodies out of the index"
    );
    await userEvent.click(page.getByRole("button", { name: "Submit review" }));

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
  });
});
