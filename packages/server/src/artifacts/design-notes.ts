import type { ArtifactDesignNotes } from "@workspace/artifacts-kit/instance";
import { THEMED_KINDS } from "@workspace/artifacts-kit/kind-theme";

// The instance's house style for artifacts (n2): `DESIGN.md` in its brand
// folder for every kind, then `kinds/<kind>/DESIGN.md`. Prose only; it's
// added to the kind's guide, which is what the model reads. Theme values
// (`theme.css`) stay with the artifact runtime and never reach the model.

/** Reads a file's text, or `null` if it isn't there. */
export type ReadText = (path: string) => Promise<string | null>;

export const readArtifactDesign = async (
  dir: string,
  read: ReadText
): Promise<ArtifactDesignNotes> => {
  const shared = (await read(`${dir}/DESIGN.md`))?.trim() ?? "";
  const entries = await Promise.all(
    THEMED_KINDS.map(async (kind) => {
      const own = (await read(`${dir}/kinds/${kind}/DESIGN.md`))?.trim() ?? "";
      const notes = [shared, own].filter(Boolean).join("\n\n");
      return notes ? [[kind, notes] as const] : [];
    })
  );
  return Object.fromEntries(entries.flat());
};
