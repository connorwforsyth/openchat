import { Trans } from "@lingui/react/macro";
import { initLingui } from "@workspace/i18n/server";
import type { Metadata } from "next";

import { requestLocale } from "@/lib/i18n";

import { LibraryDemo } from "./demo";

// A developer gallery, not a product page: keep it out of search indexes.
export const metadata: Metadata = {
  robots: { follow: false, index: false },
};

export default async function Page() {
  // Pages render independently of layouts, so each sets up Lingui for RSC.
  initLingui(await requestLocale());

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-8 p-6">
      <header className="flex flex-col gap-1">
        <p className="font-medium text-muted-foreground text-xs">
          <Trans>Developer gallery</Trans>
        </p>
        <p className="text-muted-foreground text-sm">
          <Trans>
            The library and its builders over an in-memory API with fixtures.
            Edits, shares and publishes apply at once; switch on "Refuse the
            next save and share" to watch one roll back. The agent test chat
            echoes the draft instead of calling a model.
          </Trans>
        </p>
      </header>
      <LibraryDemo />
    </main>
  );
}
