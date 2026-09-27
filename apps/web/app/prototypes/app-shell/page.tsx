import type { Metadata } from "next";

import { Harness } from "./harness";

// Design exploration for ticket 009, not a product page: keep it out of
// search indexes. Delete this folder once a direction is picked.
export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Prototype · App shell",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { v } = await searchParams;
  const initial = Number.parseInt(typeof v === "string" ? v : "1", 10) - 1;
  return <Harness initial={initial} />;
}
