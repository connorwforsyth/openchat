import type { ReactNode } from "react";

// An org's admin pages became its space settings (187), inside the settings
// view (185): no second sidebar beside the app's. Each page here redirects
// there, so old links keep working.
export default function OrgAdminLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return children;
}
