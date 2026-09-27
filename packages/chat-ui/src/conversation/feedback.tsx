"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { MessageId } from "@workspace/contract/schemas/common";
import type { Feedback } from "@workspace/contract/schemas/feedback";
import { ThumbsDownIcon, ThumbsUpIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useId,
  useState,
} from "react";

import { useConversationActions } from "./actions";

type Rating = Feedback["rating"];

/** The user's current feedback on a message, as the row knows it. */
export type MessageFeedback = Pick<
  Feedback,
  "comment" | "rating" | "shareWithMaintainers"
>;

/**
 * Thumbs up / down (D21). A thumb records the rating at once; the popover
 * that follows takes an optional comment and, for an agent's answer, consent
 * to share the conversation with the agent's maintainers (off by default:
 * they otherwise see aggregates only). Pressing the active thumb clears it.
 */
export function FeedbackButtons({
  canShare,
  feedback,
  messageId,
}: {
  /** The answer came from an agent that has maintainers. */
  readonly canShare: boolean;
  readonly feedback: MessageFeedback | undefined;
  readonly messageId: MessageId;
}) {
  const { onClearFeedback, onFeedback } = useConversationActions();
  if (!onFeedback) {
    return null;
  }
  return (
    <>
      <FeedbackButton
        canShare={canShare}
        current={feedback}
        messageId={messageId}
        onClear={onClearFeedback}
        onFeedback={onFeedback}
        rating="up"
      />
      <FeedbackButton
        canShare={canShare}
        current={feedback}
        messageId={messageId}
        onClear={onClearFeedback}
        onFeedback={onFeedback}
        rating="down"
      />
    </>
  );
}

function FeedbackButton({
  canShare,
  current,
  messageId,
  onClear,
  onFeedback,
  rating,
}: {
  readonly canShare: boolean;
  readonly current: MessageFeedback | undefined;
  readonly messageId: MessageId;
  readonly onClear: ((messageId: MessageId) => void) | undefined;
  readonly onFeedback: NonNullable<
    ReturnType<typeof useConversationActions>["onFeedback"]
  >;
  readonly rating: Rating;
}) {
  const { t } = useLingui();
  const commentId = useId();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [share, setShare] = useState(false);
  const active = current?.rating === rating;

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setOpen(false);
        return;
      }
      if (active) {
        // The active thumb again: take the rating back.
        onClear?.(messageId);
        return;
      }
      onFeedback({ messageId, rating, shareWithMaintainers: false });
      setComment("");
      setShare(false);
      setOpen(true);
    },
    [active, messageId, onClear, onFeedback, rating]
  );

  const onComment = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setComment(event.target.value),
    []
  );
  const onShare = useCallback((checked: boolean) => setShare(checked), []);
  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const trimmed = comment.trim();
      onFeedback({
        ...(trimmed ? { comment: trimmed } : {}),
        messageId,
        rating,
        shareWithMaintainers: canShare && share,
      });
      setOpen(false);
    },
    [canShare, comment, messageId, onFeedback, rating, share]
  );

  const Icon = rating === "up" ? ThumbsUpIcon : ThumbsDownIcon;
  const label = rating === "up" ? t`Good answer` : t`Bad answer`;

  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label={label}
            aria-pressed={active}
            size="icon-xs"
            variant="ghost"
          />
        }
      >
        <Icon aria-hidden className={cn(active && "fill-current")} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80" side="top">
        <form className="flex flex-col gap-2.5" onSubmit={submit}>
          <label className="font-medium text-sm" htmlFor={commentId}>
            {rating === "up" ? (
              <Trans>Thanks! What was good? (optional)</Trans>
            ) : (
              <Trans>What went wrong? (optional)</Trans>
            )}
          </label>
          <Textarea
            className="min-h-16 text-sm"
            id={commentId}
            maxLength={4000}
            onChange={onComment}
            value={comment}
          />
          {canShare ? (
            // biome-ignore lint/a11y/noLabelWithoutControl: Base UI's Checkbox renders the control inside the label.
            <label className="flex items-start gap-2 text-muted-foreground text-xs">
              <Checkbox
                checked={share}
                className="mt-0.5"
                onCheckedChange={onShare}
              />
              <span>
                <Trans>
                  Share this conversation with the agent's maintainers. Without
                  this they only see totals.
                </Trans>
              </span>
            </label>
          ) : null}
          <div className="flex justify-end">
            <Button size="sm" type="submit">
              <Trans>Send feedback</Trans>
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
