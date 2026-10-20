"use client";

import { useShortcut } from "@workspace/shortcuts/react/use-shortcut";
import type { ReactNode } from "react";

import { useAppFrame } from "@/app/(app)/_shared/app-frame";

/** The full-screen frame: ⌘K still opens the palette, as everywhere else. */
export function EditorScreen({ children }: { readonly children: ReactNode }) {
  const frame = useAppFrame();
  useShortcut("palette.open", frame.openPalette);
  return <main className="min-h-svh bg-background">{children}</main>;
}
