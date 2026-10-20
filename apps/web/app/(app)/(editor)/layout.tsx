import type { ReactNode } from "react";

import { EditorScreen } from "./editor-screen";

// The library's editors take over the screen (192): no app sidebar beside
// them, a bar with the way back on top. They live outside `(pages)` so the
// shell's sidebar isn't rendered at all, rather than hidden.
export default function EditorLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <EditorScreen>{children}</EditorScreen>;
}
