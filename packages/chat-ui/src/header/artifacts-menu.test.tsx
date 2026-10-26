import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { chatArtifacts } from "../fixtures";
import { renderWithI18n } from "../testing/render";
import { ArtifactsMenu, artifactsByChange } from "./artifacts-menu";

afterEach(cleanup);

const NOTHING_YET = /Nothing yet/;

describe("the header's Artifacts list", () => {
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
    renderWithI18n(
      <ArtifactsMenu
        artifacts={[]}
        current={null}
        onOpenChange={vi.fn()}
        onPick={vi.fn()}
        open
      />
    );
    expect(screen.getByText(NOTHING_YET)).toBeTruthy();
  });

  it("marks the one shown and one still being made", () => {
    const [a, b] = chatArtifacts;
    if (!(a && b)) {
      throw new Error("fixture artifacts");
    }
    renderWithI18n(
      <ArtifactsMenu
        artifacts={[a, { ...b, latestVersionId: null }]}
        current={a.id}
        onOpenChange={vi.fn()}
        onPick={vi.fn()}
        open
      />
    );
    const options = screen.getAllByRole("option");
    const shown = options.find((option) =>
      option.textContent?.includes(a.title)
    );
    expect(shown?.getAttribute("data-checked")).toBe("true");
    expect(screen.getByText("Making…", { exact: false })).toBeTruthy();
  });
});
