import type { PublicConfig } from "@workspace/contract/schemas/meta";

// The top of the sidebar: the instance's name from config (D18), never a
// literal. A logo waits for a first-party asset route (D27: no third-party
// asset hosts), so it's the name alone for now.
export const Brand = ({ config }: { readonly config: PublicConfig }) => (
  <span className="truncate font-medium text-sm">{config.brand.name}</span>
);
