import type { ReactNode } from "react";

import { LibraryProviders } from "./providers";

// A plain frame for now; the app shell (025) replaces it with the sidebar
// and header.
export default function LibraryLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <LibraryProviders>
      <main className="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-8 p-6">
        {children}
      </main>
    </LibraryProviders>
  );
}
