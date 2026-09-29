"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { useCallback, useMemo } from "react";

export interface EmptyStateProps {
  /** Sends a suggested prompt as the first message; no suggestions without it. */
  readonly onSuggestion?: (prompt: string) => void;
}

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

/**
 * A new chat before its first message (after shadcn's chatbot template):
 * one question and a few prompts to start from. Each suggestion sends its
 * full prompt; the button shows the short label.
 */
export function EmptyState({ onSuggestion }: EmptyStateProps) {
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
    <div className="flex flex-1 items-center justify-center p-6">
      <Empty className="border-0 p-0">
        <EmptyHeader>
          <EmptyTitle>
            <h2 className="text-balance font-medium text-2xl tracking-tight">
              <Trans>What can I help with?</Trans>
            </h2>
          </EmptyTitle>
        </EmptyHeader>
        {onSuggestion ? (
          <EmptyContent className="max-w-lg">
            <ul
              aria-label={t`Suggestions`}
              className="flex flex-wrap justify-center gap-2"
            >
              {suggestions.map((suggestion) => (
                <li key={suggestion.label}>
                  <SuggestionButton
                    onPick={onSuggestion}
                    suggestion={suggestion}
                  />
                </li>
              ))}
            </ul>
          </EmptyContent>
        ) : null}
      </Empty>
    </div>
  );
}
