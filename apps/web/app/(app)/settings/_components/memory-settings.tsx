"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MemoryDocument,
  MemoryVersion,
} from "@workspace/contract/schemas/memory";
import { formatRelativeTime } from "@workspace/i18n/format";
import { HistoryIcon, RotateCcwIcon } from "@workspace/icons";
import {
  Alert,
  AlertAction,
  AlertDescription,
} from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Switch } from "@workspace/ui/components/switch";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { type ChangeEvent, useCallback, useState } from "react";

import { useApi } from "../../_shared/api";
import { codeOf, QueryState } from "../../_shared/query-state";

// Memory (D20): the one Markdown file injected into every chat. Edits are
// guarded by the version they started from, so a save never overwrites an
// agent's update the user hasn't seen; every change is a version that can be
// restored ("Memory updated · Undo" is the same revert).

const VersionSource = ({ version }: { readonly version: MemoryVersion }) => {
  switch (version.source.type) {
    case "user":
      return <Trans>You edited it</Trans>;
    case "agent":
      return <Trans>Updated in a chat</Trans>;
    case "revert":
      return <Trans>Restored an earlier version</Trans>;
    default:
      return version.source satisfies never;
  }
};

const VersionRow = ({
  current,
  onRestore,
  restoring,
  version,
}: {
  readonly current: boolean;
  readonly onRestore: (version: MemoryVersion) => void;
  readonly restoring: boolean;
  readonly version: MemoryVersion;
}) => {
  const { i18n, t } = useLingui();
  const restore = useCallback(() => onRestore(version), [onRestore, version]);
  const { number } = version;
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-3">
        <span className="font-medium text-sm tabular-nums">
          <Trans>Version {number}</Trans>
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-sm">
          <VersionSource version={version} />
          {" · "}
          {formatRelativeTime(version.createdAt, i18n.locale)}
        </span>
        {current ? (
          <span className="text-muted-foreground text-xs">
            <Trans>Current</Trans>
          </span>
        ) : (
          <Button
            aria-label={t`Restore version ${number}`}
            disabled={restoring}
            onClick={restore}
            size="sm"
            variant="outline"
          >
            <RotateCcwIcon data-icon="inline-start" />
            <Trans>Restore</Trans>
          </Button>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground text-xs">
          <Trans>Show contents</Trans>
        </summary>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs">
          {version.content}
        </pre>
      </details>
    </li>
  );
};

const Editor = ({ document }: { readonly document: MemoryDocument }) => {
  const { t } = useLingui();
  const { query } = useApi();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(document.content);
  const [base, setBase] = useState(document.versionId);
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: query.memory.key() }),
    [query, queryClient]
  );

  const save = useMutation(
    query.memory.update.mutationOptions({
      onSuccess: (saved) => {
        setBase(saved.versionId);
        refresh();
      },
    })
  );
  const setMode = useMutation(
    query.memory.setMode.mutationOptions({ onSettled: refresh })
  );
  const conflict = codeOf(save.error) === "CONFLICT";
  const dirty = draft !== document.content || base !== document.versionId;
  const { length } = draft;
  const { maxChars: max } = document;
  const over = length > max;

  const { mutate: mutateSave, reset: resetSave } = save;
  const { mutate: mutateMode } = setMode;
  const onChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value),
    []
  );
  const onSave = useCallback(
    () => mutateSave({ baseVersionId: base, content: draft }),
    [base, draft, mutateSave]
  );
  const takeLatest = useCallback(async () => {
    const latest = await queryClient.fetchQuery(
      query.memory.get.queryOptions()
    );
    setDraft(latest.content);
    setBase(latest.versionId);
    resetSave();
  }, [query, queryClient, resetSave]);
  const onMode = useCallback(
    (propose: boolean) => mutateMode({ mode: propose ? "propose" : "auto" }),
    [mutateMode]
  );
  const mode = setMode.isPending ? setMode.variables.mode : document.mode;

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel className="sr-only" htmlFor="memory">
          <Trans>Memory</Trans>
        </FieldLabel>
        <Textarea
          aria-describedby="memory-count"
          className="min-h-64 font-mono text-sm"
          id="memory"
          onChange={onChange}
          placeholder={t`- I prefer pnpm over npm\n- Answer in British English`}
          spellCheck={false}
          value={draft}
        />
        <p
          className={cn(
            "text-xs tabular-nums",
            over ? "text-destructive" : "text-muted-foreground"
          )}
          id="memory-count"
        >
          {over ? (
            <Trans>
              {length} of {max} characters. Anything past the limit isn't
              included in chats.
            </Trans>
          ) : (
            <Trans>
              {length} of {max} characters
            </Trans>
          )}
        </p>
      </Field>
      {conflict ? (
        <Alert>
          <AlertDescription>
            <Trans>
              Memory changed since you opened it, probably in a chat. Load the
              latest version, then make your edit again.
            </Trans>
          </AlertDescription>
          <AlertAction>
            <Button onClick={takeLatest} size="sm" variant="outline">
              <Trans>Load latest</Trans>
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      {save.isError && !conflict ? (
        <p className="text-destructive text-sm" role="alert">
          <Trans>Memory couldn't be saved. Try again.</Trans>
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button disabled={!dirty || save.isPending} onClick={onSave}>
          <Trans>Save</Trans>
        </Button>
      </div>
      <Field orientation="horizontal">
        <Switch
          checked={mode === "propose"}
          id="memory-mode"
          onCheckedChange={onMode}
        />
        <FieldContent>
          <FieldLabel htmlFor="memory-mode">
            <Trans>Ask before changing memory</Trans>
          </FieldLabel>
          <FieldDescription>
            <Trans>
              Agents propose memory edits as a diff for you to approve, instead
              of saving them right away.
            </Trans>
          </FieldDescription>
        </FieldContent>
      </Field>
    </div>
  );
};

const Versions = ({ currentId }: { readonly currentId: string | null }) => {
  const { query } = useApi();
  const queryClient = useQueryClient();
  const versions = useQuery(
    query.memory.versions.queryOptions({ input: { limit: 20 } })
  );
  const revert = useMutation(
    query.memory.revert.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries({ queryKey: query.memory.key() }),
    })
  );
  const { mutate } = revert;
  const restore = useCallback(
    (version: MemoryVersion) => mutate({ versionId: version.id }),
    [mutate]
  );
  return (
    <QueryState query={versions}>
      {(page) =>
        page.items.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            <Trans>No versions yet. Saving creates the first one.</Trans>
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {page.items.map((version) => (
              <VersionRow
                current={version.id === currentId}
                key={version.id}
                onRestore={restore}
                restoring={revert.isPending}
                version={version}
              />
            ))}
          </ul>
        )
      }
    </QueryState>
  );
};

export const MemorySettings = () => {
  const { query } = useApi();
  const memory = useQuery(query.memory.get.queryOptions());
  return (
    <QueryState query={memory} skeleton={4}>
      {(document) => (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>
                <Trans>Your memory</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Markdown that's included in every chat you start. Agents add
                  to it when you ask them to remember something.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Keyed by version: a restore elsewhere resets the editor. */}
              <Editor document={document} key={document.versionId ?? "new"} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HistoryIcon className="size-4" />
                <Trans>History</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  Every change is kept. Restoring makes a new version, so
                  nothing is lost.
                </Trans>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Versions currentId={document.versionId} />
            </CardContent>
          </Card>
        </div>
      )}
    </QueryState>
  );
};
