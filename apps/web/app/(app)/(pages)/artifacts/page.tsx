import { initLingui } from "@workspace/i18n/server";

import { requestLocale } from "@/lib/i18n";

import { ArtifactsScreen } from "./artifacts-screen";

export default async function Page() {
  // Pages render independently of layouts, so each sets up Lingui for RSC.
  initLingui(await requestLocale());
  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col p-4 md:p-6">
      <ArtifactsScreen />
    </div>
  );
}
