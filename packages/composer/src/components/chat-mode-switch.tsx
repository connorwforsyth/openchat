"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  type ChatMode,
  chatModeSchema,
} from "@workspace/contract/schemas/runs";
import { CodeIcon, MessageSquareIcon } from "@workspace/icons";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import { useCallback } from "react";

// Chat or Code for the chat (the server holds a Chat run to artifacts and
// files; Code adds the sandbox). It applies from the next message. Keyboard
// UI, so no motion.

export interface ChatModeSwitchProps {
  readonly disabled?: boolean;
  readonly mode: ChatMode;
  readonly onModeChange: (mode: ChatMode) => void;
}

export function ChatModeSwitch({
  disabled,
  mode,
  onModeChange,
}: ChatModeSwitchProps) {
  const { t } = useLingui();
  const onValueChange = useCallback(
    (values: readonly unknown[]) => {
      const next = chatModeSchema.safeParse(values[0]);
      if (next.success) {
        onModeChange(next.data);
      }
    },
    [onModeChange]
  );
  return (
    <ToggleGroup
      aria-label={t`Chat or Code mode`}
      data-slot="chat-mode-switch"
      disabled={disabled}
      onValueChange={onValueChange}
      size="sm"
      spacing={0}
      value={[mode]}
      variant="outline"
    >
      <ToggleGroupItem
        className="rounded-full"
        title={t`Chat: artifacts and files, nothing runs`}
        value="chat"
      >
        <MessageSquareIcon aria-hidden />
        <span className="max-sm:sr-only">
          <Trans>Chat</Trans>
        </span>
      </ToggleGroupItem>
      <ToggleGroupItem
        className="rounded-full"
        title={t`Code: runs commands, installs and dev servers in the sandbox`}
        value="code"
      >
        <CodeIcon aria-hidden />
        <span className="max-sm:sr-only">
          <Trans>Code</Trans>
        </span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
