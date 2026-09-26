import { Trans } from "@lingui/react/macro";
import { initLingui } from "@workspace/i18n/server";
import type { Metadata } from "next";

import { requestLocale } from "@/lib/i18n";

import { SandboxDemo } from "./demo";

// A developer gallery, not a product page: keep it out of search indexes.
export const metadata: Metadata = {
  robots: { follow: false, index: false },
};

export default async function Page() {
  // Pages render independently of layouts, so each sets up Lingui for RSC.
  initLingui(await requestLocale());

  return (
    <main className="mx-auto flex min-h-svh max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-medium text-lg">
          <Trans>Sandbox panel</Trans>
        </h1>
        <p className="text-muted-foreground text-sm">
          <Trans>
            The chat sandbox panel over a just-bash workspace that runs entirely
            in this browser tab: simulated bash, an in-memory filesystem, no
            server and no network. Reloading the page starts over.
          </Trans>
        </p>
      </header>
      <SandboxDemo />
    </main>
  );
}
