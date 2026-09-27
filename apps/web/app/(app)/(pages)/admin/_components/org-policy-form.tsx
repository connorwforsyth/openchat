"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrgId } from "@workspace/contract/schemas/common";
import type {
  ChatContextType,
  OrgPolicy,
  OrgPolicyView,
  PolicyAdjustment,
  PublishGate,
} from "@workspace/contract/schemas/tenancy";
import { LockIcon } from "@workspace/icons";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field";
import {
  RadioGroup,
  RadioGroupItem,
} from "@workspace/ui/components/radio-group";
import { Switch } from "@workspace/ui/components/switch";
import { type ReactNode, useCallback, useState } from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { QueryState } from "@/app/(app)/_shared/query-state";
import { type Lock, policyFormState, toggleContext } from "./policy-state";

// Org policies within the instance limits (D18). The org's choices are stored
// as given; what the instance config forbids shows locked, and the preview
// runs the same clamp the server does, so "what applies" is never a surprise.

export const LockedBadge = () => (
  <Badge variant="secondary">
    <LockIcon data-icon="inline-start" />
    <Trans>Locked by server config</Trans>
  </Badge>
);

const AdjustmentText = ({
  field,
}: {
  readonly field: PolicyAdjustment["field"];
}) => {
  switch (field) {
    case "auditEnabled":
      return <Trans>The audit policy is off: this server forbids it.</Trans>;
    case "chatContexts":
      return (
        <Trans>
          Some chat contexts aren't allowed on this server and are left out.
        </Trans>
      );
    case "personalKeyFallback":
      return (
        <Trans>Personal key fallback is off: this server forbids it.</Trans>
      );
    case "publishGate":
      return (
        <Trans>
          That publish gate isn't allowed here; the server default applies.
        </Trans>
      );
    case "sampledScoring":
      return <Trans>Sampled scoring is off: this server forbids it.</Trans>;
    default:
      return field satisfies never;
  }
};

/** Adjustments the server (or the preview) made, as a list people can act on. */
export const Adjustments = ({
  adjustments,
}: {
  readonly adjustments: readonly PolicyAdjustment[];
}) =>
  adjustments.length === 0 ? null : (
    <Alert>
      <LockIcon />
      <AlertTitle>
        <Trans>Some choices don't apply on this server</Trans>
      </AlertTitle>
      <AlertDescription>
        <ul className="list-disc ps-4">
          {adjustments.map((adjustment) => (
            <li key={adjustment.field}>
              <AdjustmentText field={adjustment.field} />
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );

const ToggleRow = ({
  checked,
  description,
  id,
  label,
  lock,
  onChange,
}: {
  readonly checked: boolean;
  readonly description: ReactNode;
  readonly id: string;
  readonly label: ReactNode;
  readonly lock: Lock;
  readonly onChange: (checked: boolean) => void;
}) => (
  <Field data-disabled={lock !== "open" || undefined} orientation="horizontal">
    <Switch
      checked={lock === "open" ? checked : lock === "locked_on"}
      disabled={lock !== "open"}
      id={id}
      onCheckedChange={onChange}
    />
    <FieldContent>
      <FieldLabel htmlFor={id}>
        {label}
        {lock === "open" ? null : <LockedBadge />}
      </FieldLabel>
      <FieldDescription>{description}</FieldDescription>
    </FieldContent>
  </Field>
);

const ContextToggle = ({
  draft,
  lock,
  onChange,
  type,
}: {
  readonly draft: OrgPolicy;
  readonly lock: Lock;
  readonly onChange: (next: OrgPolicy) => void;
  readonly type: ChatContextType;
}) => {
  const toggle = useCallback(
    (on: boolean) => onChange(toggleContext(draft, type, on)),
    [draft, onChange, type]
  );
  const labels: Record<ChatContextType, ReactNode> = {
    org: <Trans>Org</Trans>,
    personal: <Trans>Personal</Trans>,
    team: <Trans>Team</Trans>,
  };
  const descriptions: Record<ChatContextType, ReactNode> = {
    org: (
      <Trans>
        Chats paid for by the org and visible to its admins' usage reports.
      </Trans>
    ),
    personal: <Trans>Chats on the member's own keys and budget.</Trans>,
    team: (
      <Trans>Chats paid for by a team; usage rolls up to parent teams.</Trans>
    ),
  };
  return (
    <ToggleRow
      checked={draft.chatContexts.includes(type)}
      description={descriptions[type]}
      id={`context-${type}`}
      label={labels[type]}
      lock={lock}
      onChange={toggle}
    />
  );
};

const PolicyForm = ({
  orgId,
  view,
}: {
  readonly orgId: OrgId;
  readonly view: OrgPolicyView;
}) => {
  const { t } = useLingui();
  const { query } = useApi();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<OrgPolicy>(view.stored);
  const state = policyFormState(draft, view.limits);
  const save = useMutation(
    query.orgs.updatePolicy.mutationOptions({
      onSuccess: (saved) => {
        queryClient.setQueryData(
          query.orgs.getPolicy.queryKey({ input: { id: orgId } }),
          saved
        );
      },
    })
  );
  const { mutate } = save;
  const dirty = JSON.stringify(draft) !== JSON.stringify(view.stored);

  const set = useCallback(
    <K extends keyof OrgPolicy>(key: K) =>
      (value: OrgPolicy[K]) =>
        setDraft((current) => ({ ...current, [key]: value })),
    []
  );
  const onGate = useCallback((value: unknown) => {
    if (value === "informational" || value === "no-regressions") {
      setDraft((current) => ({ ...current, publishGate: value }));
    }
  }, []);
  const submit = useCallback(
    () => mutate({ id: orgId, policy: draft }),
    [draft, mutate, orgId]
  );
  const gates: readonly [PublishGate, ReactNode, ReactNode][] = [
    [
      "informational",
      <Trans key="label">Informational</Trans>,
      <Trans key="description">
        Eval results are shown; publishing is never blocked.
      </Trans>,
    ],
    [
      "no-regressions",
      <Trans key="label">No regressions</Trans>,
      <Trans key="description">
        Publishing is blocked when evals regress.
      </Trans>,
    ],
  ];

  return (
    <div className="flex flex-col gap-8">
      <FieldSet>
        <FieldLegend>
          <Trans>Chat contexts</Trans>
        </FieldLegend>
        <FieldDescription>
          <Trans>
            Where members of this org may hold chats. The context decides whose
            keys pay and where usage counts.
          </Trans>
        </FieldDescription>
        <FieldGroup>
          {(["personal", "team", "org"] as const).map((type) => (
            <ContextToggle
              draft={draft}
              key={type}
              lock={state.chatContexts[type]}
              onChange={setDraft}
              type={type}
            />
          ))}
        </FieldGroup>
      </FieldSet>
      <FieldSet>
        <FieldLegend>
          <Trans>Keys and scoring</Trans>
        </FieldLegend>
        <FieldGroup>
          <ToggleRow
            checked={draft.personalKeyFallback}
            description={
              <Trans>
                When a team or org chat has no key of its own, use the member's
                personal key.
              </Trans>
            }
            id="personal-key-fallback"
            label={<Trans>Fall back to personal keys</Trans>}
            lock={state.personalKeyFallback}
            onChange={set("personalKeyFallback")}
          />
          <ToggleRow
            checked={draft.sampledScoring}
            description={
              <Trans>
                Score a sample of this org's chats to catch quality drops.
              </Trans>
            }
            id="sampled-scoring"
            label={<Trans>Sampled scoring</Trans>}
            lock={state.sampledScoring}
            onChange={set("sampledScoring")}
          />
        </FieldGroup>
      </FieldSet>
      <FieldSet>
        <FieldLegend>
          <Trans>Publish gate</Trans>
        </FieldLegend>
        <FieldDescription>
          <Trans>
            What happens when an agent is published to this org's library.
          </Trans>
        </FieldDescription>
        <RadioGroup
          aria-label={t`Publish gate`}
          onValueChange={onGate}
          value={draft.publishGate}
        >
          {gates.map(([gate, label, description]) => (
            <Field
              data-disabled={state.publishGate[gate] !== "open" || undefined}
              key={gate}
              orientation="horizontal"
            >
              <RadioGroupItem
                disabled={state.publishGate[gate] !== "open"}
                id={`gate-${gate}`}
                value={gate}
              />
              <FieldContent>
                <FieldLabel htmlFor={`gate-${gate}`}>
                  {label}
                  {state.publishGate[gate] === "open" ? null : <LockedBadge />}
                </FieldLabel>
                <FieldDescription>{description}</FieldDescription>
              </FieldContent>
            </Field>
          ))}
        </RadioGroup>
      </FieldSet>
      <Adjustments adjustments={state.adjustments} />
      {save.isError ? (
        <p className="text-destructive text-sm" role="alert">
          <Trans>The policy couldn't be saved. Try again.</Trans>
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button disabled={!dirty || save.isPending} onClick={submit}>
          <Trans>Save policy</Trans>
        </Button>
        {save.isSuccess && !dirty ? (
          <span aria-live="polite" className="text-muted-foreground text-sm">
            <Trans>Saved</Trans>
          </span>
        ) : null}
      </div>
    </div>
  );
};

export const OrgPolicyForm = ({ orgId }: { readonly orgId: OrgId }) => {
  const { query } = useApi();
  const policy = useQuery(
    query.orgs.getPolicy.queryOptions({ input: { id: orgId } })
  );
  return (
    <QueryState query={policy} skeleton={5}>
      {(view) => <PolicyForm orgId={orgId} view={view} />}
    </QueryState>
  );
};
