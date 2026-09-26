"use client";

import { useLingui } from "@lingui/react/macro";
import type { ModelOption } from "@workspace/contract/schemas/models";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import { AttachIcon } from "@workspace/icons";
import {
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
} from "@workspace/ui/components/ai-elements/prompt-input";

import type { AgentOption, ContextOption } from "../schemas";
import { ContextChip } from "./context-chip";
import { TargetPicker } from "./target-picker";

export interface ComposerFooterProps {
  readonly agents: readonly AgentOption[];
  readonly attachDisabled: boolean;
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly context: ChatContext | undefined;
  readonly contextLocked: boolean | undefined;
  readonly contexts: readonly ContextOption[];
  readonly disabled: boolean;
  readonly models: readonly ModelOption[];
  readonly onAttach: () => void;
  readonly onContextChange: ((context: ChatContext) => void) | undefined;
  readonly onStop: (() => void) | undefined;
  readonly onTargetChange: ((target: RunTarget) => void) | undefined;
  readonly target: RunTarget | undefined;
}

/** Attach, the pickers, and send (or stop while a run is going). */
export function ComposerFooter({
  agents,
  attachDisabled,
  busy,
  canSubmit,
  context,
  contextLocked,
  contexts,
  disabled,
  models,
  onAttach,
  onContextChange,
  onStop,
  onTargetChange,
  target,
}: ComposerFooterProps) {
  const { t } = useLingui();
  return (
    <PromptInputFooter>
      <PromptInputTools className="min-w-0 flex-wrap">
        <PromptInputButton
          aria-label={t`Attach files`}
          disabled={attachDisabled}
          onClick={onAttach}
        >
          <AttachIcon aria-hidden className="size-4" />
        </PromptInputButton>
        {target && onTargetChange ? (
          <TargetPicker
            agents={agents}
            disabled={disabled}
            models={models}
            onChange={onTargetChange}
            value={target}
          />
        ) : null}
        {context ? (
          <ContextChip
            disabled={disabled}
            locked={contextLocked}
            onChange={onContextChange}
            options={contexts}
            value={context}
          />
        ) : null}
      </PromptInputTools>
      {busy ? (
        // A plain button, not submit: Enter in the textarea must never stop a run.
        <PromptInputSubmit
          aria-label={t`Stop`}
          disabled={onStop === undefined}
          onClick={onStop}
          status="streaming"
          type="button"
        />
      ) : (
        <PromptInputSubmit aria-label={t`Send`} disabled={!canSubmit} />
      )}
    </PromptInputFooter>
  );
}
