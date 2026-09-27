import { Trans } from "@lingui/react/macro";
import { CircleAlertIcon } from "@workspace/icons";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";

// What signed-in pages show when the server can't run the app at all. Says
// what an operator needs to do, never why in terms of stack traces.

export const BadConfigNotice = () => (
  <main className="flex min-h-svh items-center justify-center p-6">
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>
          <Trans>This server isn't set up correctly</Trans>
        </EmptyTitle>
        <EmptyDescription>
          <Trans>
            The server's configuration file has problems. An administrator can
            find the details in the server log.
          </Trans>
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </main>
);
