import type { Term } from "@workspace/config/terms";
import type { LibraryItemId } from "@workspace/contract/schemas/common";
import type { Connector } from "@workspace/contract/schemas/library";
import type { ModelOption } from "@workspace/contract/schemas/models";
import type { ChatMode, RunTarget } from "@workspace/contract/schemas/runs";
import type { UserSummary } from "@workspace/contract/schemas/tenancy";

import type { DraftKey, DraftStore } from "./ports/draft-store";
import type { PromptHistoryEntry } from "./prompt-history";
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

export interface ComposerChatMode {
  readonly mode: ChatMode;
  readonly onChange: (mode: ChatMode) => void;
}

export interface ComposerProps {
  /** Agents for the picker and for `@` mentions. */
  readonly agents?: readonly AgentOption[];
  /** Read once, when the composer mounts. Defaults to `default`. */
  readonly appearance?: ComposerAppearance;
  readonly attachmentLimits?: AttachmentLimits;
  /**
   * The chat's mode, Chat or Code, and what to call when it's switched.
   * Pass it to offer the switch; the host saves it on the conversation, and
   * it applies from the next message.
   */
  readonly chatMode?: ComposerChatMode;
  readonly className?: string;
  /**
   * File commands `/` offers ahead of prompts, for the host to carry out in
   * `onCommand`. Left out, `/` lists prompts only.
   */
  readonly commands?: readonly ComposerCommand[];
  readonly disabled?: boolean;
  /**
   * Keeps the unsent draft (text, mentions, picked skills) in `store` under
   * `key`, restoring it on mount and when `key` changes (147). Left out,
   * the draft lives only as long as the composer.
   */
  readonly draft?: ComposerDraftOptions;
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
  /**
   * The person's earlier prompts here, oldest first (`promptHistory` over
   * the branch in view): ArrowUp in an empty composer brings them back
   * (147). Left out, ArrowUp only moves the caret.
   */
  readonly history?: readonly PromptHistoryEntry[];
  /**
   * MCP servers for this chat (188): the + menu's submenu for them
   * switches each, and its tools, for this chat only, and `/` finds them by
   * name. Left out, neither is offered.
   */
  readonly mcp?: ComposerMcp;
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

/**
 * This chat's MCP servers and the host's handlers for them (188). The host
 * owns the data and saves every change; the composer only shows it.
 */
export interface ComposerMcp {
  /** Whether this chat differs from the person's defaults. */
  readonly customized: boolean;
  /** Back to the person's defaults for this chat. */
  readonly onReset: () => void;
  readonly onToggle: (id: LibraryItemId, enabled: boolean) => void;
  /** As `connectors.list` returns them for this chat. */
  readonly servers: readonly Connector[];
  /** What this instance calls them (191): "MCP servers" unless configured. */
  readonly term: Pick<Term, "label" | "singular">;
}

/** Where the draft is kept; see `ComposerProps.draft`. */
export interface ComposerDraftOptions {
  /** The conversation id, or `NEW_CHAT_DRAFT_KEY` for a chat not made yet. */
  readonly key: DraftKey;
  readonly store: DraftStore;
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
