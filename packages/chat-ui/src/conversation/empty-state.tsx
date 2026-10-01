"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@workspace/ui/components/button";
import { useCallback, useMemo } from "react";

interface Suggestion {
  readonly label: string;
  readonly prompt: string;
}

function SuggestionButton({
  onPick,
  suggestion,
}: {
  readonly onPick: (prompt: string) => void;
  readonly suggestion: Suggestion;
}) {
  const pick = useCallback(
    () => onPick(suggestion.prompt),
    [onPick, suggestion.prompt]
  );
  return (
    <Button className="rounded-full" onClick={pick} variant="outline">
      {suggestion.label}
    </Button>
  );
}

// A new chat before its first message (after shadcn's chatbot template):
// one question above the centred composer and a few prompts to start from
// under it (098). The chat screen places the two around the composer, so
// they move away with it rather than the composer moving between them.

/** The question over a new chat's composer. */
export function EmptyGreeting() {
  return (
    <h2 className="text-balance text-center font-medium text-2xl tracking-tight">
      <Trans>What can I help with?</Trans>
    </h2>
  );
}

export interface EmptySuggestionsProps {
  /** Sends a suggested prompt as the first message. */
  readonly onSuggestion: (prompt: string) => void;
}

/**
 * Prompts to start from, under a new chat's composer. Each suggestion sends
 * its full prompt; the button shows the short label.
 */
export function EmptySuggestions({ onSuggestion }: EmptySuggestionsProps) {
  const { t } = useLingui();
  const suggestions = useMemo<readonly Suggestion[]>(
    () => [
      {
        label: t`Explain a concept`,
        prompt: t`Explain how HTTPS keeps a connection private, in plain language with one short example.`,
      },
      {
        label: t`Write some code`,
        prompt: t`Write a small TypeScript function that groups a list of dates by ISO week, with a couple of tests.`,
      },
      {
        label: t`Draft a document`,
        prompt: t`Draft a one-page project brief as a Markdown file: goal, scope, risks and next steps.`,
      },
      {
        label: t`Plan something`,
        prompt: t`Help me plan a team offsite. Ask me a few questions first, then suggest an agenda.`,
      },
    ],
    [t]
  );

  return (
    <ul
      aria-label={t`Suggestions`}
      className="flex flex-wrap justify-center gap-2"
    >
      {suggestions.map((suggestion) => (
        <li key={suggestion.label}>
          <SuggestionButton onPick={onSuggestion} suggestion={suggestion} />
        </li>
      ))}
    </ul>
  );
}
