// What the Preview's toolbar shows inline at a given width (070). At the
// 560px default the main area is about 368px wide, and the old toolbar
// squeezed the address bar to 16px while "Static render" wrapped. Now Back,
// the address bar (at least 120px), the "…" menu, the Preview/Code switch and
// Close always fit; Reload, then Forward, then the switch's words, then the
// "Static render" words come back as room allows. Whatever isn't inline is
// in the menu (the words just stay in the labels).

/** CSS pixels, as the toolbar's classes draw them. */
export const TOOLBAR = {
  /** The address bar's minimum. */
  address: 120,
  /** `icon-sm` buttons. */
  button: 28,
  /** `gap-0.5`. */
  gap: 2,
  /** `px-2` on both sides. */
  padding: 16,
  /** "Static render" beside the address bar's icon. */
  staticLabel: 88,
  /** The Preview/Code switch as two icons. */
  toggle: 60,
  /** What the words "Preview" and "Code" add to it. */
  toggleLabels: 84,
} as const;

export interface ToolbarRoom {
  /** The narrow panel's way back to the list leads the row. */
  readonly backToList: boolean;
  /** The panel's Close ends the row. */
  readonly close: boolean;
  /** A rendered file's Preview/Code switch is in the row. */
  readonly toggle: boolean;
  /** The toolbar's width; 0 before it's measured. */
  readonly width: number;
}

export interface ToolbarFit {
  readonly forward: boolean;
  readonly reload: boolean;
  readonly staticLabel: boolean;
  readonly toggleLabels: boolean;
}

const slot = (width: number) => width + TOOLBAR.gap;

/** The width of everything that's always in the row. */
export const toolbarMinimum = ({
  backToList,
  close,
  toggle,
}: Omit<ToolbarRoom, "width">): number =>
  TOOLBAR.padding -
  TOOLBAR.gap +
  (backToList ? slot(TOOLBAR.button) : 0) +
  slot(TOOLBAR.button) + // Back
  slot(TOOLBAR.address) +
  slot(TOOLBAR.button) + // the menu
  (toggle ? slot(TOOLBAR.toggle) : 0) +
  (close ? slot(TOOLBAR.button) : 0);

const FULL: ToolbarFit = {
  forward: true,
  reload: true,
  staticLabel: true,
  toggleLabels: true,
};

/** Which optional parts fit, spending the spare width in order. */
export const fitBrowserToolbar = (room: ToolbarRoom): ToolbarFit => {
  // Before the first measurement: everything, as on a wide panel.
  if (room.width <= 0) {
    return FULL;
  }
  const spare = room.width - toolbarMinimum(room);
  const reload = spare >= slot(TOOLBAR.button);
  const forward = spare >= 2 * slot(TOOLBAR.button);
  const afterButtons = spare - 2 * slot(TOOLBAR.button);
  const toggleLabels =
    forward && room.toggle && afterButtons >= TOOLBAR.toggleLabels;
  const staticLabel =
    forward &&
    afterButtons - (toggleLabels ? TOOLBAR.toggleLabels : 0) >=
      TOOLBAR.staticLabel;
  return { forward, reload, staticLabel, toggleLabels };
};
