import { Trans } from "@lingui/react/macro";
import { CircleAlertIcon } from "@workspace/icons";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";

import type { Unavailable } from "./session";

// What signed-in pages show when this server has no sign-in at all. Says
// what an operator needs to set, never why in terms of stack traces.

const Reason = ({ reason }: { readonly reason: Unavailable }) => {
  switch (reason) {
    case "no_database":
      return (
        <Trans>
          This server has no database yet, so there are no accounts to sign in
          to. An administrator needs to set DATABASE_URL.
        </Trans>
      );
    case "no_secret":
      return (
        <Trans>
          Sign-in is switched off until an administrator sets
          BETTER_AUTH_SECRET.
        </Trans>
      );
    case "bad_config":
      return (
        <Trans>
          The server's configuration file has problems. An administrator can
          find the details in the server log.
        </Trans>
      );
    default:
      return reason satisfies never;
  }
};

export const UnavailableNotice = ({
  reason,
}: {
  readonly reason: Unavailable;
}) => (
  <main className="flex min-h-svh items-center justify-center p-6">
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>
          <Trans>Settings aren't available</Trans>
        </EmptyTitle>
        <EmptyDescription>
          <Reason reason={reason} />
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </main>
);
