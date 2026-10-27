"use client";

import type { I18n } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  type AnnotationsData,
  annotationsOf,
} from "@workspace/ai/messages/annotations";
import { chipsOf } from "@workspace/ai/messages/chips";
import type {
  Message,
  SiblingInfo,
} from "@workspace/contract/schemas/messages";
import type { PendingApproval } from "@workspace/contract/schemas/runs";
import {
  CheckIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "@workspace/icons";
import { Bubble, BubbleContent } from "@workspace/ui/components/bubble";
import { Button } from "@workspace/ui/components/button";
import {
  MessageContent,
  MessageFooter,
  Message as MessageFrame,
} from "@workspace/ui/components/message";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import {
  type ChangeEvent,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AnnotationsNote } from "../artifacts/annotate/annotations-note";
import { notesText } from "../artifacts/annotate/target-words";
import { BranchSwitcher } from "../header/branch-switcher";
import {
  messageText,
  messageView,
  type RenderBlock,
  type ToolResultPart,
} from "../model/parts";
import type { AnswerPhase } from "../model/run-activity";
import { useConversationActions } from "./actions";
import { useRunActivity } from "./approval-state";
import { ArtifactCard } from "./artifact-card";
import { ChipText } from "./chip-text";
import { FeedbackButtons, type MessageFeedback } from "./feedback";
import { FileParts } from "./file-parts";
import { LazyReasoning } from "./lazy";
import { Markdown } from "./markdown";
import { MemoryNote } from "./memory-note";
import { ModeNote } from "./mode-note";
import { PlanApprovalNote, PlanCard } from "./plan-card";
import { PulseLabel } from "./pulse-label";
import { ReportNote, ScheduledLabel } from "./scheduled-note";
import { SkillsNote } from "./skills-note";
import { Sources } from "./sources";
import { ToolPart } from "./tool-part";

const COPIED_MS = 1500;

export interface MessageRowProps {
  readonly approvals: readonly PendingApproval[] | undefined;
  readonly feedback: MessageFeedback | undefined;
  readonly message: Message;
  /** Results of this message's tool calls, from anywhere on the branch. */
  readonly results: readonly ToolResultPart[];
  readonly siblings: SiblingInfo | undefined;
  readonly streaming: boolean;
}

/** A ghost icon button with its label as a tooltip (shadcn's Message pattern). */
function MessageAction({
  children,
  label,
  ...props
}: ComponentProps<typeof Button> & { readonly label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            size="icon-xs"
            type="button"
            variant="ghost"
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function CopyAction({ text }: { readonly text: string }) {
  const { t } = useLingui();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = useCallback(() => {
    // Clipboard access can be refused; the button just doesn't confirm then.
    navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => undefined
    );
  }, [text]);
  return (
    <MessageAction label={copied ? t`Copied` : t`Copy`} onClick={copy}>
      {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
    </MessageAction>
  );
}

function Block({
  approvals,
  block,
  live,
  running,
  streaming,
}: {
  readonly approvals: readonly PendingApproval[] | undefined;
  readonly block: RenderBlock;
  /** The block is the one being written: last in a streaming message. */
  readonly live: boolean;
  /** The answer's run is still going. */
  readonly running: boolean;
  readonly streaming: boolean;
}) {
  switch (block.kind) {
    case "text":
      return <Markdown streaming={live}>{block.text}</Markdown>;
    case "reasoning":
      return <LazyReasoning streaming={live} text={block.text} />;
    case "tool":
      return (
        <ToolPart
          approvals={approvals}
          call={block.call}
          result={block.result}
          running={running}
          streaming={streaming}
        />
      );
    case "memory":
      return <MemoryNote update={block.update} />;
    case "files":
      return <FileParts files={block.files} />;
    case "artifact":
      return <ArtifactCard part={block.part} />;
    case "annotation":
      return (
        <p className="text-muted-foreground text-xs">
          <Trans>Annotation attached</Trans>
        </p>
      );
    case "plan":
      return <PlanCard plan={block.plan} />;
    case "plan-approval":
      return <PlanApprovalNote approval={block.approval} />;
    case "skills":
      return <SkillsNote skills={block.skills} />;
    case "scheduled":
      return <ScheduledLabel task={block.task} />;
    case "report":
      return <ReportNote report={block.report} />;
    default:
      return block satisfies never;
  }
}

/** The one line under an answer that says where it stands, if any. */
type AnswerNote = "error" | "queued" | "stopped" | "thinking" | "waiting";

/**
 * Where an answer stands, from its stored status and its run (072: a page
 * opened mid-answer shows the same). A `partial` answer is one still being
 * written, one waiting on a decision, or one that ended early; only the
 * last says it stopped. A run with nothing to show yet is "Thinking…", as
 * the thinking row it becomes when the model's thinking arrives, so the
 * label never changes under the reader; once it writes, the answer's own
 * blocks show it working.
 */
const answerNote = ({
  empty,
  phase,
  status,
  streaming,
}: {
  readonly empty: boolean;
  readonly phase: AnswerPhase | undefined;
  readonly status: Message["status"];
  readonly streaming: boolean;
}): AnswerNote | null => {
  if (status === "error") {
    return "error";
  }
  if (phase === "queued" || phase === "waiting") {
    return status === "partial" ? phase : null;
  }
  if (streaming || phase === "running") {
    return empty ? "thinking" : null;
  }
  return status === "partial" ? "stopped" : null;
};

function StatusNote({ note }: { readonly note: AnswerNote | null }) {
  switch (note) {
    case null:
      return null;
    case "thinking":
      return (
        <div role="status">
          <LazyReasoning streaming text="" />
        </div>
      );
    case "queued":
      return (
        <p className="text-muted-foreground text-xs" role="status">
          <PulseLabel>
            <Trans>Waiting for the answer before it…</Trans>
          </PulseLabel>
        </p>
      );
    // Static: it waits on the person, not on the app, and the card above
    // already asks.
    case "waiting":
      return (
        <p className="text-muted-foreground text-xs" role="status">
          <Trans>Waiting for your approval.</Trans>
        </p>
      );
    case "stopped":
      return (
        <p className="text-muted-foreground text-xs" role="status">
          <Trans>This answer stopped early.</Trans>
        </p>
      );
    case "error":
      return (
        <p
          className="flex items-center gap-2 text-destructive text-sm"
          role="alert"
        >
          <TriangleAlertIcon aria-hidden className="size-4" />
          <Trans>Something went wrong and there's no answer.</Trans>
        </p>
      );
    default:
      return note satisfies never;
  }
}

function EditForm({
  initial,
  onCancel,
  onSave,
}: {
  readonly initial: string;
  readonly onCancel: () => void;
  readonly onSave: (text: string) => void;
}) {
  const { t } = useLingui();
  const [text, setText] = useState(initial);
  const onChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value),
    []
  );
  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const trimmed = text.trim();
      if (trimmed) {
        onSave(trimmed);
      }
    },
    [onSave, text]
  );
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      } else if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }
    },
    [onCancel]
  );
  return (
    <form className="flex w-full flex-col gap-2" onSubmit={submit}>
      <Textarea
        aria-label={t`Edit message`}
        autoFocus
        className="text-sm"
        onChange={onChange}
        onKeyDown={onKeyDown}
        value={text}
      />
      <p className="text-muted-foreground text-xs">
        <Trans>Sending the edit starts a new branch; the original stays.</Trans>
      </p>
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          <Trans>Cancel</Trans>
        </Button>
        <Button disabled={text.trim() === ""} size="sm" type="submit">
          <Trans>Send</Trans>
        </Button>
      </div>
    </form>
  );
}

/** What Copy takes from a user message: its notes as people read them, or its text. */
const copyTextOf = (
  text: string,
  annotations: AnnotationsData | undefined,
  i18n: I18n
): string => (annotations ? notesText(annotations, i18n) : text);

function UserMessage({
  message,
  siblings,
}: Pick<MessageRowProps, "message" | "siblings">) {
  const { i18n, t } = useLingui();
  const { onEdit, onSelectBranch } = useConversationActions();
  const [editing, setEditing] = useState(false);
  const text = messageText(message);
  const chips = useMemo(() => chipsOf(message.parts), [message.parts]);
  const annotations = useMemo(
    () => annotationsOf(message.parts),
    [message.parts]
  );
  const view = useMemo(
    () => messageView(message.parts, new Map()),
    [message.parts]
  );
  const files = view.blocks.flatMap((block) =>
    block.kind === "files" ? [block] : []
  );
  const approvals = view.blocks.flatMap((block) =>
    block.kind === "plan-approval" ? [block] : []
  );
  const skills = view.blocks.flatMap((block) =>
    block.kind === "skills" ? [block] : []
  );
  const scheduled = view.blocks.find((block) => block.kind === "scheduled");
  const startEdit = useCallback(() => setEditing(true), []);
  const cancel = useCallback(() => setEditing(false), []);
  const save = useCallback(
    (next: string) => {
      setEditing(false);
      if (next !== text) {
        onEdit?.(message, next);
      }
    },
    [message, onEdit, text]
  );

  return (
    <MessageFrame align="end" className="is-user" data-message-id={message.id}>
      <MessageContent className="gap-2">
        {editing ? (
          <EditForm initial={text} onCancel={cancel} onSave={save} />
        ) : (
          <>
            {scheduled?.kind === "scheduled" ? (
              <ScheduledLabel task={scheduled.task} />
            ) : null}
            {files.map((block) => (
              <div className="ms-auto" key={block.key}>
                <FileParts files={block.files} />
              </div>
            ))}
            {annotations ? (
              <Bubble align="end" variant="muted">
                <BubbleContent className="px-4 py-2.5">
                  <AnnotationsNote data={annotations} />
                </BubbleContent>
              </Bubble>
            ) : null}
            {text && !annotations ? (
              <Bubble align="end" variant="muted">
                <BubbleContent className="whitespace-pre-wrap px-4 py-2.5 text-[15px]">
                  {chips.length > 0 ? (
                    <ChipText chips={chips} text={text} />
                  ) : (
                    text
                  )}
                </BubbleContent>
              </Bubble>
            ) : null}
            {approvals.map((block) => (
              <div className="ms-auto" key={block.key}>
                <PlanApprovalNote approval={block.approval} />
              </div>
            ))}
            {skills.map((block) => (
              <div className="ms-auto" key={block.key}>
                <SkillsNote skills={block.skills} />
              </div>
            ))}
            {message.mode ? <ModeNote mode={message.mode} /> : null}
            <MessageFooter className="gap-1 px-0 opacity-0 pointer-coarse:opacity-100 focus-within:opacity-100 group-hover/message:opacity-100">
              <BranchSwitcher
                info={siblings}
                onSelect={onSelectBranch ?? noop}
              />
              {text ? (
                <CopyAction text={copyTextOf(text, annotations, i18n)} />
              ) : null}
              {onEdit && !annotations ? (
                <MessageAction label={t`Edit`} onClick={startEdit}>
                  <PencilIcon aria-hidden />
                </MessageAction>
              ) : null}
            </MessageFooter>
          </>
        )}
      </MessageContent>
    </MessageFrame>
  );
}

const noop = () => undefined;

function AssistantMessage({
  approvals,
  feedback,
  message,
  results,
  siblings,
  streaming,
}: MessageRowProps) {
  const { t } = useLingui();
  const { onRegenerate, onSelectBranch } = useConversationActions();
  const phase = useRunActivity().answers.get(message.id);
  const view = useMemo(
    () =>
      messageView(
        message.parts,
        new Map(results.map((result) => [result.toolCallId, result]))
      ),
    [message.parts, results]
  );
  const text = messageText(message);
  const regenerate = useCallback(
    () => onRegenerate?.(message),
    [message, onRegenerate]
  );

  return (
    <MessageFrame
      aria-busy={streaming}
      className="is-assistant"
      data-message-id={message.id}
    >
      <MessageContent className="gap-3 text-[15px] text-foreground leading-[1.75]">
        {view.blocks.map((block, index) => (
          <Block
            approvals={approvals}
            block={block}
            key={block.key}
            live={streaming && index === view.blocks.length - 1}
            running={phase !== undefined}
            streaming={streaming}
          />
        ))}
        <Sources sources={view.sources} />
        <StatusNote
          note={answerNote({
            empty: view.blocks.length === 0,
            phase,
            status: message.status,
            streaming,
          })}
        />
        {streaming ? null : (
          <MessageFooter className="-ms-1.5 gap-1 px-0">
            <BranchSwitcher info={siblings} onSelect={onSelectBranch ?? noop} />
            {text ? <CopyAction text={text} /> : null}
            {onRegenerate ? (
              <MessageAction label={t`Regenerate`} onClick={regenerate}>
                <RefreshCwIcon aria-hidden />
              </MessageAction>
            ) : null}
            <FeedbackButtons
              canShare={message.agent !== null}
              feedback={feedback}
              messageId={message.id}
            />
          </MessageFooter>
        )}
      </MessageContent>
    </MessageFrame>
  );
}

const sameSiblings = (
  a: SiblingInfo | undefined,
  b: SiblingInfo | undefined
): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.index === b.index &&
    a.siblingIds.length === b.siblingIds.length &&
    a.siblingIds.every((id, index) => id === b.siblingIds[index]));

const sameItems = <T,>(
  a: readonly T[] | undefined,
  b: readonly T[] | undefined
): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((item, index) => item === b[index]));

/**
 * One message, memoised by what it shows (D28): a streaming token changes
 * only the streaming message's object, so only that row re-renders.
 */
export const MessageRow = memo(
  function MessageRowInner(props: MessageRowProps) {
    if (props.message.role === "user") {
      return <UserMessage message={props.message} siblings={props.siblings} />;
    }
    return <AssistantMessage {...props} />;
  },
  (previous, next) =>
    previous.message === next.message &&
    previous.streaming === next.streaming &&
    previous.feedback === next.feedback &&
    sameSiblings(previous.siblings, next.siblings) &&
    sameItems(previous.results, next.results) &&
    sameItems(previous.approvals, next.approvals)
);
