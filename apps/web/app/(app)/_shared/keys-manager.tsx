"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProviderKey } from "@workspace/contract/schemas/keys";
import { providerIdSchema } from "@workspace/contract/schemas/models";
import { formatRelativeTime } from "@workspace/i18n/format";
import { KeyRoundIcon, Trash2Icon } from "@workspace/icons";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import { type FormEvent, useCallback, useId, useState } from "react";
import { z } from "zod";

import { useApi } from "./api";
import { ConfirmButton } from "./confirm";
import { QueryState } from "./query-state";

// Provider keys for one owner: the user (settings) or an org or team
// (admin). Secrets are write-only (D24): the form sends the key once and
// forgets it, and the list only ever shows a label and the last characters.
// Keys from app.config.yaml show read-only.

export type KeyOwner =
  | { readonly id: string; readonly type: "user" }
  | { readonly id: string; readonly type: "org" }
  | { readonly id: string; readonly type: "team" };

/** Providers people usually mean; any lowercase provider id from app.config.yaml works. */
const SUGGESTED_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "azure",
  "bedrock",
  "openrouter",
] as const;

const addKeySchema = z.object({
  apiKey: z.string().trim().min(8).max(8192),
  baseURL: z.union([z.url(), z.literal("")]),
  label: z.string().trim().max(100),
  provider: providerIdSchema,
});

const VerifyButton = ({ id }: { readonly id: ProviderKey["id"] }) => {
  const { query } = useApi();
  const verify = useMutation(query.keys.verify.mutationOptions());
  const { mutate } = verify;
  const run = useCallback(() => mutate({ id }), [id, mutate]);
  return (
    <span className="flex items-center gap-2">
      <Button
        disabled={verify.isPending}
        onClick={run}
        size="sm"
        variant="ghost"
      >
        <Trans>Check</Trans>
      </Button>
      <span aria-live="polite" className="text-xs">
        {verify.data?.ok ? (
          <span className="text-muted-foreground">
            <Trans>Works</Trans>
          </span>
        ) : null}
        {verify.data && !verify.data.ok ? (
          <span className="text-destructive">
            {verify.data.message ?? <Trans>Rejected</Trans>}
          </span>
        ) : null}
        {verify.isError ? (
          <span className="text-destructive">
            <Trans>Couldn't check</Trans>
          </span>
        ) : null}
      </span>
    </span>
  );
};

const KeyRow = ({
  onRemove,
  providerKey,
}: {
  readonly onRemove: (id: ProviderKey["id"]) => void;
  readonly providerKey: ProviderKey;
}) => {
  const { i18n, t } = useLingui();
  const fromConfig = providerKey.source === "config";
  const name = providerKey.label || providerKey.provider;
  const remove = useCallback(
    () => onRemove(providerKey.id),
    [onRemove, providerKey.id]
  );
  return (
    <TableRow>
      <TableCell className="font-medium">{providerKey.provider}</TableCell>
      <TableCell>
        <span className="flex items-center gap-2">
          {providerKey.label || (
            <span className="text-muted-foreground">
              <Trans>No label</Trans>
            </span>
          )}
          {fromConfig ? (
            <Badge variant="secondary">
              <Trans>Server config</Trans>
            </Badge>
          ) : null}
        </span>
      </TableCell>
      <TableCell className="font-mono text-muted-foreground text-xs">
        …{providerKey.hint}
      </TableCell>
      <TableCell className="text-muted-foreground text-xs">
        {providerKey.lastUsedAt ? (
          formatRelativeTime(providerKey.lastUsedAt, i18n.locale)
        ) : (
          <Trans>Never used</Trans>
        )}
      </TableCell>
      <TableCell className="text-end">
        <span className="flex items-center justify-end gap-1">
          <VerifyButton id={providerKey.id} />
          {fromConfig ? null : (
            <ConfirmButton
              confirmLabel={<Trans>Remove key</Trans>}
              description={
                <Trans>
                  Chats that relied on it fall back to other keys, or stop if
                  there are none.
                </Trans>
              }
              label={t`Remove ${name}`}
              onConfirm={remove}
              title={<Trans>Remove this key?</Trans>}
            >
              <Trash2Icon />
            </ConfirmButton>
          )}
        </span>
      </TableCell>
    </TableRow>
  );
};

const AddKeyForm = ({
  onAdded,
  owner,
}: {
  readonly onAdded: () => void;
  readonly owner: KeyOwner;
}) => {
  const { t } = useLingui();
  const { query } = useApi();
  const id = useId();
  const [problem, setProblem] = useState<"invalid" | "failed" | null>(null);
  const create = useMutation(query.keys.create.mutationOptions());
  const { mutate } = create;

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const parsed = addKeySchema.safeParse(
        Object.fromEntries(new FormData(form))
      );
      if (!parsed.success) {
        setProblem("invalid");
        return;
      }
      setProblem(null);
      mutate(
        {
          apiKey: parsed.data.apiKey,
          baseURL: parsed.data.baseURL || undefined,
          label: parsed.data.label,
          provider: parsed.data.provider,
          scope: owner,
        },
        {
          onError: () => setProblem("failed"),
          onSuccess: () => {
            // Never keep a secret around longer than the request.
            form.reset();
            onAdded();
          },
        }
      );
    },
    [mutate, onAdded, owner]
  );

  return (
    <form autoComplete="off" onSubmit={submit}>
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${id}-provider`}>
              <Trans>Provider</Trans>
            </FieldLabel>
            <Input
              id={`${id}-provider`}
              list={`${id}-providers`}
              name="provider"
              placeholder="anthropic"
              required
            />
            <datalist id={`${id}-providers`}>
              {SUGGESTED_PROVIDERS.map((provider) => (
                <option key={provider} value={provider} />
              ))}
            </datalist>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-label`}>
              <Trans>Label</Trans>
            </FieldLabel>
            <Input
              id={`${id}-label`}
              name="label"
              placeholder={t`Work account`}
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor={`${id}-key`}>
            <Trans>API key</Trans>
          </FieldLabel>
          <Input
            autoComplete="off"
            id={`${id}-key`}
            name="apiKey"
            required
            spellCheck={false}
            type="password"
          />
          <FieldDescription>
            <Trans>
              Stored encrypted and never shown again; only its last characters
              are.
            </Trans>
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-base`}>
            <Trans>Base URL (optional)</Trans>
          </FieldLabel>
          <Input
            id={`${id}-base`}
            name="baseURL"
            placeholder="https://"
            type="url"
          />
        </Field>
        {problem ? (
          <FieldError>
            {problem === "invalid" ? (
              <Trans>
                Check the provider (lowercase, like “anthropic”), the key and
                the URL.
              </Trans>
            ) : (
              <Trans>The key couldn't be added. Try again.</Trans>
            )}
          </FieldError>
        ) : null}
        <div>
          <Button disabled={create.isPending} type="submit">
            <Trans>Add key</Trans>
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
};

export const KeysManager = ({ owner }: { readonly owner: KeyOwner }) => {
  const { query } = useApi();
  const queryClient = useQueryClient();
  const input = { scopeId: owner.id, scopeType: owner.type };
  const keys = useQuery(query.keys.list.queryOptions({ input }));
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: query.keys.key() }),
    [query, queryClient]
  );
  const remove = useMutation(
    query.keys.delete.mutationOptions({ onSettled: refresh })
  );
  const { mutate } = remove;
  const removeKey = useCallback(
    (id: ProviderKey["id"]) => mutate({ id }),
    [mutate]
  );

  return (
    <div className="flex flex-col gap-8">
      <QueryState query={keys}>
        {(list) => {
          // `list` can include keys the caller merely sees (instance keys);
          // show this owner's, plus config keys for context.
          const own = list.filter(
            (key) =>
              key.source === "config" ||
              ("id" in key.scope && key.scope.id === owner.id)
          );
          return own.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyRoundIcon />
                </EmptyMedia>
                <EmptyTitle>
                  <Trans>No keys yet</Trans>
                </EmptyTitle>
                <EmptyDescription>
                  <Trans>
                    Add a key below to use a provider's models with your own
                    account.
                  </Trans>
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Trans>Provider</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Label</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Key</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans>Last used</Trans>
                  </TableHead>
                  <TableHead className="text-end">
                    <span className="sr-only">
                      <Trans>Actions</Trans>
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {own.map((key) => (
                  <KeyRow key={key.id} onRemove={removeKey} providerKey={key} />
                ))}
              </TableBody>
            </Table>
          );
        }}
      </QueryState>
      {remove.isError ? (
        <p className="text-destructive text-sm" role="alert">
          <Trans>That key couldn't be removed. Try again.</Trans>
        </p>
      ) : null}
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">
          <Trans>Add a key</Trans>
        </h2>
        <AddKeyForm onAdded={refresh} owner={owner} />
      </section>
    </div>
  );
};
