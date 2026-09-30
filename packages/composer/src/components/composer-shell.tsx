"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  InputGroup,
  InputGroupTextarea,
} from "@workspace/ui/components/input-group";
import { cn } from "@workspace/ui/lib/utils";
import { type FormEvent, type SyntheticEvent, useCallback } from "react";

import type { ComposerHandoff, ComposerProps } from "../props";
import { ComposerFooter } from "./composer-footer";
import { FRAME_CLASS, SHELL_INPUT_CLASS } from "./styles";

export interface ComposerShellProps extends ComposerProps {
  /** The editor chunk failed to load; say so instead of waiting forever. */
  readonly failed?: boolean;
  /** Called as the user types or moves focus, so the editor can pick up from here. */
  readonly onHandoff?: (handoff: ComposerHandoff) => void;
}

const NONE: readonly never[] = [];
const ignoreSubmit = (event: FormEvent) => event.preventDefault();
const noop = () => undefined;

/**
 * The composer before its editor has loaded: the same frame, footer and
 * pickers, with a plain textarea where the editor will go. It carries no
 * editor code, renders on the server, and takes typing straight away; the
 * loader hands what was typed (and focus) to the editor when it arrives.
 */
export function ComposerShell({
  agents = NONE,
  className,
  context,
  contextLocked,
  contexts = NONE,
  disabled = false,
  failed = false,
  models = NONE,
  onContextChange,
  onHandoff,
  onTargetChange,
  onWebSearchChange,
  placeholder,
  status = "ready",
  target,
  webSearch = false,
}: ComposerShellProps) {
  const { t } = useLingui();

  const report = useCallback(
    (event: SyntheticEvent<HTMLTextAreaElement>) => {
      const textarea = event.currentTarget;
      onHandoff?.({
        caret: textarea.selectionStart,
        focused: textarea.ownerDocument.activeElement === textarea,
        text: textarea.value,
      });
    },
    [onHandoff]
  );

  return (
    <form
      className={cn("relative w-full", className)}
      data-shell=""
      data-slot="composer"
      onSubmit={ignoreSubmit}
    >
      <InputGroup className={FRAME_CLASS}>
        <InputGroupTextarea
          aria-label={t`Message`}
          className={cn(SHELL_INPUT_CLASS, disabled && "opacity-50")}
          onBlur={report}
          onFocus={report}
          onInput={report}
          onSelect={report}
          placeholder={placeholder ?? t`Ask anything`}
          // readOnly rather than disabled: a disabled control would restyle
          // the whole frame, and the editor doesn't.
          readOnly={disabled}
        />
        <ComposerFooter
          agents={agents}
          attachDisabled={disabled}
          busy={status === "submitted" || status === "streaming"}
          canSubmit={false}
          context={context}
          contextLocked={contextLocked}
          contexts={contexts}
          disabled={disabled}
          files={NONE}
          models={models}
          onAddFile={undefined}
          onAttach={noop}
          onContextChange={onContextChange}
          onStop={undefined}
          onTargetChange={onTargetChange}
          onUsePrompt={undefined}
          onWebSearchChange={onWebSearchChange}
          prompts={NONE}
          target={target}
          webSearch={webSearch}
        />
      </InputGroup>
      {failed ? (
        <p className="mt-1.5 text-destructive text-xs" role="alert">
          <Trans>The editor didn't load. Reload the page to try again.</Trans>
        </p>
      ) : null}
    </form>
  );
}
