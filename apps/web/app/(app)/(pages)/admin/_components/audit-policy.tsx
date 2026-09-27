"use client";

import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrgId } from "@workspace/contract/schemas/common";
import type { OrgPolicyView } from "@workspace/contract/schemas/tenancy";
import { EyeIcon } from "@workspace/icons";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Switch } from "@workspace/ui/components/switch";
import { useCallback } from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { QueryState } from "@/app/(app)/_shared/query-state";
import { Adjustments, LockedBadge } from "./org-policy-form";

// The org audit policy (D17): off by default, switched on only by an owner,
// forbidden outright if the instance config says so, and never silent:
// members see a notice in every chat it covers. The copy here says exactly
// that before anyone flips it.

const AuditSwitch = ({
  isOwner,
  orgId,
  view,
}: {
  readonly isOwner: boolean;
  readonly orgId: OrgId;
  readonly view: OrgPolicyView;
}) => {
  const { query } = useApi();
  const queryClient = useQueryClient();
  const save = useMutation(
    query.orgs.updatePolicy.mutationOptions({
      onSuccess: (saved) =>
        queryClient.setQueryData(
          query.orgs.getPolicy.queryKey({ input: { id: orgId } }),
          saved
        ),
    })
  );
  const forbidden = view.limits.auditPolicy === "forbidden";
  const { mutate } = save;
  const toggle = useCallback(
    (enabled: boolean) =>
      mutate({ id: orgId, policy: { ...view.stored, auditEnabled: enabled } }),
    [mutate, orgId, view.stored]
  );
  const on = save.isPending
    ? save.variables.policy.auditEnabled
    : view.effective.auditEnabled;

  return (
    <div className="flex flex-col gap-6">
      <Field data-disabled={forbidden || undefined} orientation="horizontal">
        <Switch
          checked={on && !forbidden}
          disabled={forbidden || !isOwner || save.isPending}
          id="audit-policy"
          onCheckedChange={toggle}
        />
        <FieldContent>
          <FieldLabel htmlFor="audit-policy">
            <Trans>Let admins read chats in this org</Trans>
            {forbidden ? <LockedBadge /> : null}
          </FieldLabel>
          <FieldDescription>
            <Trans>
              Covers chats held in this org's contexts (the org and its teams).
              Personal chats are never covered.
            </Trans>
          </FieldDescription>
        </FieldContent>
      </Field>
      <Alert>
        <EyeIcon />
        <AlertTitle>
          <Trans>Members are told</Trans>
        </AlertTitle>
        <AlertDescription>
          <Trans>
            While this is on, every member sees “Admins of this org can read
            this chat” on the chats it covers, and when picking a team or org
            context. Admins always see usage and metadata; only this policy lets
            them see content.
          </Trans>
        </AlertDescription>
      </Alert>
      {isOwner || forbidden ? null : (
        <p className="text-muted-foreground text-sm">
          <Trans>Only the org's owners can change this.</Trans>
        </p>
      )}
      {forbidden ? (
        <p className="text-muted-foreground text-sm">
          <Trans>
            This server's configuration forbids audit policies, so admins can't
            read chat content in any org.
          </Trans>
        </p>
      ) : null}
      <Adjustments
        adjustments={view.adjustments.filter(
          (adjustment) => adjustment.field === "auditEnabled"
        )}
      />
      {save.isError ? (
        <p className="text-destructive text-sm" role="alert">
          <Trans>The audit policy couldn't be changed. Try again.</Trans>
        </p>
      ) : null}
    </div>
  );
};

export const AuditPolicy = ({ orgId }: { readonly orgId: OrgId }) => {
  const { query } = useApi();
  const policy = useQuery(
    query.orgs.getPolicy.queryOptions({ input: { id: orgId } })
  );
  const org = useQuery(query.orgs.get.queryOptions({ input: { id: orgId } }));
  return (
    <QueryState query={policy} skeleton={2}>
      {(view) => (
        <AuditSwitch
          isOwner={org.data?.myRole === "owner"}
          orgId={orgId}
          view={view}
        />
      )}
    </QueryState>
  );
};
