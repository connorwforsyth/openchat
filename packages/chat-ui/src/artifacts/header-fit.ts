// What the artifact view's one header row shows inline at a given width
// (075), the way the Preview's toolbar fits (`workspace/model/toolbar.ts`).
// The title keeps at least 96px and the row's switches (a diagram's "Edit as
// text"; artifacts have no Preview/Code tabs since night 2) always show, as
// icons; the version pager, then the switches' words, come back as room
// allows. The pager that doesn't fit is in the "…" menu (the words just stay
// in the switches' labels).

/** CSS pixels, as the row's classes draw them. */
export const ARTIFACT_HEADER = {
  /** `gap-1` between the row's parts. */
  gap: 4,
  /** The "…" menu's `icon-sm` button. */
  menu: 28,
  /** ‹ v1 of 3 ›: two `icon-xs` buttons around a `min-w-16` label. */
  pager: 112,
  /** An icon-only tab (`h-7 min-w-7`). */
  tab: 28,
  /** `gap-0.5` between the tabs. */
  tabGap: 2,
  /** What a switch's word adds to it ("Edit as text"). */
  tabLabel: 72,
  /** The title's minimum. */
  title: 96,
} as const;

export interface ArtifactHeaderRoom {
  /** The switches in the row: 1 for "Edit as text", else 0. */
  readonly tabs: number;
  /** More than one version: there's somewhere to page to. */
  readonly versions: boolean;
  /** The width for the title and the controls; 0 before it's measured. */
  readonly width: number;
}

export interface ArtifactHeaderFit {
  /** The "…" menu, with the versions the row had no room for. */
  readonly menu: boolean;
  readonly pager: boolean;
  readonly tabLabels: boolean;
}

/** The title at its minimum and the tabs as icons: always in the row. */
export const artifactHeaderMinimum = (tabs: number): number =>
  ARTIFACT_HEADER.title +
  ARTIFACT_HEADER.gap +
  tabs * ARTIFACT_HEADER.tab +
  Math.max(0, tabs - 1) * ARTIFACT_HEADER.tabGap;

/** Which optional parts fit, spending the spare width in order. */
export const fitArtifactHeader = ({
  tabs,
  versions,
  width,
}: ArtifactHeaderRoom): ArtifactHeaderFit => {
  const labels = tabs * ARTIFACT_HEADER.tabLabel;
  // Before the first measurement: everything, as on a wide panel.
  if (width <= 0) {
    return { menu: false, pager: versions, tabLabels: true };
  }
  const spare = width - artifactHeaderMinimum(tabs);
  const pagerWidth = ARTIFACT_HEADER.gap + ARTIFACT_HEADER.pager;
  const pager = versions && spare >= pagerWidth;
  const menu = versions && !pager;
  const used = pager ? pagerWidth : 0;
  const tabLabels = !menu && spare - used >= labels;
  return { menu, pager, tabLabels };
};
