import type { ReactNode } from "react";

export default function CustomizeLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-full w-full flex-col p-4 md:p-8">{children}</div>
  );
}
