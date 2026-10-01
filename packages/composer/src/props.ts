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
  WorkspacePath,
} from "./schemas";
import type { ModelVariant } from "./variants";

// Props shared by the shell, the loader and the editor. A types-only module,
// so importing it never pulls the editor into a bundle.

export interface ComposerProps {
  /** Agents for the picker and for `@` mentions. */
  readonly agents?: readonly AgentOption[];
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
  /** Templates `/` offers. */
  readonly prompts?: readonly PromptOption[];
  /**
   * Whose "Recently used" models and agents the picker remembers, like the
   * signed-in user's id. Left out, they're per browser.
   */
  readonly recentsKey?: string;
  readonly status?: ComposerStatus;
  /** The model/agent picker shows when this and `onTargetChange` are set. */
  readonly target?: RunTarget;
  /** The next message's thinking level and fast tier (see `onVariantChange`). */
  readonly variant?: ModelVariant;
  /** Whether web search is on for the next message (see `onWebSearchChange`). */
  readonly webSearch?: boolean;
}

/** What the user did in the shell before the editor loaded, handed to the editor. */
export interface ComposerHandoff {
  /** Caret offset in `text`. */
  readonly caret: number;
  readonly focused: boolean;
  readonly text: string;
}
