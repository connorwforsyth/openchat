"use client";

import { useLingui } from "@lingui/react/macro";
import { Button } from "@workspace/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";
import { useCallback, useMemo, useState } from "react";

// A schedule's label: a short grid of emoji in a popover, plus the one it
// already has when that isn't among them.

interface Choice {
  readonly emoji: string;
  readonly name: string;
}

const useChoices = (): readonly Choice[] => {
  const { t } = useLingui();
  return useMemo(
    () => [
      { emoji: "⏰", name: t`Alarm clock` },
      { emoji: "☀️", name: t`Sun` },
      { emoji: "🔔", name: t`Bell` },
      { emoji: "🗓️", name: t`Calendar` },
      { emoji: "📰", name: t`Newspaper` },
      { emoji: "📈", name: t`Chart` },
      { emoji: "📬", name: t`Mailbox` },
      { emoji: "💡", name: t`Light bulb` },
      { emoji: "✅", name: t`Check mark` },
      { emoji: "🧠", name: t`Brain` },
      { emoji: "🌙", name: t`Moon` },
      { emoji: "🔍", name: t`Magnifying glass` },
    ],
    [t]
  );
};

export function EmojiPicker({
  onChange,
  value,
}: {
  readonly onChange: (emoji: string) => void;
  readonly value: string;
}) {
  const { t } = useLingui();
  const known = useChoices();
  const [open, setOpen] = useState(false);
  const choices = known.some((choice) => choice.emoji === value)
    ? known
    : [{ emoji: value, name: value }, ...known];
  const pick = useCallback(
    (emoji: string) => {
      onChange(emoji);
      setOpen(false);
    },
    [onChange]
  );
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label={t`Change emoji, now ${value}`}
            className="text-base"
            size="icon"
            type="button"
            variant="outline"
          />
        }
      >
        {value}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto">
        <div className="grid grid-cols-6 gap-1">
          {choices.map((choice) => (
            <EmojiChoice
              choice={choice}
              key={choice.emoji}
              onPick={pick}
              picked={choice.emoji === value}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EmojiChoice({
  choice,
  onPick,
  picked,
}: {
  readonly choice: Choice;
  readonly onPick: (emoji: string) => void;
  readonly picked: boolean;
}) {
  const pick = useCallback(() => onPick(choice.emoji), [choice, onPick]);
  return (
    <Button
      aria-label={choice.name}
      aria-pressed={picked}
      className={cn("text-base", picked && "bg-muted")}
      onClick={pick}
      size="icon"
      title={choice.name}
      type="button"
      variant="ghost"
    >
      {choice.emoji}
    </Button>
  );
}
