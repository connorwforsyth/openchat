import { cleanup, screen } from "@testing-library/react";
import { fixtureId } from "@workspace/contract/fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { artifactPage } from "../fixtures";
import type { ArtifactRefPart } from "../model/parts";
import { renderWithI18n } from "../testing/render";
import {
  type ConversationActions,
  ConversationActionsProvider,
} from "./actions";
import { ArtifactCard } from "./artifact-card";

const part: ArtifactRefPart = {
  artifactId: artifactPage.id,
  kind: "site",
  title: "Copperloaf website",
  type: "artifact-ref",
  versionId: fixtureId("artifactVersion", 1),
};

const renderCard = (actions: ConversationActions) =>
  renderWithI18n(
    <ConversationActionsProvider actions={actions}>
      <ArtifactCard part={part} />
    </ConversationActionsProvider>
  );

afterEach(cleanup);

describe("an artifact's card in the chat (night 2)", () => {
  it("opens the artifact from its Open, the one way in from the keyboard", async () => {
    const onOpenArtifact = vi.fn();
    renderCard({ onOpenArtifact });
    expect(screen.getByText("Site")).toBeTruthy();
    const open = screen.getByRole("button", {
      name: "Open artifact: Copperloaf website",
    });
    expect(open.textContent).toBe("Open");
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(open);
    await userEvent.keyboard("{Enter}");
    expect(onOpenArtifact).toHaveBeenCalledWith(part);
  });

  it("opens it from anywhere on the card", async () => {
    const onOpenArtifact = vi.fn();
    renderCard({ onOpenArtifact });
    await userEvent.click(screen.getByText("Copperloaf website"));
    expect(onOpenArtifact).toHaveBeenCalledWith(part);
  });

  it("offers the artifact's own page in a new tab when the host has one", async () => {
    renderCard({
      artifactHref: (id) => `/artifacts/${id}`,
      onOpenArtifact: vi.fn(),
    });
    await userEvent.click(
      screen.getByRole("button", {
        name: "More ways to open Copperloaf website",
      })
    );
    const item = await screen.findByRole("menuitem", {
      name: "Open in a new tab",
    });
    expect(item.getAttribute("href")).toBe(`/artifacts/${artifactPage.id}`);
    expect(item.getAttribute("target")).toBe("_blank");
  });

  it("has only Open without a page, and nothing to press without a panel", () => {
    renderCard({ onOpenArtifact: vi.fn() });
    expect(
      screen.queryByRole("button", {
        name: "More ways to open Copperloaf website",
      })
    ).toBeNull();
    cleanup();
    renderCard({});
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Copperloaf website")).toBeTruthy();
  });
});
