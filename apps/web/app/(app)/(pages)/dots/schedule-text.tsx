"use client";

import { useLingui } from "@lingui/react/macro";
import type { Dot, DotSchedule } from "@workspace/contract/schemas/dots";
import { formatRelativeTime } from "@workspace/i18n/format";
import { useCallback } from "react";

import { describeCron } from "./schedule";

// Schedules in words (172), through Lingui: "Every day at 8:00 AM",
// "Weekdays at 9:00 AM", or the cron itself when it's something else.

const timeOf = (locale: string, hour: number, minute: number): string =>
  new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2000, 0, 1, hour, minute));

const weekdayOf = (locale: string, day: number): string =>
  // 2000-01-02 was a Sunday, cron's day 0.
  new Intl.DateTimeFormat(locale, { weekday: "long" }).format(
    new Date(2000, 0, 2 + day)
  );

/** Says a cron expression; the zone is added when it isn't the browser's. */
export const useScheduleText = () => {
  const { i18n, t } = useLingui();
  return useCallback(
    (cron: string): string => {
      const meaning = describeCron(cron);
      switch (meaning.type) {
        case "every-minute":
          return t`Every minute`;
        case "every-n-minutes": {
          const { minutes } = meaning;
          return t`Every ${minutes} minutes`;
        }
        case "hourly": {
          const { minute } = meaning;
          return minute === 0 ? t`Every hour` : t`Every hour at ${minute} past`;
        }
        case "daily": {
          const time = timeOf(i18n.locale, meaning.hour, meaning.minute);
          return t`Every day at ${time}`;
        }
        case "weekdays": {
          const time = timeOf(i18n.locale, meaning.hour, meaning.minute);
          return t`Weekdays at ${time}`;
        }
        case "weekly": {
          const time = timeOf(i18n.locale, meaning.hour, meaning.minute);
          const day = weekdayOf(i18n.locale, meaning.day);
          return t`Every ${day} at ${time}`;
        }
        case "custom": {
          const { cron: expression } = meaning;
          return t`Custom (${expression})`;
        }
        default:
          return meaning satisfies never;
      }
    },
    [i18n.locale, t]
  );
};

/** "in 3 minutes" for the next run, or `null` when nothing is scheduled. */
export const useNextRunText = () => {
  const { i18n, t } = useLingui();
  return useCallback(
    (iso: string | null): string | null => {
      if (!iso) {
        return null;
      }
      // A slot just fired and the list hasn't refreshed yet: say so, rather
      // than "a few seconds ago".
      return new Date(iso).getTime() <= Date.now()
        ? t`due now`
        : formatRelativeTime(iso, i18n.locale);
    },
    [i18n.locale, t]
  );
};

/** The Dot's schedules, summed up in one line. */
export const useSchedulesSummary = () => {
  const { t } = useLingui();
  const say = useScheduleText();
  return useCallback(
    (dot: Pick<Dot, "schedules">): string => {
      const active = dot.schedules.filter(
        (schedule: DotSchedule) => schedule.enabled
      );
      if (active.length === 0) {
        return dot.schedules.length === 0 ? t`No schedule` : t`Paused`;
      }
      const label = say(active[0]?.cron ?? "");
      const more = active.length - 1;
      return more > 0 ? t`${label} and ${more} more` : label;
    },
    [say, t]
  );
};
