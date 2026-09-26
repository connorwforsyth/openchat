import { Trans } from "@lingui/react/macro";
import { initLingui } from "@workspace/i18n/server";
import type { Metadata } from "next";

import { requestLocale } from "@/lib/i18n";

import { ComposerDemo } from "./demo";
import "./composer.css";

// A developer gallery, not a product page: keep it out of search indexes.
export const metadata: Metadata = {
  robots: { follow: false, index: false },
};

export default async function Page() {
  // Pages render independently of layouts, so each sets up Lingui for RSC.
  initLingui(await requestLocale());

  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col gap-8 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-medium text-lg">
          <Trans>Composer</Trans>
        </h1>
        <p className="text-muted-foreground text-sm">
          <Trans>
            The prompt composer with contract fixtures. Type / for a prompt
            template or @ to mention someone; sending fakes a short run you can
            stop. Nothing here calls a model.
          </Trans>
        </p>
      </header>
      <ComposerDemo />
    </main>
  );
}
