"use client";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { UserSummary } from "@workspace/contract/schemas/tenancy";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";

import { initialsOf } from "../model/people";

// Who else has the chat open, in the header, and who's writing, over the
// composer (D25). Both come from `useLiveConversation`.

const MAX_SHOWN = 3;

/** Everyone else with the chat open, as avatars; nothing when it's only you. */
export function PresentPeople({
  people,
}: {
  readonly people: readonly UserSummary[];
}) {
  const { t } = useLingui();
  if (people.length === 0) {
    return null;
  }
  const shown = people.slice(0, MAX_SHOWN);
  const more = people.length - shown.length;
  const names = people.map((person) => person.name).join(", ");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            aria-label={t`Here now: ${names}`}
            className="flex items-center"
            data-testid="present-people"
            role="img"
          />
        }
      >
        <AvatarGroup className="-space-x-1.5">
          {shown.map((person) => (
            <Avatar
              className="size-6 ring-2 ring-primary/60"
              key={person.id}
              size="sm"
            >
              {person.image ? <AvatarImage alt="" src={person.image} /> : null}
              <AvatarFallback>{initialsOf(person.name)}</AvatarFallback>
            </Avatar>
          ))}
          {more > 0 ? (
            <AvatarGroupCount className="size-6 text-[0.625rem]">
              +{more}
            </AvatarGroupCount>
          ) : null}
        </AvatarGroup>
      </TooltipTrigger>
      <TooltipContent>
        <Trans>Here now: {names}</Trans>
      </TooltipContent>
    </Tooltip>
  );
}

function TypingText({ people }: { readonly people: readonly UserSummary[] }) {
  const [first, second] = people;
  if (!first) {
    return null;
  }
  if (people.length === 1) {
    return <Trans>{first.name} is typing…</Trans>;
  }
  if (people.length === 2 && second) {
    return (
      <Trans>
        {first.name} and {second.name} are typing…
      </Trans>
    );
  }
  return <Plural other="# people are typing…" value={people.length} />;
}

/**
 * "Maya is typing…" over the composer while anyone else writes. Its line is
 * kept while others have the chat open, so the messages don't jump.
 */
export function TypingNote({
  people,
  shared,
}: {
  readonly people: readonly UserSummary[];
  readonly shared: readonly UserSummary[];
}) {
  if (shared.length === 0) {
    return null;
  }
  return (
    <p
      aria-live="polite"
      className="mx-auto h-5 w-full max-w-3xl px-4 text-muted-foreground text-xs"
      data-testid="typing-note"
    >
      <TypingText people={people} />
    </p>
  );
}
