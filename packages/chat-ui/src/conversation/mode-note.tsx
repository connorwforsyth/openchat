"use client";

import { Trans } from "@lingui/react/macro";
import type { ChatMode } from "@workspace/contract/schemas/runs";
import { CodeIcon, MessageSquareIcon } from "@workspace/icons";

// Under a message: the mode it was sent in, Chat or Code. A message from
// before the switch, or in a Dot's chat, has none and shows nothing.

export function ModeNote({ mode }: { readonly mode: ChatMode }) {
  return (
    <p
      className="flex items-center gap-1.5 text-muted-foreground text-xs"
      data-mode={mode}
      data-slot="message-mode"
    >
      {mode === "code" ? (
        <>
          <CodeIcon aria-hidden className="size-3.5" />
          <Trans>Sent in Code mode</Trans>
        </>
      ) : (
        <>
          <MessageSquareIcon aria-hidden className="size-3.5" />
          <Trans>Sent in Chat mode</Trans>
        </>
      )}
    </p>
  );
}
