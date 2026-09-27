import { Trans } from "@lingui/react/macro";
import { initLingui } from "@workspace/i18n/server";
import { ShortcutsEditor } from "@workspace/shortcuts/react/shortcuts-editor";
import { requestLocale } from "@/lib/i18n";
import { PageHeader } from "../../_shared/section-nav";

export default async function Page() {
  initLingui(await requestLocale());
  return (
    <>
      <PageHeader
        description={
          <Trans>
            Record your own keys for any shortcut. Your changes are saved in
            this browser.
          </Trans>
        }
        title={<Trans>Keyboard shortcuts</Trans>}
      />
      <ShortcutsEditor />
    </>
  );
}
