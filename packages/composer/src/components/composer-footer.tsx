"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ModelOption } from "@workspace/contract/schemas/models";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import {
  ArrowUpIcon,
  FileTextIcon,
  GlobeIcon,
  NetworkIcon,
  StopIcon,
  ZapIcon,
} from "@workspace/icons";
import {
  InputGroupAddon,
  InputGroupButton,
} from "@workspace/ui/components/input-group";
import { useCallback, useRef } from "react";

import { useModelVariants } from "../hooks/use-model-variants";
import type {
  ComposerAppearance,
  ComposerChatMode,
  ComposerMcp,
} from "../props";
import type {
  AgentOption,
  FileCandidate,
  PromptOption,
  SkillOption,
} from "../schemas";
import type { ModelVariant } from "../variants";
import { ChatModeSwitch } from "./chat-mode-switch";
import { PlusMenu } from "./plus-menu";
import { STRIP_SEND_CLASS } from "./styles";
import { TargetPicker } from "./target-picker";
import { ThinkingControl } from "./thinking-control";

export interface ComposerFooterProps {
  readonly agents: readonly AgentOption[];
  /** A strip has Send alone (135). */
  readonly appearance?: ComposerAppearance;
  readonly attachDisabled: boolean;
  readonly busy: boolean;
  readonly canSubmit: boolean;
  readonly chatMode?: ComposerChatMode | undefined;
  readonly disabled: boolean;
  readonly files: readonly FileCandidate[];
  /** This chat's mcp (188), for the + menu and the "differs" chip. */
  readonly mcp?: ComposerMcp | undefined;
  readonly models: readonly ModelOption[];
  readonly onAddFile: ((file: FileCandidate) => void) | undefined;
  readonly onAddSkill?: ((skill: SkillOption) => void) | undefined;
  readonly onAttach: () => void;
  /** The + menu's "Image" (138); left out, it isn't offered. */
  readonly onMakeImage?: (() => void) | undefined;
  readonly onPlanChange?: ((on: boolean) => void) | undefined;
  readonly onStop: (() => void) | undefined;
  readonly onTargetChange: ((target: RunTarget) => void) | undefined;
  readonly onUsePrompt: ((prompt: PromptOption) => void) | undefined;
  readonly onVariantChange: ((variant: ModelVariant) => void) | undefined;
  readonly onWebSearchChange: ((on: boolean) => void) | undefined;
  readonly plan?: boolean;
  readonly prompts: readonly PromptOption[];
  readonly recentsKey: string | undefined;
  /** Skills the + menu offers (127), less those already picked. */
  readonly skills?: readonly SkillOption[];
  readonly target: RunTarget | undefined;
  readonly variant: ModelVariant | undefined;
  readonly webSearch: boolean;
}

/**
 * The composer's bottom row (after shadcn's chatbot template). At the
 * start: the + menu, and plan mode, web search and fast mode while they're on. At the
 * end: the model/agent picker, then its thinking level when it has one,
 * then Send (or Stop while a run is going) (105, 113). The chat context
 * lives in the chat header, not here (113). A strip has Send alone (135).
 */
export function ComposerFooter({
  agents,
  appearance = "default",
  attachDisabled,
  busy,
  canSubmit,
  chatMode,
  mcp,
  disabled,
  files,
  models,
  onAddFile,
  onAddSkill,
  onAttach,
  onMakeImage,
  onPlanChange,
  onStop,
  onTargetChange,
  onUsePrompt,
  onVariantChange,
  onWebSearchChange,
  plan = false,
  prompts,
  recentsKey,
  skills,
  target,
  variant,
  webSearch,
}: ComposerFooterProps) {
  const { t } = useLingui();
  const mcpLabel = mcp?.term.label ?? "";
  const plusRef = useRef<HTMLButtonElement>(null);
  const variants = useModelVariants({
    models,
    onTargetChange,
    onVariantChange,
    recentsKey,
    target,
    variant,
  });
  const { setFast } = variants;
  // A chip goes away as it's switched off; focus goes back to the + menu
  // it was switched on from.
  const turnOffWebSearch = useCallback(() => {
    onWebSearchChange?.(false);
    plusRef.current?.focus();
  }, [onWebSearchChange]);
  const turnOffPlan = useCallback(() => {
    onPlanChange?.(false);
    plusRef.current?.focus();
  }, [onPlanChange]);
  const resetMcp = useCallback(() => {
    mcp?.onReset();
    plusRef.current?.focus();
  }, [mcp]);
  const turnOffFast = useCallback(() => {
    setFast(false);
    plusRef.current?.focus();
  }, [setFast]);
  const picking = target !== undefined && onTargetChange !== undefined;
  if (appearance === "strip") {
    return (
      <div className={STRIP_SEND_CLASS}>
        <SendButton busy={busy} canSubmit={canSubmit} onStop={onStop} />
      </div>
    );
  }
  return (
    <InputGroupAddon
      align="block-end"
      className="justify-between gap-1 px-2 pb-2"
    >
      <div className="flex min-w-0 shrink-0 items-center gap-1">
        <PlusMenu
          attachDisabled={attachDisabled}
          disabled={disabled}
          fast={picking ? variants.fast : undefined}
          files={files}
          mcp={mcp}
          onAddFile={onAddFile}
          onAddSkill={onAddSkill}
          onAttach={onAttach}
          onFastChange={setFast}
          onMakeImage={onMakeImage}
          onPlanChange={onPlanChange}
          onUsePrompt={onUsePrompt}
          onWebSearchChange={onWebSearchChange}
          plan={plan}
          prompts={prompts}
          skills={skills}
          triggerRef={plusRef}
          webSearch={webSearch}
        />
        {chatMode ? (
          <ChatModeSwitch
            disabled={disabled}
            mode={chatMode.mode}
            onModeChange={chatMode.onChange}
          />
        ) : null}
        {plan && onPlanChange ? (
          <InputGroupButton
            aria-label={t`Plan mode is on. Turn it off`}
            aria-pressed
            className="rounded-full text-foreground"
            disabled={disabled}
            onClick={turnOffPlan}
            size="sm"
            type="button"
            variant="ghost"
          >
            <FileTextIcon aria-hidden />
            <span className="max-sm:sr-only">
              <Trans>Plan</Trans>
            </span>
          </InputGroupButton>
        ) : null}
        {webSearch && onWebSearchChange ? (
          <InputGroupButton
            aria-label={t`Web search is on. Turn it off`}
            aria-pressed
            className="rounded-full text-foreground"
            disabled={disabled}
            onClick={turnOffWebSearch}
            size="sm"
            type="button"
            variant="ghost"
          >
            <GlobeIcon aria-hidden />
            <span className="max-sm:sr-only">
              <Trans>Search</Trans>
            </span>
          </InputGroupButton>
        ) : null}
        {mcp?.customized ? (
          <InputGroupButton
            aria-label={t`${mcpLabel} differ from your defaults in this chat. Reset them`}
            className="rounded-full text-foreground"
            disabled={disabled}
            onClick={resetMcp}
            size="sm"
            title={t`Reset to my defaults`}
            type="button"
            variant="ghost"
          >
            <NetworkIcon aria-hidden />
            <span className="max-sm:sr-only">
              <Trans>Custom tools</Trans>
            </span>
          </InputGroupButton>
        ) : null}
        {picking && variants.fast?.on ? (
          <InputGroupButton
            aria-label={t`Fast mode is on. Turn it off`}
            aria-pressed
            className="rounded-full text-foreground"
            disabled={disabled}
            onClick={turnOffFast}
            size="sm"
            type="button"
            variant="ghost"
          >
            <ZapIcon aria-hidden />
            <span className="max-sm:sr-only">
              <Trans>Fast</Trans>
            </span>
          </InputGroupButton>
        ) : null}
      </div>
      <div className="flex min-w-0 shrink items-center justify-end gap-1">
        {picking ? (
          <TargetPicker
            agents={agents}
            disabled={disabled}
            models={models}
            onChange={variants.pickTarget}
            recentsKey={recentsKey}
            value={target}
          />
        ) : null}
        {picking && variants.levels && variants.level ? (
          <ThinkingControl
            disabled={disabled}
            levels={variants.levels}
            onChange={variants.setLevel}
            value={variants.level}
          />
        ) : null}
        <SendButton busy={busy} canSubmit={canSubmit} onStop={onStop} />
      </div>
    </InputGroupAddon>
  );
}

/** Send, or Stop while a run is going: the footer's last button, and a strip's only one. */
function SendButton({
  busy,
  canSubmit,
  onStop,
}: Pick<ComposerFooterProps, "busy" | "canSubmit" | "onStop">) {
  const { t } = useLingui();
  return busy ? (
    // A plain button, not submit: Enter in the textarea must never stop a run.
    <InputGroupButton
      aria-label={t`Stop`}
      className="rounded-full"
      disabled={onStop === undefined}
      onClick={onStop}
      size="icon-sm"
      type="button"
      variant="default"
    >
      <StopIcon aria-hidden />
    </InputGroupButton>
  ) : (
    <InputGroupButton
      aria-label={t`Send`}
      className="rounded-full"
      disabled={!canSubmit}
      size="icon-sm"
      type="submit"
      variant="default"
    >
      <ArrowUpIcon aria-hidden />
    </InputGroupButton>
  );
}
