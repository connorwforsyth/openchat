import type { ReactNode } from "react";

export default function ArtifactsLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col p-4 md:p-6">
      {children}
    </div>
  );
}
