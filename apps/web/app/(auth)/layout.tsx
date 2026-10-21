import type { ReactNode } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { DesktopDragRegion } from "@/components/desktop-drag-region";
import { getPublicConfig } from "@/lib/public-config";

// Sign in, sign up and invitations: public pages, one centred card under the
// instance's logo and name (D18). The proxy never guards these.
export default async function AuthLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const config = await getPublicConfig();
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      <DesktopDragRegion />
      {config.ok ? (
        <div className="flex flex-col items-center gap-3">
          <BrandLogo className="h-10" logoUrl={config.config.brand.logoUrl} />
          <p className="font-medium text-lg">{config.config.brand.name}</p>
        </div>
      ) : null}
      {children}
    </main>
  );
}
