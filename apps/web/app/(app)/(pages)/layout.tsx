import type { ReactNode } from "react";

import { PageShell } from "./page-shell";

// Library, settings and admin share the app shell with the chat (039).
export default function PagesLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <PageShell>{children}</PageShell>;
}
