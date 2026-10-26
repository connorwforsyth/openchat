import { cleanup, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { chatArtifacts } from "../fixtures";
import { renderWithI18n } from "../testing/render";
import type { ChatTask } from "./chat-tasks";
import {
  artifactsByChange,
  OutputsCard,
  type OutputsCardProps,
} from "./outputs-card";

afterEach(cleanup);

const NOTHING_YET = /Nothing yet/;

const card = (overrides: Partial<OutputsCardProps> = {}) => (
  <div className="relative h-[40rem] [container-type:size]">
    <OutputsCard
      artifacts={chatArtifacts}
      cardRef={createRef()}
      current={null}
      id="outputs"
      instant={false}
      onCollapse={vi.fn()}
      onPick={vi.fn()}
      onRoomy={vi.fn()}
      onShowTask={vi.fn()}
      shown
      tasks={[]}
      {...overrides}
    />
  </div>
);

const running: ChatTask = {
  messageId: "a0" as ChatTask["messageId"],
  runId: "r0" as ChatTask["runId"],
  status: "running",
  step: null,
  text: "Make a deck.",
};

describe("the outputs card", () => {
  it("lists the one changed last first", () => {
    const [a, b] = chatArtifacts;
    if (!(a && b)) {
      throw new Error("fixture artifacts");
    }
    const older = { ...a, updatedAt: "2026-01-01T00:00:00.000Z" };
    const newer = { ...b, updatedAt: "2026-02-01T00:00:00.000Z" };
    expect(artifactsByChange([older, newer]).map(({ id }) => id)).toEqual([
      newer.id,
      older.id,
    ]);
  });

  it("says what appears there before there's anything", () => {
    renderWithI18n(card({ artifacts: [] }));
    expect(screen.getByText(NOTHING_YET)).toBeTruthy();
    expect(screen.queryByText("Tasks")).toBeNull();
  });

  it("marks the one shown and one still being made, and opens a pick", async () => {
    const [a, b] = chatArtifacts;
    if (!(a && b)) {
      throw new Error("fixture artifacts");
    }
    const onPick = vi.fn();
    renderWithI18n(
      card({
        artifacts: [a, { ...b, latestVersionId: null }],
        current: a.id,
        onPick,
      })
    );
    const shown = screen.getByRole("button", { name: a.title });
    expect(shown.getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("Making…")).toBeTruthy();
    await userEvent.click(shown);
    expect(onPick).toHaveBeenCalledWith(a);
  });

  it("lists what the agent is on, and shows a task's turn", async () => {
    const onShowTask = vi.fn();
    const queued: ChatTask = {
      ...running,
      messageId: "m-r1" as ChatTask["messageId"],
      runId: "r1" as ChatTask["runId"],
      status: "steering",
      text: "Use blue.",
    };
    renderWithI18n(card({ onShowTask, tasks: [running, queued] }));
    expect(screen.getByText("Tasks")).toBeTruthy();
    expect(screen.getByText("Working…")).toBeTruthy();
    expect(screen.getByText("Steering")).toBeTruthy();
    await userEvent.click(screen.getByText("Use blue."));
    expect(onShowTask).toHaveBeenCalledWith(queued);
  });

  it("collapses on Escape from inside it", async () => {
    const onCollapse = vi.fn();
    renderWithI18n(card({ onCollapse }));
    screen.getAllByRole("button")[1]?.focus();
    await userEvent.keyboard("{Escape}");
    expect(onCollapse).toHaveBeenCalledWith("keyboard");
  });

  it("is out of reach while collapsed", () => {
    renderWithI18n(card({ instant: true, shown: false }));
    expect(
      screen.queryByRole("region", { name: "Artifacts and tasks" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: chatArtifacts[0]?.title })
    ).toBeNull();
  });
});
