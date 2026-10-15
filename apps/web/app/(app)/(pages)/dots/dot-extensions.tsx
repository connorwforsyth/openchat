import type { Dot } from "@workspace/contract/schemas/dots";
import type { ComponentType } from "react";

// Where the Dot's other surfaces plug in (172). The Dot home renders a Call
// button and a Computer tab only when these are set, so the voice and
// computer work can land on their own branches by filling one entry each,
// without touching the home or the profile.
//
// - `CallButton`: rendered in the Dot's header, before "Profile". Give it a
//   `size="sm"` (or icon) Button; it owns its overlay.
// - `ComputerTab`: the body of the profile's "Computer" tab (the tab itself,
//   its label and icon, are the home's). `ComputerTabLabel` may replace the
//   label (say, with a live dot while it's working).

export interface DotSurfaceProps {
  readonly dot: Dot;
}

export interface DotExtensions {
  readonly CallButton: ComponentType<DotSurfaceProps> | null;
  readonly ComputerTab: ComponentType<DotSurfaceProps> | null;
  readonly ComputerTabLabel: ComponentType<DotSurfaceProps> | null;
}

export const dotExtensions: DotExtensions = {
  CallButton: null,
  ComputerTab: null,
  ComputerTabLabel: null,
};
