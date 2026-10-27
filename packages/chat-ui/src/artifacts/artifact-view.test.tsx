import { cleanup, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import { artifactPage, artifactPlan, artifactVersions } from "../fixtures";
import { renderWithI18n } from "../testing/render";
import { ArtifactView, type ArtifactViewProps } from "./artifact-view";

const NO_SERVICE = /needs the artifacts service, which isn't running/;

afterEach(cleanup);

const NO_ARTIFACTS = /No artifacts yet/;

// The host's frame for the one header row, as the Workspace panel's
// ViewHeader is: the view's contents, then the host's own Close.
const header = (content: ReactNode) => (
  <div data-testid="header">
    {content}
    <button type="button">Close</button>
  </div>
);

const planVersions = artifactVersions[artifactPlan.id];
const pageVersions = artifactVersions[artifactPage.id];

const renderAt = (width: number, props: Partial<ArtifactViewProps> = {}) => {
  const onSelect = vi.fn();
  renderWithI18n(
    // Inline styles: the tests load no Tailwind, and the header measures
    // the room it has.
    <div style={{ display: "flex", flexDirection: "column", width }}>
      <ArtifactView
        artifact={artifactPlan}
        header={header}
        onSelect={onSelect}
        versions={planVersions}
        {...props}
      />
    </div>
  );
  return { onSelect };
};

const row = () => within(screen.getByTestId("header"));

describe("ArtifactView's one header row (075)", () => {
  it("puts the title and the versions in the host's row, with no code views", () => {
    renderAt(900);
    expect(
      row().getByRole("heading", { name: artifactPlan.title })
    ).toBeTruthy();
    expect(row().getByRole("group", { name: "Versions" })).toBeTruthy();
    expect(row().getByText("v2 of 2")).toBeTruthy();
    // An artifact is its rendered self (night 2): no Preview/Code/Changes.
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Code" })).toBeNull();
    // The host's Close ends the same row.
    expect(row().getByRole("button", { name: "Close" })).toBeTruthy();
    // Nothing to fold away: no menu.
    expect(
      row().queryByRole("button", { name: "More artifact actions" })
    ).toBeNull();
  });

  it("moves the versions into a '…' menu when the row is narrow", async () => {
    const { onSelect } = renderAt(200);
    expect(row().queryByRole("group", { name: "Versions" })).toBeNull();
    await userEvent.click(
      row().getByRole("button", { name: "More artifact actions" })
    );
    expect(await screen.findByText("Version 2 of 2")).toBeTruthy();
    const newer = screen.getByRole("menuitem", { name: "Newer version" });
    expect(newer.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Older version" })
    );
    expect(onSelect).toHaveBeenCalledWith({
      artifactId: artifactPlan.id,
      versionId: planVersions?.[0]?.id,
    });
  });

  it("has no pager for a single version", () => {
    renderAt(900, { artifact: artifactPage, versions: pageVersions });
    expect(row().queryByRole("group", { name: "Versions" })).toBeNull();
    expect(
      row().queryByRole("button", { name: "More artifact actions" })
    ).toBeNull();
  });

  it("shows a code artifact as its code, flush, without a second header", () => {
    const code = { ...artifactPlan, kind: "code" as const, title: "bake.ts" };
    renderAt(900, { artifact: code });
    // The title, once: CodeView's own header is off.
    expect(screen.getAllByText(code.title)).toHaveLength(1);
    // And no card around it.
    expect(document.querySelector(".rounded-none.border-0")).toBeTruthy();
  });

  it("keeps the host's row while loading and when there's nothing yet", () => {
    renderAt(400, { versions: undefined });
    expect(
      row().getByRole("heading", { name: artifactPlan.title })
    ).toBeTruthy();
    expect(screen.getByText("Loading artifact")).toBeTruthy();
    cleanup();
    renderAt(400, { artifact: undefined, versions: undefined });
    expect(row().getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.getByText(NO_ARTIFACTS)).toBeTruthy();
  });
});

describe("ArtifactView editing a plan (106)", () => {
  const editing = (overrides = {}) => ({
    artifactId: artifactPlan.id,
    onApprove: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  });

  it("shows the latest version in an editor and approves it unchanged", async () => {
    const plan = editing();
    renderAt(900, { editing: plan });
    const box = screen.getByRole("textbox", { name: "Plan, in Markdown" });
    expect((box as HTMLTextAreaElement).value).toBe(
      planVersions?.at(-1)?.content
    );
    expect(screen.queryByRole("tablist")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Approve the plan" })
    );
    expect(plan.onApprove).toHaveBeenCalledWith(undefined);
  });

  it("approves with the edits, or cancels", async () => {
    const plan = editing();
    renderAt(900, { editing: plan });
    const box = screen.getByRole("textbox", { name: "Plan, in Markdown" });
    await userEvent.fill(box, "# Plan: smaller\n\n## Goal\nLess.");
    await userEvent.click(
      screen.getByRole("button", { name: "Approve the plan" })
    );
    expect(plan.onApprove).toHaveBeenCalledWith(
      "# Plan: smaller\n\n## Goal\nLess."
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(plan.onCancel).toHaveBeenCalled();
  });

  it("is the usual view for any other artifact", () => {
    renderAt(900, { editing: editing({ artifactId: artifactPage.id }) });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Approve the plan" })
    ).toBeNull();
  });
});

describe("ArtifactView's preview without the artifacts service", () => {
  const site = { ...artifactPage, kind: "site" as const, title: "Bakery" };
  const siteVersions = (pageVersions ?? []).map((version) => ({
    ...version,
    content: '{"files":{"index.html":"<p>Hi</p>"}}',
  }));

  it("says why it can't show, and never falls back to the code", () => {
    renderAt(900, {
      artifact: site,
      runtimeOrigin: null,
      versions: siteVersions,
    });
    expect(screen.getByText(NO_SERVICE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show the code" })).toBeNull();
    expect(screen.queryByText("index.html")).toBeNull();
  });
});
