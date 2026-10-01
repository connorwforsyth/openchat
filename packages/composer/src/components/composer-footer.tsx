"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ModelOption } from "@workspace/contract/schemas/models";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import { ArrowUpIcon, GlobeIcon } from "@workspace/icons";
import {
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
} from "@workspace/ui/components/ai-elements/prompt-input";
import { useCallback, useRef } from "react";

import type {
  AgentOption,
  ContextOption,
  FileCandidate,
  PromptOption,
} from "../schemas";
import { ContextChip } from "./context-chip";
import { PlusMenu } from "./plus-menu";
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
  readonly files: readonly FileCandidate[];
  readonly models: readonly ModelOption[];
  readonly onAddFile: ((file: FileCandidate) => void) | undefined;
  readonly onAttach: () => void;
  readonly onContextChange: ((context: ChatContext) => void) | undefined;
  readonly onStop: (() => void) | undefined;
  readonly onTargetChange: ((target: RunTarget) => void) | undefined;
  readonly onUsePrompt: ((prompt: PromptOption) => void) | undefined;
  readonly onWebSearchChange: ((on: boolean) => void) | undefined;
  readonly prompts: readonly PromptOption[];
  readonly recentsKey: string | undefined;
  readonly target: RunTarget | undefined;
  readonly webSearch: boolean;
}

/**
 * The composer's bottom row (after shadcn's chatbot template): the + menu,
 * web search while it's on, and the model/agent picker at the start; the
 * chat context (when there's one to show) and Send, or Stop while a run is
 * going, at the end.
 */
export function ComposerFooter({
  agents,
  attachDisabled,
  busy,
  canSubmit,
  context,
  contextLocked,
  contexts,
  disabled,
  files,
  models,
  onAddFile,
  onAttach,
  onContextChange,
  onStop,
  onTargetChange,
  onUsePrompt,
  onWebSearchChange,
  prompts,
  recentsKey,
  target,
  webSearch,
}: ComposerFooterProps) {
  const { t } = useLingui();
  const plusRef = useRef<HTMLButtonElement>(null);
  // The chip goes away as it's switched off; focus goes back to the + menu
  // it was switched on from.
  const turnOffWebSearch = useCallback(() => {
    onWebSearchChange?.(false);
    plusRef.current?.focus();
  }, [onWebSearchChange]);
  return (
    <PromptInputFooter className="px-2 pb-2">
      <PromptInputTools className="min-w-0 flex-wrap">
        <PlusMenu
          attachDisabled={attachDisabled}
          disabled={disabled}
          files={files}
          onAddFile={onAddFile}
          onAttach={onAttach}
          onUsePrompt={onUsePrompt}
          onWebSearchChange={onWebSearchChange}
          prompts={prompts}
          triggerRef={plusRef}
          webSearch={webSearch}
        />
        {webSearch && onWebSearchChange ? (
          <PromptInputButton
            aria-label={t`Web search is on. Turn it off`}
            aria-pressed
            className="rounded-full text-foreground"
            disabled={disabled}
            onClick={turnOffWebSearch}
            size="sm"
          >
            <GlobeIcon aria-hidden />
            <span className="max-sm:sr-only">
              <Trans>Search</Trans>
            </span>
          </PromptInputButton>
        ) : null}
        {target && onTargetChange ? (
          <TargetPicker
            agents={agents}
            disabled={disabled}
            models={models}
            onChange={onTargetChange}
            recentsKey={recentsKey}
            value={target}
          />
        ) : null}
      </PromptInputTools>
      <PromptInputTools className="min-w-0 justify-end">
        {context ? (
          <ContextChip
            disabled={disabled}
            locked={contextLocked}
            onChange={onContextChange}
            options={contexts}
            value={context}
          />
        ) : null}
        {busy ? (
          // A plain button, not submit: Enter in the textarea must never stop a run.
          <PromptInputSubmit
            aria-label={t`Stop`}
            className="rounded-full"
            disabled={onStop === undefined}
            onClick={onStop}
            status="streaming"
            type="button"
          />
        ) : (
          <PromptInputSubmit
            aria-label={t`Send`}
            className="rounded-full"
            disabled={!canSubmit}
          >
            <ArrowUpIcon aria-hidden className="size-4" />
          </PromptInputSubmit>
        )}
      </PromptInputTools>
    </PromptInputFooter>
  );
}
