import type { ModelOption } from "@workspace/contract/schemas/models";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import type {
  ChatContext,
  UserSummary,
} from "@workspace/contract/schemas/tenancy";

import type {
  AgentOption,
  AttachmentLimits,
  AttachmentRejection,
  ComposerAttachment,
  ComposerStatus,
  ComposerValue,
  ContextOption,
  PromptOption,
} from "./schemas";

// Props shared by the shell, the loader and the editor. A types-only module,
// so importing it never pulls the editor into a bundle.

export interface ComposerProps {
  /** Agents for the picker and for `@` mentions. */
  readonly agents?: readonly AgentOption[];
  readonly attachmentLimits?: AttachmentLimits;
  readonly className?: string;
  /** The chat context chip shows when this is set. */
  readonly context?: ChatContext;
  readonly contextLocked?: boolean;
  readonly contexts?: readonly ContextOption[];
  readonly disabled?: boolean;
  /** Models for the picker, as `meta.listModels` returns them. */
  readonly models?: readonly ModelOption[];
  readonly onAttachmentsChange?: (
    attachments: readonly ComposerAttachment[]
  ) => void;
  readonly onAttachmentsRejected?: (
    rejections: readonly AttachmentRejection[]
  ) => void;
  readonly onContextChange?: (context: ChatContext) => void;
  /** Stops the current run. The stop button shows while `status` is busy. */
  readonly onStop?: () => void;
  readonly onSubmit: (value: ComposerValue) => void;
  readonly onTargetChange?: (target: RunTarget) => void;
  /** People `@` can mention. */
  readonly people?: readonly UserSummary[];
  readonly placeholder?: string;
  /** Templates `/` offers. */
  readonly prompts?: readonly PromptOption[];
  readonly status?: ComposerStatus;
  /** The model/agent picker shows when this and `onTargetChange` are set. */
  readonly target?: RunTarget;
}

/** What the user did in the shell before the editor loaded, handed to the editor. */
export interface ComposerHandoff {
  /** Caret offset in `text`. */
  readonly caret: number;
  readonly focused: boolean;
  readonly text: string;
}
