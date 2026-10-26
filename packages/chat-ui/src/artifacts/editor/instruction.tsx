"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { QueryUtils } from "@workspace/client/api";
import type { RunId } from "@workspace/contract/schemas/common";
import type { Artifact } from "@workspace/contract/schemas/files";
import {
  type RunStatus,
  terminalRunStatuses,
} from "@workspace/contract/schemas/runs";
import { SendIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";

// Asking the agent to change the piece being edited ("Change this slide"),
// shared by every kind's editor. The request goes to the artifact's chat as
// a message, so its reply, its approvals and its edit are where every
// other turn is; the editor follows the run and shows the new version when
// it lands. Where it stands is always on screen.

/** Where a request to the agent stands. */
export type InstructionState =
  | "approval"
  | "done"
  | "failed"
  | "idle"
  | "sending"
  | "working";

const TERMINAL: ReadonlySet<RunStatus> = new Set(terminalRunStatuses);

/** Where a request stands, from what's known about its run. Pure. */
export const instructionState = ({
  failed,
  sending,
  status,
}: {
  readonly failed: boolean;
  readonly sending: boolean;
  readonly status: RunStatus | null | undefined;
}): InstructionState => {
  if (failed || status === "failed" || status === "cancelled") {
    return "failed";
  }
  if (status === null) {
    return sending ? "sending" : "idle";
  }
  if (status === undefined) {
    return "working";
  }
  if (status === "awaiting_approval") {
    return "approval";
  }
  return TERMINAL.has(status) ? "done" : "working";
};

/** Sends a request into the artifact's chat and follows its run. */
export const useAskChat = (
  api: QueryUtils,
  conversationId: Artifact["conversationId"]
) => {
  const queryClient = useQueryClient();
  const [runId, setRunId] = useState<RunId | null>(null);
  const create = useMutation(api.runs.create.mutationOptions());
  const run = useQuery({
    ...api.runs.get.queryOptions({
      input: runId === null ? skipToken : { id: runId },
    }),
    refetchInterval: (query) =>
      query.state.data && TERMINAL.has(query.state.data.state.status)
        ? false
        : 1500,
  });
  const status = runId === null ? null : run.data?.state.status;
  const finished =
    status !== null && status !== undefined && TERMINAL.has(status);
  useEffect(() => {
    if (finished) {
      queryClient.invalidateQueries({ queryKey: api.artifacts.key() });
    }
  }, [api, finished, queryClient]);

  const send = useCallback(
    async (text: string) => {
      if (!conversationId) {
        return;
      }
      setRunId(null);
      const path = await queryClient.fetchQuery({
        ...api.messages.path.queryOptions({ input: { conversationId } }),
        staleTime: 0,
      });
      const created = await create.mutateAsync({
        conversationId,
        input: {
          parentId: path.leafId,
          parts: [{ text, type: "text" }],
          type: "message",
        },
      });
      setRunId(created.runId);
      // An open chat picks the run up and follows its reply.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: api.runs.key() }),
        queryClient.invalidateQueries({ queryKey: api.messages.key() }),
      ]);
    },
    [api, conversationId, create, queryClient]
  );

  return {
    available: conversationId !== null && conversationId !== undefined,
    send,
    state: instructionState({
      failed: create.isError,
      sending: create.isPending,
      status,
    }),
  };
};

/** A one-line request to the agent about the piece being edited. */
export function InstructionForm({
  disabled,
  label,
  onSubmit,
  placeholder,
  state,
}: {
  readonly disabled: boolean;
  /** What it asks ("Change this slide"). */
  readonly label: string;
  readonly onSubmit: (instruction: string) => Promise<void>;
  readonly placeholder: string;
  readonly state: InstructionState;
}) {
  const { t } = useLingui();
  const [instruction, setInstruction] = useState("");
  const busy =
    state === "sending" || state === "working" || state === "approval";
  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      setInstruction(event.target.value),
    []
  );
  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const asked = instruction.trim();
      if (!asked) {
        return;
      }
      onSubmit(asked)
        .then(() => setInstruction(""))
        .catch(() => undefined);
    },
    [instruction, onSubmit]
  );
  return (
    <div className="flex flex-col gap-1.5">
      <form className="flex items-center gap-2" onSubmit={submit}>
        <Input
          aria-label={label}
          className="h-8 text-sm"
          disabled={disabled || busy}
          onChange={onChange}
          placeholder={placeholder}
          value={instruction}
        />
        <Button
          aria-label={t`Send to the chat`}
          disabled={disabled || busy || instruction.trim() === ""}
          size="icon-sm"
          title={t`Send to the chat`}
          type="submit"
          variant="secondary"
        >
          <SendIcon aria-hidden />
        </Button>
      </form>
      <InstructionStatus state={state} />
    </div>
  );
}

function InstructionStatus({ state }: { readonly state: InstructionState }) {
  switch (state) {
    case "idle":
      return null;
    case "failed":
      return (
        <p className="text-destructive text-xs" role="alert">
          <Trans>
            The change didn't go through. Check the chat and try again.
          </Trans>
        </p>
      );
    case "approval":
      return (
        <p className="text-muted-foreground text-xs" role="status">
          <Trans>Waiting for you to approve the change in the chat.</Trans>
        </p>
      );
    case "done":
      return (
        <p className="text-muted-foreground text-xs" role="status">
          <Trans>Done. The chat has the details.</Trans>
        </p>
      );
    case "sending":
    case "working":
      return (
        <p className="text-muted-foreground text-xs" role="status">
          <Trans>Working on it. The chat shows the progress.</Trans>
        </p>
      );
    default:
      return state satisfies never;
  }
}
