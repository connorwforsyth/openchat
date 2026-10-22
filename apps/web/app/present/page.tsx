import { PresenterWindow } from "@workspace/chat-ui/artifacts/presenter";
import { runtimeOriginFrom } from "@workspace/chat-ui/artifacts/runtime-protocol";
import { initLingui } from "@workspace/i18n/server";
import type { Metadata } from "next";
import { connection } from "next/server";

import { requestLocale } from "@/lib/i18n";

// The presenter view's window (n2), opened by a deck's Present. It holds
// no data of its own: the presenting panel sends the deck over a
// BroadcastChannel named by `session`.
export const metadata: Metadata = {
  robots: { follow: false, index: false },
};

export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<{ session?: string }>;
}) {
  await connection();
  initLingui(await requestLocale());
  const { session } = await searchParams;
  return (
    <PresenterWindow
      runtimeOrigin={runtimeOriginFrom(process.env.ARTIFACTS_ORIGIN)}
      session={session ?? ""}
    />
  );
}
