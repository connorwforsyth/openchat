import { z } from "zod";

/**
 * Icon sets the registry knows about. A set is "implemented" when
 * `src/sets/<id>.ts` (web) or `src/sets/<id>.native.ts` exists; until then
 * every name falls back to lucide. Material Symbols come from
 * `@material-symbols/svg-*` as SVG components, not the variable font (D19).
 */
export const iconSetIds = [
  "lucide",
  "phosphor",
  "tabler",
  "hugeicons",
  "material",
] as const;

export const iconSetSchema = z.enum(iconSetIds);

export type IconSetId = z.infer<typeof iconSetSchema>;

export const fallbackIconSet = "lucide" satisfies IconSetId;

export type IconPlatform = "native" | "web";
