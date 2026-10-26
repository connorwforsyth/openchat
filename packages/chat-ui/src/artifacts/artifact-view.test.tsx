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
  it("puts the title, the versions and the tabs in the host's row", () => {
    renderAt(900);
    expect(
      row().getByRole("heading", { name: artifactPlan.title })
    ).toBeTruthy();
    expect(row().getByRole("group", { name: "Versions" })).toBeTruthy();
    expect(row().getByText("v2 of 2")).toBeTruthy();
    const tabs = row().getByRole("tablist", { name: "Artifact views" });
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map((tab) => tab.getAttribute("aria-label"))
    ).toEqual(["Preview", "Code", "Changes"]);
    // The host's Close ends the same row.
    expect(row().getByRole("button", { name: "Close" })).toBeTruthy();
    // Nothing to fold away: no menu.
    expect(
      row().queryByRole("button", { name: "More artifact actions" })
    ).toBeNull();
  });

  it("shows the tabs' words on a wide row and only icons on a narrower one", () => {
    renderAt(900);
    const words = () =>
      row()
        .getAllByRole("tab")
        .map((tab) => tab.querySelector("span")?.className);
    expect(words()).toEqual(["inline", "inline", "inline"]);
    cleanup();
    renderAt(360);
    expect(words()).toEqual(["hidden", "hidden", "hidden"]);
    // …with the pager still in the row.
    expect(row().getByRole("group", { name: "Versions" })).toBeTruthy();
  });

  it("moves the versions into a '…' menu when the row is narrow", async () => {
    const { onSelect } = renderAt(260);
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
    expect(
      row().getByRole("tab", { name: "Changes" }).getAttribute("aria-disabled")
    ).toBe("true");
  });

  it("shows the source without a second header naming the file again", async () => {
    renderAt(900);
    await userEvent.click(row().getByRole("tab", { name: "Code" }));
    // The title, once: CodeView's own header is off.
    expect(screen.getAllByText(artifactPlan.title)).toHaveLength(1);
    const panel = screen.getByRole("tabpanel");
    // And no card around it.
    const card = panel.firstElementChild;
    expect(card?.className).toContain("border-0");
    expect(card?.className).toContain("rounded-none");
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
    expect(screen.getByRole("tablist")).toBeTruthy();
  });
});

describe("ArtifactView's preview without the artifacts service", () => {
  const site = { ...artifactPage, kind: "site" as const, title: "Bakery" };
  const siteVersions = (pageVersions ?? []).map((version) => ({
    ...version,
    content: '{"files":{"index.html":"<p>Hi</p>"}}',
  }));

  it("opens on Preview and says why it can't show, instead of the code", async () => {
    renderAt(900, {
      artifact: site,
      runtimeOrigin: null,
      versions: siteVersions,
    });
    expect(row().getByRole("tab", { name: "Preview" })).toBeTruthy();
    expect(screen.getByText(NO_SERVICE)).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Show the code" })
    );
    expect(
      row().getByRole("tab", { name: "Code" }).getAttribute("aria-selected")
    ).toBe("true");
  });
});
