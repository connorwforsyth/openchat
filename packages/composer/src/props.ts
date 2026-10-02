import type { ModelOption } from "@workspace/contract/schemas/models";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import type { UserSummary } from "@workspace/contract/schemas/tenancy";

import type {
  AgentOption,
  AttachmentLimits,
  AttachmentRejection,
  ComposerAttachment,
  ComposerCommand,
  ComposerStatus,
  ComposerValue,
  PromptOption,
  SkillOption,
  WorkspacePath,
} from "./schemas";
import type { ModelVariant } from "./variants";

// Props shared by the shell, the loader and the editor. A types-only module,
// so importing it never pulls the editor into a bundle.

/**
 * How the composer is laid out. `default` is the chat's: a framed field over
 * the bottom row (+ menu, picker, Send). `strip` is one bare row, the input
 * and Send and nothing else (Quick AI, 135): no frame, so the host's surface
 * shows through, larger text, and an input that grows to a cap and then
 * scrolls without a visible scrollbar.
 */
export type ComposerAppearance = "default" | "strip";

export interface ComposerProps {
  /** Agents for the picker and for `@` mentions. */
  readonly agents?: readonly AgentOption[];
  /** Read once, when the composer mounts. Defaults to `default`. */
  readonly appearance?: ComposerAppearance;
  readonly attachmentLimits?: AttachmentLimits;
  readonly className?: string;
  /**
   * File commands `/` offers ahead of prompts, for the host to carry out in
   * `onCommand`. Left out, `/` lists prompts only.
   */
  readonly commands?: readonly ComposerCommand[];
  readonly disabled?: boolean;
  /**
   * Workspace files (`src/app.ts`), offered by `@` after agents and people,
   * and by `/open`.
   */
  readonly files?: readonly WorkspacePath[];
  /**
   * Text the host puts in the composer, replacing what's there, with the
   * caret at its end ("Edit this image", 138). Each new `id` applies once.
   */
  readonly fill?: ComposerFill;
  /** Models for the picker, as `meta.listModels` returns them. */
  readonly models?: readonly ModelOption[];
  readonly onAttachmentsChange?: (
    attachments: readonly ComposerAttachment[]
  ) => void;
  readonly onAttachmentsRejected?: (
    rejections: readonly AttachmentRejection[]
  ) => void;
  /**
   * A file command was chosen from `/`. The `/command` text is removed first.
   * `open` comes with the chosen path, or without one when there are no
   * `files` to choose from.
   */
  readonly onCommand?: (command: ComposerCommand, path?: WorkspacePath) => void;
  /**
   * Plan mode was switched on or off in the + menu (106). Pass it to offer
   * the switch; the host sends it as the run's `options.mode: "plan"`, a
   * read-only planning run.
   */
  readonly onPlanChange?: (on: boolean) => void;
  /** Stops the current run. The stop button shows while `status` is busy. */
  readonly onStop?: () => void;
  readonly onSubmit: (value: ComposerValue) => void;
  readonly onTargetChange?: (target: RunTarget) => void;
  /**
   * The thinking level or fast mode changed for the chosen model (105).
   * Pass it to offer the provider's own levels and fast tier; the host sends
   * `variant` as the run's `options.reasoning` and `options.fast`. Left out,
   * only catalog entries folded into a model (`-high`, `-fast`) can be had.
   */
  readonly onVariantChange?: (variant: ModelVariant) => void;
  /**
   * Web search was switched on or off in the + menu. Pass it only when the
   * instance has web search (`features.webSearch`); left out, the switch
   * isn't offered. The host sends it as the run's `options.webSearch`.
   */
  readonly onWebSearchChange?: (on: boolean) => void;
  /** People `@` can mention. */
  readonly people?: readonly UserSummary[];
  readonly placeholder?: string;
  /** Whether the next message plans rather than builds (see `onPlanChange`). */
  readonly plan?: boolean;
  /** Templates `/` offers. */
  readonly prompts?: readonly PromptOption[];
  /**
   * Whose "Recently used" models and agents the picker remembers, like the
   * signed-in user's id. Left out, they're per browser.
   */
  readonly recentsKey?: string;
  /**
   * Skills the person can use (127): offered from the + menu and from `/`.
   * A picked one shows as a chip and goes out with the message
   * (`ComposerValue.skills`), for the host to send as the run's
   * `input.skills`.
   */
  readonly skills?: readonly SkillOption[];
  readonly status?: ComposerStatus;
  /** The model/agent picker shows when this and `onTargetChange` are set. */
  readonly target?: RunTarget;
  /** The next message's thinking level and fast tier (see `onVariantChange`). */
  readonly variant?: ModelVariant;
  /** Whether web search is on for the next message (see `onWebSearchChange`). */
  readonly webSearch?: boolean;
}

/** A request to fill the composer; see `ComposerProps.fill`. */
export interface ComposerFill {
  readonly id: number;
  readonly text: string;
}

/** What the user did in the shell before the editor loaded, handed to the editor. */
export interface ComposerHandoff {
  /** Caret offset in `text`. */
  readonly caret: number;
  readonly focused: boolean;
  readonly text: string;
}
