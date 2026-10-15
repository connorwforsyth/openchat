import type { IconName } from "@workspace/icons/names";
import { z } from "zod";

import { type ArtifactKindDefinition, defineArtifactKind } from "../define";

// Kinds in the contract (162) whose tickets haven't built them yet:
// presentation (164) and diagram (165). Each is a
// definition so every kind has one, but nothing offers it and every save is
// refused, so no version of one can exist until its ticket replaces this.

/** A kind the contract has and the kit doesn't build yet. */
export const plannedKind = ({
  icon,
  kind,
  label,
}: {
  readonly icon: IconName;
  readonly kind: string;
  readonly label: string;
}): ArtifactKindDefinition<string> =>
  defineArtifactKind<string>({
    capabilities: {
      aiCalls: false,
      annotate: false,
      present: false,
      share: false,
    },
    checks: [
      {
        name: "planned",
        run: () => [`${kind} artifacts aren't available yet`],
      },
    ],
    content: z.string(),
    diff: "text",
    editor: "none",
    export: [{ extension: "json", format: "file" }],
    icon,
    instructions: "",
    kind,
    label,
    operations: {},
    render: { panel: "source", runtime: null },
    thumbnail: "none",
  });

export const presentationKind = plannedKind({
  icon: "PlayIcon",
  kind: "presentation",
  label: "Presentation",
});

export const diagramKind = plannedKind({
  icon: "NetworkIcon",
  kind: "diagram",
  label: "Diagram",
});
