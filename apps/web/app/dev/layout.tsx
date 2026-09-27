import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";

// The developer galleries (`/dev/*`) are for working on components, not for
// users: they exist only when ENABLE_DEV_ROUTES=1 (007, Q12). Checked per
// request, so one build serves both.
export default async function DevLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  await connection();
  if (process.env.ENABLE_DEV_ROUTES !== "1") {
    notFound();
  }
  return children;
}
