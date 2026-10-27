import { cleanup, screen } from "@testing-library/react";
import { Toaster } from "@workspace/ui/components/toast";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import type { QueuedTurn } from "../model/queue";
import { renderWithI18n } from "../testing/render";
import { type QueueActions, QueueTray } from "./queue-tray";

// The queue over the composer: its author's actions, and why one didn't
// happen.

afterEach(cleanup);

const turn = (extra: Partial<QueuedTurn> = {}): QueuedTurn =>
  ({
    delivery: "queue",
    messageId: "m1",
    mine: true,
    position: 1,
    runId: "r1",
    text: "Later.",
    ...extra,
  }) as QueuedTurn;

const actions = (extra: Partial<QueueActions> = {}): QueueActions => ({
  onEdit: vi.fn(() => Promise.resolve({ kept: false })),
  onRemove: vi.fn(() => Promise.resolve({ kept: false })),
  onSteer: vi.fn(() => Promise.resolve()),
  ...extra,
});

const render = (turns: readonly QueuedTurn[], given = actions()) =>
  renderWithI18n(
    <Toaster>
      <QueueTray actions={given} pending={new Set()} turns={turns} />
    </Toaster>
  );

describe("QueueTray", () => {
  it("offers steer, edit and remove on your own turns only", async () => {
    render([
      turn(),
      turn({
        messageId: "m2" as QueuedTurn["messageId"],
        mine: false,
        runId: "r2" as QueuedTurn["runId"],
        text: "Theirs.",
      }),
    ]);
    await expect.element(screen.getByText("Theirs.")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Steer now" })).toHaveLength(
      1
    );
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: "Remove from the queue" })
    ).toHaveLength(1);
  });

  it("says why the server refused", async () => {
    render(
      [turn()],
      actions({
        onSteer: () => Promise.reject({ code: "FORBIDDEN" }),
      })
    );
    await userEvent.click(screen.getByRole("button", { name: "Steer now" }));
    // A toast's title also goes to its live region, so it's there twice.
    expect(
      (
        await screen.findAllByText(
          "Only the person who sent a queued message can change it."
        )
      ).length
    ).toBeGreaterThan(0);
  });

  it("says when a message taken back stays in the chat", async () => {
    render(
      [turn()],
      actions({ onEdit: () => Promise.resolve({ kept: true }) })
    );
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      (
        await screen.findAllByText(
          "A message was queued after it, so it stays in the chat."
        )
      ).length
    ).toBeGreaterThan(0);
  });
});
