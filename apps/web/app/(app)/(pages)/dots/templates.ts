import type {
  CreateDotInput,
  DotAvatar,
} from "@workspace/contract/schemas/dots";
import type { RunTarget } from "@workspace/contract/schemas/runs";

// What a new Dot starts from (172). The onboarding asks three things (a
// name, a look, what it should help with) and may add one starter schedule
// from a template. Pure: the screen supplies the words through Lingui.

export type DotTemplateId = "daily-brief" | "follow-up" | "weekly-review";

export const DOT_TEMPLATE_IDS: readonly DotTemplateId[] = [
  "daily-brief",
  "follow-up",
  "weekly-review",
];

/** When each template's starter schedule runs, in the owner's time zone. */
export const TEMPLATE_CRON: Readonly<Record<DotTemplateId, string>> = {
  "daily-brief": "0 8 * * *",
  "follow-up": "0 9 * * 1-5",
  "weekly-review": "0 16 * * 5",
};

export interface DotTemplateText {
  /** What the Dot is for, as the owner would say it. */
  readonly purpose: string;
  /** The message each scheduled run posts. */
  readonly task: string;
}

export interface OnboardingDraft {
  readonly avatar: DotAvatar;
  readonly name: string;
  readonly purpose: string;
  /** The starter schedule, when the owner kept one. */
  readonly schedule: {
    readonly cron: string;
    readonly prompt: string;
    readonly timezone: string;
  } | null;
}

/** The create call for a finished onboarding. */
export const createInputOf = (
  draft: OnboardingDraft,
  target: RunTarget,
  primary: boolean
): CreateDotInput => ({
  autoApproveTools: [],
  avatar: draft.avatar,
  enabled: true,
  instructions: draft.purpose.trim(),
  name: draft.name.trim(),
  primary,
  rules: "",
  sandboxProvider: null,
  schedules: draft.schedule ? [{ ...draft.schedule, enabled: true }] : [],
  target,
});

/** A fresh look for each new Dot, so two don't start out the same. */
export const suggestedAvatar = (
  existing: number,
  styles: readonly DotAvatar["style"][],
  colors: readonly DotAvatar["color"][]
): DotAvatar => ({
  color: colors[existing % colors.length] ?? "sea",
  style: styles[existing % styles.length] ?? "orb",
});
