"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { OrgId } from "@workspace/contract/schemas/common";
import type {
  Invitation,
  OrgMember,
  OrgRole,
} from "@workspace/contract/schemas/tenancy";
import { formatDate } from "@workspace/i18n/format";
import { MailIcon, Trash2Icon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
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
import { type FormEvent, useCallback, useState } from "react";
import { z } from "zod";

import { useApi } from "../../_shared/api";
import { ConfirmButton } from "../../_shared/confirm";
import { type Option, OptionSelect } from "../../_shared/option-select";
import { codeOf, QueryState } from "../../_shared/query-state";

// Members and invitations (D17, D22). Better Auth's organization plugin is
// underneath; the API refuses what a role can't do (an admin making an owner,
// removing the last owner), and the page says why instead of guessing.

const useRoleOptions = (): readonly Option<OrgRole>[] => {
  const { t } = useLingui();
  return [
    { label: t`Owner`, value: "owner" },
    { label: t`Admin`, value: "admin" },
    { label: t`Member`, value: "member" },
  ];
};

const MemberRow = ({
  member,
  onRemove,
  onRole,
}: {
  readonly member: OrgMember;
  readonly onRemove: (member: OrgMember) => void;
  readonly onRole: (member: OrgMember, role: OrgRole) => void;
}) => {
  const { t } = useLingui();
  const roles = useRoleOptions();
  const { name } = member.user;
  const changeRole = useCallback(
    (role: OrgRole) => onRole(member, role),
    [member, onRole]
  );
  const remove = useCallback(() => onRemove(member), [member, onRemove]);
  return (
    <TableRow>
      <TableCell>
        <span className="flex flex-col">
          <span className="font-medium">{name}</span>
          <span className="text-muted-foreground text-xs">
            {member.user.email}
          </span>
        </span>
      </TableCell>
      <TableCell>
        <OptionSelect
          label={t`Role for ${name}`}
          onChange={changeRole}
          options={roles}
          value={member.role}
        />
      </TableCell>
      <TableCell className="text-end">
        <ConfirmButton
          confirmLabel={<Trans>Remove member</Trans>}
          description={
            <Trans>
              They lose access to this org's chats, library and keys. Their
              personal chats are untouched.
            </Trans>
          }
          label={t`Remove ${name}`}
          onConfirm={remove}
          title={<Trans>Remove {name} from this org?</Trans>}
        >
          <Trash2Icon />
        </ConfirmButton>
      </TableCell>
    </TableRow>
  );
};

const inviteSchema = z.object({ email: z.email() });

const InviteForm = ({
  onInvited,
  orgId,
}: {
  readonly onInvited: () => void;
  readonly orgId: OrgId;
}) => {
  const { t } = useLingui();
  const { query } = useApi();
  const roles = useRoleOptions();
  const [role, setRole] = useState<OrgRole>("member");
  const [problem, setProblem] = useState<
    "invalid" | "exists" | "failed" | null
  >(null);
  const invite = useMutation(query.orgs.invite.mutationOptions());
  const { mutate } = invite;
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const parsed = inviteSchema.safeParse(
        Object.fromEntries(new FormData(form))
      );
      if (!parsed.success) {
        setProblem("invalid");
        return;
      }
      setProblem(null);
      mutate(
        { email: parsed.data.email, orgId, role, teamIds: [] },
        {
          onError: (error) =>
            setProblem(codeOf(error) === "CONFLICT" ? "exists" : "failed"),
          onSuccess: () => {
            form.reset();
            onInvited();
          },
        }
      );
    },
    [mutate, onInvited, orgId, role]
  );
  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field className="flex-1">
            <FieldLabel htmlFor="invite-email">
              <Trans>Email</Trans>
            </FieldLabel>
            <Input
              autoComplete="off"
              id="invite-email"
              name="email"
              placeholder={t`name@example.com`}
              required
              type="email"
            />
          </Field>
          <Field className="sm:w-40">
            <FieldLabel htmlFor="invite-role">
              <Trans>Role</Trans>
            </FieldLabel>
            <OptionSelect
              id="invite-role"
              onChange={setRole}
              options={roles}
              value={role}
            />
          </Field>
          <Button disabled={invite.isPending} type="submit">
            <MailIcon data-icon="inline-start" />
            <Trans>Invite</Trans>
          </Button>
        </div>
        {problem ? (
          <FieldError>
            {problem === "invalid" ? (
              <Trans>Enter an email address.</Trans>
            ) : null}
            {problem === "exists" ? (
              <Trans>They're already a member or already invited.</Trans>
            ) : null}
            {problem === "failed" ? (
              <Trans>The invitation couldn't be sent. Try again.</Trans>
            ) : null}
          </FieldError>
        ) : null}
      </FieldGroup>
    </form>
  );
};

const InvitationRow = ({
  invitation,
  onCancel,
}: {
  readonly invitation: Invitation;
  readonly onCancel: (invitation: Invitation) => void;
}) => {
  const { i18n, t } = useLingui();
  const roles = useRoleOptions();
  const { email } = invitation;
  const cancel = useCallback(
    () => onCancel(invitation),
    [invitation, onCancel]
  );
  const expires = formatDate(invitation.expiresAt, i18n.locale);
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="min-w-0 flex-1 truncate">{email}</span>
      <span className="text-muted-foreground text-xs">
        {roles.find((each) => each.value === invitation.role)?.label}
      </span>
      <span className="text-muted-foreground text-xs">
        <Trans>Expires {expires}</Trans>
      </span>
      <Button
        aria-label={t`Cancel the invitation for ${email}`}
        onClick={cancel}
        size="sm"
        variant="ghost"
      >
        <Trans>Cancel</Trans>
      </Button>
    </li>
  );
};

export const MembersAdmin = ({ orgId }: { readonly orgId: OrgId }) => {
  const { query } = useApi();
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<"last_owner" | "failed" | null>(null);

  const members = useInfiniteQuery(
    query.orgs.members.infiniteOptions({
      getNextPageParam: (page) => page.nextCursor ?? undefined,
      initialPageParam: undefined as string | undefined,
      input: (cursor) => ({ cursor, limit: 50, orgId }),
    })
  );
  const invitations = useQuery(
    query.orgs.listInvitations.queryOptions({ input: { orgId } })
  );
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: query.orgs.key() }),
    [query, queryClient]
  );
  const onError = useCallback((error: Error) => {
    setProblem(codeOf(error) === "CONFLICT" ? "last_owner" : "failed");
  }, []);
  const updateMember = useMutation(
    query.orgs.updateMember.mutationOptions({ onError, onSettled: refresh })
  );
  const removeMember = useMutation(
    query.orgs.removeMember.mutationOptions({ onError, onSettled: refresh })
  );
  const cancelInvitation = useMutation(
    query.orgs.cancelInvitation.mutationOptions({ onSettled: refresh })
  );

  const { mutate: mutateRole } = updateMember;
  const { mutate: mutateRemove } = removeMember;
  const { mutate: mutateCancel } = cancelInvitation;
  const onRole = useCallback(
    (member: OrgMember, role: OrgRole) => {
      setProblem(null);
      mutateRole({ orgId, role, userId: member.user.id });
    },
    [mutateRole, orgId]
  );
  const onRemove = useCallback(
    (member: OrgMember) => {
      setProblem(null);
      mutateRemove({ orgId, userId: member.user.id });
    },
    [mutateRemove, orgId]
  );
  const onCancel = useCallback(
    (invitation: Invitation) => mutateCancel({ id: invitation.id, orgId }),
    [mutateCancel, orgId]
  );
  const fetchMore = useCallback(() => members.fetchNextPage(), [members]);
  const pending = (invitations.data ?? []).filter(
    (invitation) => invitation.status === "pending"
  );

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">
          <Trans>Invite someone</Trans>
        </h2>
        <InviteForm onInvited={refresh} orgId={orgId} />
        {pending.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {pending.map((invitation) => (
              <InvitationRow
                invitation={invitation}
                key={invitation.id}
                onCancel={onCancel}
              />
            ))}
          </ul>
        ) : null}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">
          <Trans>Members</Trans>
        </h2>
        {problem ? (
          <p className="text-destructive text-sm" role="alert">
            {problem === "last_owner" ? (
              <Trans>
                An org needs at least one owner. Make someone else an owner
                first.
              </Trans>
            ) : (
              <Trans>That change couldn't be saved. Try again.</Trans>
            )}
          </p>
        ) : null}
        {
          <QueryState query={members}>
            {(data) => (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <Trans>Name</Trans>
                    </TableHead>
                    <TableHead>
                      <Trans>Role</Trans>
                    </TableHead>
                    <TableHead className="text-end">
                      <span className="sr-only">
                        <Trans>Actions</Trans>
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.pages
                    .flatMap((page) => page.items)
                    .map((member) => (
                      <MemberRow
                        key={member.user.id}
                        member={member}
                        onRemove={onRemove}
                        onRole={onRole}
                      />
                    ))}
                </TableBody>
              </Table>
            )}
          </QueryState>
        }
        {members.hasNextPage ? (
          <Button
            disabled={members.isFetchingNextPage}
            onClick={fetchMore}
            variant="outline"
          >
            <Trans>Show more</Trans>
          </Button>
        ) : null}
      </section>
    </div>
  );
};
