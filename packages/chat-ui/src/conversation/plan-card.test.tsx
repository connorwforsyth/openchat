import { cleanup, screen } from "@testing-library/react";
import type { ArtifactId } from "@workspace/contract/schemas/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import type { PlanRef } from "../model/plan";
import { renderWithI18n } from "../testing/render";
import {
  type ConversationActions,
  ConversationActionsProvider,
} from "./actions";
import { PlanCard, type PlanStatus, PlanStatusProvider } from "./plan-card";

// The plan card (106): Approve, Edit and Discard while the plan waits;
// just its title once it's approved or set aside.

afterEach(cleanup);

const plan = {
  artifactId: "019a0000-0000-7000-8000-0000000000a1",
  title: "Plan: Add a dark theme",
  versionId: "019a0000-0000-7000-8000-0000000000b1",
} as PlanRef;

const NONE = new Set<ArtifactId>();

const renderCard = (
  actions: ConversationActions,
  status: Partial<PlanStatus> = {}
) =>
  renderWithI18n(
    <ConversationActionsProvider actions={actions}>
      <PlanStatusProvider
        value={{ approved: NONE, busy: false, discarded: NONE, ...status }}
      >
        <PlanCard plan={plan} />
      </PlanStatusProvider>
    </ConversationActionsProvider>
  );

describe("PlanCard", () => {
  it("approves, edits and discards the plan it shows", async () => {
    const onApprovePlan = vi.fn();
    const onEditPlan = vi.fn();
    const onDiscardPlan = vi.fn();
    const onOpenArtifact = vi.fn();
    renderCard({ onApprovePlan, onDiscardPlan, onEditPlan, onOpenArtifact });
    expect(screen.getByText("Plan · Waiting for your approval")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprovePlan).toHaveBeenCalledWith(plan);

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEditPlan).toHaveBeenCalledWith(plan);
    // Edit opens the plan in the panel, where the editor takes over.
    expect(onOpenArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: plan.artifactId, kind: "markdown" })
    );

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscardPlan).toHaveBeenCalledWith(plan);
  });

  it("waits to approve while a run is going", () => {
    renderCard({ onApprovePlan: vi.fn() }, { busy: true });
    expect(
      (screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("keeps only its title once approved or set aside", () => {
    renderCard(
      { onApprovePlan: vi.fn() },
      { approved: new Set([plan.artifactId]) }
    );
    expect(screen.getByText("Plan · Approved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    cleanup();
    renderCard(
      { onApprovePlan: vi.fn() },
      { discarded: new Set([plan.artifactId]) }
    );
    expect(screen.getByText("Plan · Set aside")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("offers no actions in a read-only view", () => {
    renderCard({});
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});
