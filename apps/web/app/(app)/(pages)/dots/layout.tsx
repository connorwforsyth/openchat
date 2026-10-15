import type { ReactNode } from "react";

export default function DotsLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col p-4 md:p-6">
      {children}
    </div>
  );
}
