"use client";

import { useLingui } from "@lingui/react/macro";
import { describeRecurrence } from "@workspace/ai/schedules/describe";
import type {
  Schedule,
  ScheduleRecurrence,
  ScheduleRunOutcome,
} from "@workspace/contract/schemas/schedules";
import { formatRelativeTime } from "@workspace/i18n/format";
import { useCallback } from "react";

// Schedules in words (183), through Lingui: "Weekdays at 9:00 AM",
// "Every 2 hours", "Once, Tue 3 Nov at 10:00". Pure meaning comes from
// `describeRecurrence`; this only says it.

const timeOf = (locale: string, hour: number, minute: number): string =>
  new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2000, 0, 1, hour, minute));

const weekdaysOf = (locale: string, days: readonly number[]): string =>
  new Intl.ListFormat(locale, { style: "short", type: "conjunction" }).format(
    // 2000-01-02 was a Sunday, day 0.
    days.map((day) =>
      new Intl.DateTimeFormat(locale, { weekday: "long" }).format(
        new Date(2000, 0, 2 + day)
      )
    )
  );

const ordinalDay = (locale: string, day: number): string =>
  new Intl.DateTimeFormat(locale, { day: "numeric" }).format(
    new Date(2000, 0, day)
  );

/** A moment in the schedule's zone, like "Tue 3 Nov, 10:00". */
export const formatAt = (
  locale: string,
  iso: string,
  timeZone?: string
): string => {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      timeZone,
      weekday: "short",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString(locale);
  }
};

/** Says a recurrence: "Weekdays at 9:00 AM". */
export const useRecurrenceText = () => {
  const { i18n, t } = useLingui();
  return useCallback(
    (recurrence: ScheduleRecurrence): string => {
      const meaning = describeRecurrence(recurrence);
      const { locale } = i18n;
      switch (meaning.type) {
        case "once": {
          const at = formatAt(locale, meaning.at, recurrence.timezone);
          return t`Once, ${at}`;
        }
        case "interval": {
          const { minutes } = meaning;
          if (minutes % 60 === 0) {
            const hours = minutes / 60;
            return hours === 1 ? t`Every hour` : t`Every ${hours} hours`;
          }
          return t`Every ${minutes} minutes`;
        }
        case "daily": {
          const time = timeOf(locale, meaning.time.hour, meaning.time.minute);
          const { every } = meaning;
          return every === 1
            ? t`Every day at ${time}`
            : t`Every ${every} days at ${time}`;
        }
        case "weekdays": {
          const time = timeOf(locale, meaning.time.hour, meaning.time.minute);
          return t`Weekdays at ${time}`;
        }
        case "weekly": {
          const time = timeOf(locale, meaning.time.hour, meaning.time.minute);
          const days = weekdaysOf(locale, meaning.days);
          const { every } = meaning;
          return every === 1
            ? t`Every ${days} at ${time}`
            : t`Every ${every} weeks on ${days} at ${time}`;
        }
        case "monthly": {
          const time = timeOf(locale, meaning.time.hour, meaning.time.minute);
          const day = ordinalDay(locale, meaning.day);
          return t`Monthly on day ${day} at ${time}`;
        }
        case "yearly": {
          const time = timeOf(locale, meaning.time.hour, meaning.time.minute);
          const date = new Intl.DateTimeFormat(locale, {
            day: "numeric",
            month: "long",
          }).format(new Date(2000, meaning.month - 1, meaning.day));
          return t`Every year on ${date} at ${time}`;
        }
        case "custom": {
          const { rule } = meaning;
          return t`Custom (${rule})`;
        }
        default:
          return meaning satisfies never;
      }
    },
    [i18n, t]
  );
};

/** "in 3 hours" (or "due now"), or `null` when nothing is coming. */
export const useRelativeText = () => {
  const { i18n, t } = useLingui();
  return useCallback(
    (iso: string | null): string | null => {
      if (!iso) {
        return null;
      }
      return Math.abs(new Date(iso).getTime() - Date.now()) < 30_000
        ? t`now`
        : formatRelativeTime(iso, i18n.locale);
    },
    [i18n.locale, t]
  );
};

/** "Last ran 2 hours ago · Next in 3 hours", or why it isn't running. */
export const useTimingText = () => {
  const { t } = useLingui();
  const relative = useRelativeText();
  return useCallback(
    (schedule: Schedule): string => {
      const last = relative(schedule.lastRunAt);
      const next = relative(schedule.nextRunNominalAt);
      let tail: string;
      switch (schedule.status) {
        case "completed":
          tail = t`Completed`;
          break;
        case "paused":
          switch (schedule.pausedReason) {
            case "failures":
              tail = t`Paused after 3 failed runs`;
              break;
            case "target_archived":
              tail = t`Paused: its chat is archived`;
              break;
            default:
              tail = t`Paused`;
          }
          break;
        default:
          tail = next ? t`Next ${next}` : t`Nothing scheduled`;
      }
      return last ? t`Last ran ${last} · ${tail}` : t`No runs yet · ${tail}`;
    },
    [relative, t]
  );
};

/** A run's outcome in a word or two. */
export const useOutcomeText = () => {
  const { t } = useLingui();
  return useCallback(
    (outcome: ScheduleRunOutcome | null): string => {
      switch (outcome) {
        case "update":
          return t`Update`;
        case "no_update":
          return t`No update`;
        case "needs_attention":
          return t`Needs attention`;
        case "failed":
          return t`Failed`;
        case "skipped":
          return t`Skipped`;
        case null:
          return t`Running`;
        default:
          return outcome satisfies never;
      }
    },
    [t]
  );
};
