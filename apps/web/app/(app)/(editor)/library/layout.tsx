import type { ReactNode } from "react";

import { LibraryProviders } from "@/app/(app)/(pages)/library/providers";

export default function LibraryEditorLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <LibraryProviders>{children}</LibraryProviders>;
}
