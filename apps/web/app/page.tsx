import { Trans } from "@lingui/react/macro";
import { initLingui } from "@workspace/i18n/server";
import { SendIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";

import { requestLocale } from "@/lib/i18n";

export default async function Page() {
  // Pages render independently of layouts, so each sets up Lingui for RSC.
  initLingui(await requestLocale());

  return (
    <div className="flex min-h-svh p-6">
      <div className="flex min-w-0 max-w-md flex-col gap-4 text-sm leading-loose">
        <div>
          <h1 className="font-medium">
            <Trans>Project ready!</Trans>
          </h1>
          <p>
            <Trans>You may now add components and start building.</Trans>
          </p>
          <p>
            <Trans>We've already added the button component for you.</Trans>
          </p>
          <Button className="mt-2">
            <SendIcon data-icon="inline-start" />
            <Trans>Button</Trans>
          </Button>
        </div>
        <div className="font-mono text-muted-foreground text-xs">
          <Trans>
            (Press <kbd>d</kbd> to toggle dark mode)
          </Trans>
        </div>
      </div>
    </div>
  );
}
