import type { ReactNode } from "react";

import { getPublicConfig } from "@/lib/public-config";

// Sign in, sign up and invitations: public pages, one centred card under the
// instance's name (D18). The proxy never guards these.
export default async function AuthLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const config = await getPublicConfig();
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      {config.ok ? (
        <p className="font-medium text-lg">{config.config.brand.name}</p>
      ) : null}
      {children}
    </main>
  );
}
