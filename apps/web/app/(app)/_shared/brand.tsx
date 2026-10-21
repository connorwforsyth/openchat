import type { PublicConfig } from "@workspace/contract/schemas/meta";

import { BrandLogo } from "@/components/brand-logo";

// The top of the sidebar: the instance's logo and name from config (D18),
// never a literal. The logo is served from our own origin (D27).
export const Brand = ({ config }: { readonly config: PublicConfig }) => (
  <span className="flex min-w-0 items-center gap-2">
    <BrandLogo className="h-5" logoUrl={config.brand.logoUrl} />
    <span className="truncate font-medium text-sm">{config.brand.name}</span>
  </span>
);
