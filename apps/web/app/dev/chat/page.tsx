import { runtimeOriginFrom } from "@workspace/chat-ui/artifacts/runtime-protocol";
import { initLingui } from "@workspace/i18n/server";
import type { Metadata } from "next";

import { requestLocale } from "@/lib/i18n";

import { ChatDemo } from "./demo";

// A developer gallery, not a product page: keep it out of search indexes.
export const metadata: Metadata = {
  robots: { follow: false, index: false },
};

export default async function Page() {
  // Pages render independently of layouts, so each sets up Lingui for RSC.
  initLingui(await requestLocale());

  // Read per request, so the runtime can be pointed elsewhere without a
  // rebuild. Unset or invalid: previews fall back to `srcdoc`.
  return (
    <ChatDemo
      artifactsOrigin={runtimeOriginFrom(process.env.ARTIFACTS_ORIGIN)}
    />
  );
}
