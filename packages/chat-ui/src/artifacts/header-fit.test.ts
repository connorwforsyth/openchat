import { describe, expect, it } from "vitest";

import {
  ARTIFACT_HEADER,
  artifactHeaderMinimum,
  fitArtifactHeader,
} from "./header-fit";

const withPager = (tabs: number) =>
  artifactHeaderMinimum(tabs) + ARTIFACT_HEADER.gap + ARTIFACT_HEADER.pager;
const withWords = (tabs: number) =>
  withPager(tabs) + tabs * ARTIFACT_HEADER.tabLabel;

describe("fitArtifactHeader", () => {
  it("shows everything before the row is measured", () => {
    expect(fitArtifactHeader({ tabs: 3, versions: true, width: 0 })).toEqual({
      menu: false,
      pager: true,
      tabLabels: true,
    });
  });

  it("fits the pager and the tabs' words on a wide row", () => {
    expect(
      fitArtifactHeader({ tabs: 3, versions: true, width: withWords(3) })
    ).toEqual({ menu: false, pager: true, tabLabels: true });
  });

  it("drops the tabs' words first, then moves the pager into the menu", () => {
    expect(
      fitArtifactHeader({ tabs: 3, versions: true, width: withWords(3) - 1 })
    ).toEqual({ menu: false, pager: true, tabLabels: false });
    expect(
      fitArtifactHeader({ tabs: 3, versions: true, width: withPager(3) - 1 })
    ).toEqual({ menu: true, pager: false, tabLabels: false });
  });

  it("keeps the pager at the Workspace panel's default width (a 368px main area)", () => {
    // 368 less the row's padding, Close and the title's inset.
    expect(
      fitArtifactHeader({ tabs: 3, versions: true, width: 316 }).pager
    ).toBe(true);
  });

  it("has no pager or menu for one version, so the words come back sooner", () => {
    const width = artifactHeaderMinimum(3) + 3 * ARTIFACT_HEADER.tabLabel;
    expect(fitArtifactHeader({ tabs: 3, versions: false, width })).toEqual({
      menu: false,
      pager: false,
      tabLabels: true,
    });
    expect(
      fitArtifactHeader({ tabs: 3, versions: false, width: width - 1 })
    ).toEqual({ menu: false, pager: false, tabLabels: false });
  });

  it("needs less for two tabs (no preview)", () => {
    expect(artifactHeaderMinimum(2)).toBeLessThan(artifactHeaderMinimum(3));
    expect(
      fitArtifactHeader({ tabs: 2, versions: true, width: withWords(2) })
        .tabLabels
    ).toBe(true);
  });
});
