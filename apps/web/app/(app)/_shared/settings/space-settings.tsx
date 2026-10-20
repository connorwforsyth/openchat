"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrgId, UserId } from "@workspace/contract/schemas/common";
import type {
  AllowanceGrant,
  Space,
  SpaceAllowance as SpaceAllowanceView,
  SpaceMember,
  SpaceRole,
} from "@workspace/contract/schemas/spaces";
import { CheckIcon, LayersIcon, Trash2Icon, XIcon } from "@workspace/icons";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useMemo,
  useState,
} from "react";

import { MembersAdmin } from "@/app/(app)/(pages)/admin/_components/members-admin";
import { formatMicros } from "@/app/(app)/(pages)/admin/_components/money";
import { useApi } from "../api";
import { KeysManager } from "../keys-manager";
import { type Option, OptionSelect } from "../option-select";
import { withDepth } from "../spaces/active-space";
import { useActiveSpace } from "../spaces/space-switcher";

// Space settings (187), inside the settings view (185): members and roles,
// sub-spaces, the token allowance and its requests, and keys with their
// usage. Every section manages the active space (the sidebar switcher's).

const refOf = (space: Space) =>
  ({ id: space.id, type: space.type }) as { id: OrgId; type: "org" | "team" };

/** The active space, or a note when it's the personal one. */
const useManagedSpace = () => {
  const { active, spaces, setActive } = useActiveSpace();
  return { active: active?.isPersonal ? undefined : active, setActive, spaces };
};

const NoSpace = () => (
  <p className="text-muted-foreground text-sm">
    <Trans>
      Pick a space in the sidebar's space switcher. Your personal space has no
      members or allowance.
    </Trans>
  </p>
);

const RoleBadge = ({ role }: { readonly role: SpaceRole }) => {
  switch (role) {
    case "owner":
      return <Badge>{<Trans>Owner</Trans>}</Badge>;
    case "admin":
      return <Badge variant="secondary">{<Trans>Admin</Trans>}</Badge>;
    case "member":
      return <Badge variant="outline">{<Trans>Member</Trans>}</Badge>;
    default: {
      const unreachable: never = role;
      return unreachable;
    }
  }
};

// --- Members ---

const useRefreshSpaces = () => {
  const { query } = useApi();
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: query.spaces.key() }),
    [queryClient, query]
  );
};

/** The number in what someone typed ("1,000,000" too); `null` for none. */
const tokensIn = (text: string): number | null => {
  const value = Number.parseInt(text.replaceAll(/[^\d]/g, ""), 10);
  return Number.isNaN(value) ? null : value;
};

const MemberRow = ({
  member,
  onRemove,
  onRole,
  roles,
  space,
}: {
  readonly member: SpaceMember;
  readonly onRemove: (userId: UserId) => void;
  readonly onRole: (userId: UserId, role: SpaceRole) => void;
  readonly roles: readonly Option<SpaceRole>[];
  readonly space: Space;
}) => {
  const { t } = useLingui();
  const changeRole = useCallback(
    (role: SpaceRole) => onRole(member.user.id, role),
    [member.user.id, onRole]
  );
  const remove = useCallback(
    () => onRemove(member.user.id),
    [member.user.id, onRemove]
  );
  return (
    <TableRow data-testid="space-member">
      <TableCell className="font-medium">{member.user.name}</TableCell>
      <TableCell className="text-muted-foreground">
        {member.user.email}
      </TableCell>
      <TableCell>
        {space.canManage ? (
          <OptionSelect
            className="w-32"
            label={t`Role for ${member.user.name}`}
            onChange={changeRole}
            options={roles}
            value={member.role}
          />
        ) : (
          <RoleBadge role={member.role} />
        )}
      </TableCell>
      {space.canManage ? (
        <TableCell className="text-end">
          <Button
            aria-label={t`Remove ${member.user.name}`}
            onClick={remove}
            size="icon-sm"
            variant="ghost"
          >
            <Trash2Icon />
          </Button>
        </TableCell>
      ) : null}
    </TableRow>
  );
};

const SubSpaceMembers = ({ space }: { readonly space: Space }) => {
  const { t } = useLingui();
  const { query } = useApi();
  const refresh = useRefreshSpaces();
  const ref = refOf(space);
  const members = useQuery(query.spaces.members.queryOptions({ input: ref }));
  const rootMembers = useQuery(
    query.spaces.members.queryOptions({
      input: { id: space.orgId, type: "org" },
    })
  );
  const setMember = useMutation(
    query.spaces.setMember.mutationOptions({ onSuccess: refresh })
  );
  const removeMember = useMutation(
    query.spaces.removeMember.mutationOptions({ onSuccess: refresh })
  );
  const [adding, setAdding] = useState<string>("");
  const [addRole, setAddRole] = useState<SpaceRole>("member");
  const onRole = useCallback(
    (userId: UserId, role: SpaceRole) =>
      setMember.mutate({ ...ref, role, userId }),
    [ref, setMember]
  );
  const onRemove = useCallback(
    (userId: UserId) => removeMember.mutate({ ...ref, userId }),
    [ref, removeMember]
  );
  const inSpace = new Set((members.data ?? []).map((m) => m.user.id));
  const candidates: readonly Option<string>[] = (rootMembers.data ?? [])
    .filter((m) => !inSpace.has(m.user.id))
    .map((m) => ({ label: m.user.name, value: m.user.id }));
  const roles: readonly Option<SpaceRole>[] = [
    { label: t`Member`, value: "member" },
    { label: t`Owner`, value: "owner" },
  ];
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (adding) {
      setMember.mutate({ ...ref, role: addRole, userId: adding as UserId });
      setAdding("");
    }
  };
  return (
    <div className="flex flex-col gap-6">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Trans>Name</Trans>
            </TableHead>
            <TableHead>
              <Trans>Email</Trans>
            </TableHead>
            <TableHead>
              <Trans>Role</Trans>
            </TableHead>
            {space.canManage ? (
              <TableHead className="text-end">
                <span className="sr-only">
                  <Trans>Actions</Trans>
                </span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {(members.data ?? []).map((m) => (
            <MemberRow
              key={m.user.id}
              member={m}
              onRemove={onRemove}
              onRole={onRole}
              roles={roles}
              space={space}
            />
          ))}
        </TableBody>
      </Table>
      {space.canManage ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={add}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="space-add-member">
              <Trans>Add someone from the space above</Trans>
            </Label>
            <OptionSelect
              className="w-56"
              disabled={candidates.length === 0}
              id="space-add-member"
              onChange={setAdding}
              options={
                candidates.length === 0
                  ? [{ label: t`Everyone is already here`, value: "" }]
                  : [{ label: t`Choose a person`, value: "" }, ...candidates]
              }
              value={adding}
            />
          </div>
          <OptionSelect
            className="w-32"
            label={t`Role`}
            onChange={setAddRole}
            options={roles}
            value={addRole}
          />
          <Button disabled={!adding} type="submit">
            <Trans>Add</Trans>
          </Button>
        </form>
      ) : null}
    </div>
  );
};

export const SpaceMembers = () => {
  const { active } = useManagedSpace();
  if (!active) {
    return <NoSpace />;
  }
  // A root space's members are its org's, with invitations (012).
  return active.type === "org" && active.canManage ? (
    <MembersAdmin orgId={active.id as OrgId} />
  ) : (
    <SubSpaceMembers space={active} />
  );
};

// --- Sub-spaces ---

const SubSpaceRow = ({
  depth,
  onSwitch,
  space,
}: {
  readonly depth: number;
  readonly onSwitch: (space: Space) => void;
  readonly space: Space;
}) => {
  const { t } = useLingui();
  const switchTo = useCallback(() => onSwitch(space), [onSwitch, space]);
  return (
    <li
      className="flex items-center gap-3 px-3 py-2.5"
      data-testid="sub-space"
      style={{ paddingInlineStart: `${0.75 + depth * 1.25}rem` }}
    >
      <LayersIcon
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="font-medium text-sm">{space.name}</span>
      <span className="text-muted-foreground text-xs">
        {t`${space.memberCount} members`}
      </span>
      {space.myRole ? <RoleBadge role={space.myRole} /> : null}
      <Button className="ms-auto" onClick={switchTo} size="sm" variant="ghost">
        <Trans>Switch to</Trans>
      </Button>
    </li>
  );
};

/** The spaces below `active` in an outline, with depths from just below it. */
const spacesBelow = (spaces: readonly Space[], active: Space) => {
  const outline = withDepth(spaces);
  const start = outline.findIndex(
    (each) => each.space.id === active.id && each.space.type === active.type
  );
  const base = outline[start]?.depth ?? 0;
  const rest = outline.slice(start + 1);
  const end = rest.findIndex((each) => each.depth <= base);
  return (end === -1 ? rest : rest.slice(0, end)).map((each) => ({
    ...each,
    depth: each.depth - base - 1,
  }));
};

export const SubSpaces = () => {
  const { t } = useLingui();
  const { query } = useApi();
  const refresh = useRefreshSpaces();
  const { active, setActive, spaces } = useManagedSpace();
  const [name, setName] = useState("");
  const create = useMutation(
    query.spaces.createChild.mutationOptions({ onSuccess: refresh })
  );
  const typeName = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setName(event.target.value),
    []
  );
  const below = useMemo(
    () => (active ? spacesBelow(spaces, active) : []),
    [active, spaces]
  );
  if (!active) {
    return <NoSpace />;
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) {
      create.mutate({ ...refOf(active), name: name.trim() });
      setName("");
    }
  };
  return (
    <div className="flex flex-col gap-6">
      {below.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          <Trans>{active.name} has no sub-spaces yet.</Trans>
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {below.map(({ depth, space }) => (
            <SubSpaceRow
              depth={depth}
              key={space.id}
              onSwitch={setActive}
              space={space}
            />
          ))}
        </ul>
      )}
      {active.canManage ? (
        <form className="flex items-end gap-2" onSubmit={submit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-sub-space">
              <Trans>New sub-space in {active.name}</Trans>
            </Label>
            <Input
              className="w-64"
              id="new-sub-space"
              onChange={typeName}
              placeholder={t`Name`}
              value={name}
            />
          </div>
          <Button disabled={!name.trim()} type="submit">
            <Trans>Create</Trans>
          </Button>
        </form>
      ) : null}
    </div>
  );
};

// --- Allowance ---

const StatusBadge = ({
  status,
}: {
  readonly status: AllowanceGrant["status"];
}) => {
  switch (status) {
    case "approved":
      return <Badge>{<Trans>Approved</Trans>}</Badge>;
    case "pending":
      return (
        <Badge variant="secondary">{<Trans>Waiting for an owner</Trans>}</Badge>
      );
    case "denied":
      return <Badge variant="outline">{<Trans>Denied</Trans>}</Badge>;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
};

const Meter = ({
  used,
  total,
}: {
  readonly total: number;
  readonly used: number;
}) => {
  const share = total > 0 ? Math.min(1, used / total) : 0;
  return (
    <div
      aria-hidden
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className="h-full origin-left bg-primary"
        style={{ transform: `scaleX(${share})` }}
      />
    </div>
  );
};

type SpaceRefInput = ReturnType<typeof refOf>;

const PoolCard = ({
  allowance,
  space,
  spaceRef,
}: {
  readonly allowance: SpaceAllowanceView | undefined;
  readonly space: Space;
  readonly spaceRef: SpaceRefInput;
}) => {
  const { t, i18n } = useLingui();
  const { query } = useApi();
  const refresh = useRefreshSpaces();
  const setPool = useMutation(
    query.spaces.setAllowance.mutationOptions({ onSuccess: refresh })
  );
  const [pool, setPoolInput] = useState("");
  const typePool = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setPoolInput(event.target.value),
    []
  );
  const n = (value: number) => i18n.number(value);
  const total = allowance?.monthlyTokens ?? null;
  const used = allowance?.usedTokens ?? 0;
  const resets = allowance
    ? i18n.date(new Date(allowance.resetsAt), { dateStyle: "medium" })
    : "";
  const remaining = n(allowance?.myRemainingTokens ?? 0);
  const save = (event: FormEvent) => {
    event.preventDefault();
    setPool.mutate({ ...spaceRef, monthlyTokens: tokensIn(pool) });
    setPoolInput("");
  };
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-medium">
          <Trans>This month</Trans>
        </h2>
        {total === null ? (
          <span className="text-muted-foreground text-sm">
            <Trans>No allowance set</Trans>
          </span>
        ) : (
          <span className="text-sm" data-testid="allowance-used">
            <Trans>
              {n(used)} of {n(total)} tokens used
            </Trans>
          </span>
        )}
      </div>
      {total === null ? null : <Meter total={total} used={used} />}
      <p className="text-muted-foreground text-sm">
        <Trans>
          You can use {remaining} more tokens here this month. Resets {resets}.
        </Trans>
      </p>
      {space.canManage ? (
        <form className="flex items-end gap-2" onSubmit={save}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="space-pool">
              <Trans>Monthly token pool for {space.name}</Trans>
            </Label>
            <Input
              className="w-48"
              id="space-pool"
              inputMode="numeric"
              onChange={typePool}
              placeholder={total === null ? t`e.g. 1000000` : n(total)}
              value={pool}
            />
          </div>
          <Button type="submit" variant="outline">
            <Trans>Save</Trans>
          </Button>
        </form>
      ) : null}
    </section>
  );
};

const RequestRow = ({
  grant,
  onDecide,
}: {
  readonly grant: AllowanceGrant;
  readonly onDecide: (grantId: string, decision: "approved" | "denied") => void;
}) => {
  const { i18n } = useLingui();
  const approve = useCallback(
    () => onDecide(grant.id, "approved"),
    [grant.id, onDecide]
  );
  const deny = useCallback(
    () => onDecide(grant.id, "denied"),
    [grant.id, onDecide]
  );
  const tokens = i18n.number(grant.monthlyTokens);
  return (
    <li
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
      data-testid="allowance-request"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium text-sm">
          <Trans>
            {grant.user.name} asks for {tokens} tokens a month
          </Trans>
        </span>
        {grant.note ? (
          <span className="text-muted-foreground text-sm">{grant.note}</span>
        ) : null}
      </div>
      <Button onClick={approve} size="sm">
        <CheckIcon />
        <Trans>Approve</Trans>
      </Button>
      <Button onClick={deny} size="sm" variant="outline">
        <XIcon />
        <Trans>Deny</Trans>
      </Button>
    </li>
  );
};

const Requests = ({
  grants,
  spaceRef,
}: {
  readonly grants: readonly AllowanceGrant[];
  readonly spaceRef: SpaceRefInput;
}) => {
  const { i18n } = useLingui();
  const { query } = useApi();
  const refresh = useRefreshSpaces();
  const decide = useMutation(
    query.spaces.decideAllowance.mutationOptions({ onSuccess: refresh })
  );
  const onDecide = useCallback(
    (grantId: string, decision: "approved" | "denied") =>
      decide.mutate({ ...spaceRef, decision, grantId }),
    [decide, spaceRef]
  );
  const pending = grants.filter((g) => g.status === "pending");
  const decided = grants.filter((g) => g.status !== "pending");
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">
        <Trans>Requests</Trans>
      </h2>
      {pending.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          <Trans>Nobody is waiting.</Trans>
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pending.map((grant) => (
            <RequestRow grant={grant} key={grant.id} onDecide={onDecide} />
          ))}
        </ul>
      )}
      {decided.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Trans>Member</Trans>
              </TableHead>
              <TableHead>
                <Trans>Monthly grant</Trans>
              </TableHead>
              <TableHead>
                <Trans>Used</Trans>
              </TableHead>
              <TableHead>
                <Trans>Status</Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {decided.map((grant) => (
              <TableRow key={grant.id}>
                <TableCell className="font-medium">{grant.user.name}</TableCell>
                <TableCell>{i18n.number(grant.monthlyTokens)}</TableCell>
                <TableCell>{i18n.number(grant.usedTokens)}</TableCell>
                <TableCell>
                  <StatusBadge status={grant.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </section>
  );
};

const MyAllowance = ({
  grant,
  space,
  spaceRef,
}: {
  readonly grant: AllowanceGrant | undefined;
  readonly space: Space;
  readonly spaceRef: SpaceRefInput;
}) => {
  const { i18n } = useLingui();
  const { query } = useApi();
  const refresh = useRefreshSpaces();
  const ask = useMutation(
    query.spaces.requestAllowance.mutationOptions({ onSuccess: refresh })
  );
  const [request, setRequest] = useState("");
  const [note, setNote] = useState("");
  const typeRequest = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setRequest(event.target.value),
    []
  );
  const typeNote = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setNote(event.target.value),
    []
  );
  const send = (event: FormEvent) => {
    event.preventDefault();
    const value = tokensIn(request);
    if (value !== null && value > 0) {
      ask.mutate({ ...spaceRef, monthlyTokens: value, note });
      setRequest("");
      setNote("");
    }
  };
  const tokens = grant ? i18n.number(grant.monthlyTokens) : "";
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium">
        <Trans>Your allowance</Trans>
      </h2>
      {grant ? (
        <div className="flex items-center gap-3 text-sm">
          <span>
            <Trans>{tokens} tokens a month</Trans>
          </span>
          <StatusBadge status={grant.status} />
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          <Trans>
            You haven't asked yet. An owner of {space.name} decides.
          </Trans>
        </p>
      )}
      {space.access === "root_member" ? null : (
        <form className="flex flex-wrap items-end gap-2" onSubmit={send}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="allowance-request">
              <Trans>Tokens a month</Trans>
            </Label>
            <Input
              className="w-40"
              id="allowance-request"
              inputMode="numeric"
              onChange={typeRequest}
              value={request}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="allowance-note">
              <Trans>What for</Trans>
            </Label>
            <Input
              className="w-64"
              id="allowance-note"
              onChange={typeNote}
              value={note}
            />
          </div>
          <Button disabled={!request} type="submit">
            {grant ? <Trans>Ask again</Trans> : <Trans>Ask</Trans>}
          </Button>
        </form>
      )}
    </section>
  );
};

export const SpaceAllowance = () => {
  const { query } = useApi();
  const { active } = useManagedSpace();
  const spaceRef = active ? refOf(active) : null;
  const allowance = useQuery({
    ...query.spaces.allowance.queryOptions({
      input: spaceRef ?? { id: "" as OrgId, type: "org" },
    }),
    enabled: spaceRef !== null,
  });
  if (!(active && spaceRef)) {
    return <NoSpace />;
  }
  const { data } = allowance;
  return (
    <div className="flex flex-col gap-8">
      <PoolCard allowance={data} space={active} spaceRef={spaceRef} />
      {active.canManage ? (
        <Requests grants={data?.grants ?? []} spaceRef={spaceRef} />
      ) : (
        // Members get only their own grant back.
        <MyAllowance
          grant={data?.grants[0]}
          space={active}
          spaceRef={spaceRef}
        />
      )}
    </div>
  );
};

// --- Keys and usage ---

export const SpaceKeys = () => {
  const { i18n } = useLingui();
  const { query } = useApi();
  const { active } = useManagedSpace();
  const ref = active ? refOf(active) : null;
  const usage = useQuery({
    ...query.spaces.keyUsage.queryOptions({
      input: ref ?? { id: "" as OrgId, type: "org" },
    }),
    enabled: ref !== null && (active?.canManage ?? false),
  });
  if (!(active && ref)) {
    return <NoSpace />;
  }
  if (!active.canManage) {
    return (
      <p className="text-muted-foreground text-sm">
        <Trans>Only owners of {active.name} manage its keys.</Trans>
      </p>
    );
  }
  const rows = usage.data?.rows ?? [];
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">
          <Trans>Usage by key this month</Trans>
        </h2>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            <Trans>No keys in {active.name} yet. Add one below.</Trans>
          </p>
        ) : (
          <Table data-testid="key-usage">
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Trans>Key</Trans>
                </TableHead>
                <TableHead>
                  <Trans>Added by</Trans>
                </TableHead>
                <TableHead className="text-end">
                  <Trans>Calls</Trans>
                </TableHead>
                <TableHead className="text-end">
                  <Trans>Tokens</Trans>
                </TableHead>
                <TableHead className="text-end">
                  <Trans>Cost</Trans>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.keyId ?? "unattributed"}>
                  <TableCell>
                    {row.keyId ? (
                      <div className="flex flex-col">
                        <span className="font-medium">{row.label}</span>
                        <span className="text-muted-foreground text-xs">
                          {row.provider} ···{row.hint}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">
                        <Trans>Unattributed (before per-key tracking)</Trans>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.createdBy?.name ?? ""}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {i18n.number(row.transactions)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {i18n.number(row.tokens)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatMicros(row.costMicros, i18n.locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">
          <Trans>Keys</Trans>
        </h2>
        <KeysManager key={active.id} owner={ref} />
      </section>
    </div>
  );
};
