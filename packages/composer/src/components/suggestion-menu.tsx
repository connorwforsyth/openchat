"use client";

import { AgentIcon, FileTextIcon, UserIcon } from "@workspace/icons";
import { cn } from "@workspace/ui/lib/utils";
import { type MouseEvent, useCallback, useEffect, useRef } from "react";

import type { MentionCandidate, PromptOption } from "../schemas";

export type Suggestion =
  | { readonly kind: "mention"; readonly candidate: MentionCandidate }
  | { readonly kind: "prompt"; readonly prompt: PromptOption };

export const suggestionKey = (suggestion: Suggestion): string =>
  suggestion.kind === "prompt"
    ? `prompt:${suggestion.prompt.id}`
    : `${suggestion.candidate.kind}:${suggestion.candidate.id}`;

export const optionId = (listboxId: string, index: number) =>
  `${listboxId}-option-${index}`;

export interface SuggestionMenuProps {
  readonly activeIndex: number;
  readonly id: string;
  readonly items: readonly Suggestion[];
  readonly onChoose: (index: number) => void;
  readonly onHover: (index: number) => void;
  readonly title: string;
}

// Focus never leaves the textarea: it owns the keyboard (arrows, Enter,
// Escape) and points at the active option with aria-activedescendant, the
// ARIA pattern for autocomplete inside a text field. So options take pointer
// input only, and mousedown is cancelled to keep the caret where it was.
const keepFocus = (event: MouseEvent) => event.preventDefault();

function SuggestionIcon({ suggestion }: { readonly suggestion: Suggestion }) {
  if (suggestion.kind === "prompt") {
    return <FileTextIcon aria-hidden />;
  }
  return suggestion.candidate.kind === "agent" ? (
    <AgentIcon aria-hidden />
  ) : (
    <UserIcon aria-hidden />
  );
}

function SuggestionText({ suggestion }: { readonly suggestion: Suggestion }) {
  if (suggestion.kind === "prompt") {
    const { command } = suggestion.prompt.definition;
    return (
      <>
        <span className="truncate">{suggestion.prompt.name}</span>
        {command ? (
          <span className="ms-auto shrink-0 font-mono text-muted-foreground text-xs">
            /{command}
          </span>
        ) : null}
      </>
    );
  }
  return (
    <>
      <span className="truncate">{suggestion.candidate.label}</span>
      {suggestion.candidate.description ? (
        <span className="ms-auto truncate text-muted-foreground text-xs">
          {suggestion.candidate.description}
        </span>
      ) : null}
    </>
  );
}

interface SuggestionOptionProps {
  readonly active: boolean;
  readonly id: string;
  readonly index: number;
  readonly onChoose: (index: number) => void;
  readonly onHover: (index: number) => void;
  readonly suggestion: Suggestion;
}

function SuggestionOption({
  active,
  id,
  index,
  onChoose,
  onHover,
  suggestion,
}: SuggestionOptionProps) {
  const handleClick = useCallback(() => onChoose(index), [index, onChoose]);
  const handleMouseMove = useCallback(() => onHover(index), [index, onHover]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the textarea handles this listbox's keys (see keepFocus).
    <div
      aria-selected={active}
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-md px-1.5 py-1 text-sm [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        active && "bg-accent text-accent-foreground"
      )}
      id={id}
      onClick={handleClick}
      onMouseDown={keepFocus}
      onMouseMove={handleMouseMove}
      role="option"
      // Focusable in principle, as the role requires, but never tabbed to.
      tabIndex={-1}
    >
      <SuggestionIcon suggestion={suggestion} />
      <SuggestionText suggestion={suggestion} />
    </div>
  );
}

export function SuggestionMenu({
  activeIndex,
  id,
  items,
  onChoose,
  onHover,
  title,
}: SuggestionMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Arrowing past the visible options scrolls the next one into view.
  useEffect(() => {
    listRef.current
      ?.querySelector(`#${CSS.escape(optionId(id, activeIndex))}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, id]);

  const titleId = `${id}-title`;

  return (
    <div
      className="absolute inset-x-0 bottom-full z-50 mb-2 flex max-h-72 flex-col overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      data-slot="composer-suggestions"
    >
      <p
        className="px-1.5 py-1 font-medium text-muted-foreground text-xs"
        id={titleId}
      >
        {title}
      </p>
      <div
        aria-labelledby={titleId}
        className="overflow-y-auto"
        id={id}
        ref={listRef}
        role="listbox"
      >
        {items.map((suggestion, index) => (
          <SuggestionOption
            active={index === activeIndex}
            id={optionId(id, index)}
            index={index}
            key={suggestionKey(suggestion)}
            onChoose={onChoose}
            onHover={onHover}
            suggestion={suggestion}
          />
        ))}
      </div>
    </div>
  );
}
