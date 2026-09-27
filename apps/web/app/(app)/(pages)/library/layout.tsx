import type { ReactNode } from "react";

import { LibraryProviders } from "./providers";

export default function LibraryLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <LibraryProviders>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 p-4 md:p-6">
        {children}
      </div>
    </LibraryProviders>
  );
}
