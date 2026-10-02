// Where the app's own update stands (149), as data: main folds the updater's
// events into it and builds the menu from it, so the rules are pure and
// tested. After T3 Code's update machine: an update is never a surprise, the
// menu always says what's happening, and a finished download waits for the
// person to restart rather than for some later quit.

export type UpdateState =
  | { readonly kind: "off"; readonly reason: "build" | "unpackaged" }
  | { readonly kind: "idle" }
  | { readonly kind: "checking"; readonly manual: boolean }
  | {
      readonly kind: "downloading";
      readonly percent: number;
      readonly version: string;
    }
  | { readonly kind: "downloaded"; readonly version: string }
  | { readonly kind: "error"; readonly message: string };

export type UpdateEvent =
  | { readonly type: "check"; readonly manual: boolean }
  | { readonly type: "available"; readonly version: string }
  | { readonly type: "not-available" }
  | { readonly type: "progress"; readonly percent: number }
  | { readonly type: "downloaded"; readonly version: string }
  | { readonly type: "error"; readonly message: string };

const clampPercent = (percent: number): number =>
  Math.min(100, Math.max(0, Math.round(percent)));

export const nextUpdateState = (
  state: UpdateState,
  event: UpdateEvent
): UpdateState => {
  switch (state.kind) {
    case "off":
      return state;
    // A downloaded update waits for a restart; later checks can't undo it.
    case "downloaded":
      return state;
    case "downloading":
      switch (event.type) {
        case "progress":
          return { ...state, percent: clampPercent(event.percent) };
        case "downloaded":
          return { kind: "downloaded", version: event.version };
        case "error":
          return { kind: "error", message: event.message };
        default:
          return state;
      }
    case "idle":
    case "checking":
    case "error":
      switch (event.type) {
        case "check":
          return state.kind === "checking"
            ? state
            : { kind: "checking", manual: event.manual };
        // The updater downloads as soon as it finds one.
        case "available":
          return { kind: "downloading", percent: 0, version: event.version };
        case "not-available":
          return { kind: "idle" };
        case "progress":
          return state;
        case "downloaded":
          return { kind: "downloaded", version: event.version };
        case "error":
          return { kind: "error", message: event.message };
        default:
          return assertNever(event);
      }
    default:
      return assertNever(state);
  }
};

const assertNever = (value: never): never => {
  throw new Error(`unexpected update value: ${JSON.stringify(value)}`);
};

/** The update menu item for a state, or none while updates are off. */
export type UpdateMenuItem =
  | { readonly kind: "check"; readonly enabled: boolean }
  | { readonly kind: "downloading"; readonly percent: number }
  | { readonly kind: "restart"; readonly version: string };

export const updateMenuItem = (state: UpdateState): UpdateMenuItem | null => {
  switch (state.kind) {
    case "off":
      return null;
    case "idle":
    case "error":
      return { enabled: true, kind: "check" };
    case "checking":
      return { enabled: false, kind: "check" };
    case "downloading":
      return { kind: "downloading", percent: state.percent };
    case "downloaded":
      return { kind: "restart", version: state.version };
    default:
      return assertNever(state);
  }
};

/** What to tell the person when a check they asked for ends without an update. */
export const manualCheckOutcome = (
  previous: UpdateState,
  next: UpdateState
): "up-to-date" | "failed" | null => {
  if (previous.kind !== "checking" || !previous.manual) {
    return null;
  }
  if (next.kind === "idle") {
    return "up-to-date";
  }
  return next.kind === "error" ? "failed" : null;
};
