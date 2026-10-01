"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { ArtifactId } from "@workspace/contract/schemas/common";
import { CheckIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useId,
  useState,
} from "react";

// Editing a plan (106) until the Document editor exists: the plan's
// Markdown in a plain text area, in the panel. Approving sends the edited
// text with the approval, and the server saves it as the plan's next
// version before the run reads it; Cancel leaves the plan as it was.

export interface PlanEditing {
  readonly artifactId: ArtifactId;
  /** A run is going; approving waits for it. */
  readonly busy?: boolean;
  /** Approve the plan: `content` when the person changed it, else nothing. */
  readonly onApprove: (content: string | undefined) => void;
  readonly onCancel: () => void;
}

export function PlanEditor({
  editing,
  header,
  initial,
  title,
}: {
  readonly editing: PlanEditing;
  readonly header: (content: ReactNode) => ReactNode;
  /** The plan's latest version. */
  readonly initial: string;
  readonly title: string;
}) {
  const { t } = useLingui();
  const id = useId();
  const [text, setText] = useState(initial);
  const { onApprove, onCancel } = editing;
  const change = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value),
    []
  );
  const approve = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      onApprove(text === initial ? undefined : text);
    },
    [initial, onApprove, text]
  );
  return (
    <form
      className="flex h-full min-h-0 flex-1 flex-col"
      data-slot="plan-editor"
      onSubmit={approve}
    >
      {header(
        <h3
          className="min-w-0 flex-1 truncate font-medium text-sm"
          title={title}
        >
          <Trans>Editing {title}</Trans>
        </h3>
      )}
      <label className="sr-only" htmlFor={id}>
        <Trans>Plan, in Markdown</Trans>
      </label>
      <Textarea
        autoFocus
        className="min-h-0 flex-1 resize-none rounded-none border-0 px-6 py-5 font-mono text-sm leading-relaxed shadow-none focus-visible:ring-0"
        id={id}
        onChange={change}
        spellCheck
        value={text}
      />
      <div className="flex shrink-0 items-center justify-end gap-2 border-t px-3 py-2">
        <p className="me-auto text-muted-foreground text-xs">
          <Trans>Your edits are saved as a new version when you approve.</Trans>
        </p>
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          <Trans>Cancel</Trans>
        </Button>
        <Button
          aria-label={t`Approve the plan`}
          disabled={editing.busy || text.trim() === ""}
          size="sm"
          type="submit"
        >
          <CheckIcon aria-hidden />
          <Trans>Approve</Trans>
        </Button>
      </div>
    </form>
  );
}
