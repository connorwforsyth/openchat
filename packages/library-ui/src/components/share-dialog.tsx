"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { GrantId, ShareLinkId } from "@workspace/contract/schemas/common";
import type {
  ResourceGrant,
  ResourceRef,
  ShareLink,
} from "@workspace/contract/schemas/grants";
import type {
  LibraryItem,
  LibraryPermission,
} from "@workspace/contract/schemas/library";
import type { Me } from "@workspace/contract/schemas/meta";
import type {
  Principal,
  UserSummary,
} from "@workspace/contract/schemas/tenancy";
import {
  CopyIcon,
  GlobeIcon,
  PlusIcon,
  UserIcon,
  UsersIcon,
  XIcon,
} from "@workspace/icons";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Separator } from "@workspace/ui/components/separator";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import { type ChangeEvent, useCallback, useState } from "react";

import {
  useCreateShareLink,
  useGrants,
  useMe,
  useOrgMembers,
  usePublicConfig,
  useRevokeGrant,
  useRevokeShareLink,
  useShare,
  useShareLinks,
  useUpdateGrant,
} from "../hooks";

// Share (D13): grant people, teams (and so their sub-teams) or orgs `use`,
// `view` or `edit`. The item stays the owner's; revoking takes it back.
// Changes apply at once and roll back if the server refuses (D28). Public
// links live here too, when the instance allows them.

interface Candidate {
  readonly label: string;
  readonly principal: Principal;
  readonly sublabel?: string;
}

const NO_PEOPLE: readonly UserSummary[] = [];
const MAX_MATCHES = 6;

const candidatesFrom = (
  me: Me | undefined,
  people: readonly UserSummary[]
): Candidate[] => {
  if (!me) {
    return [];
  }
  return [
    ...people
      .filter((person) => person.id !== me.user.id)
      .map(
        (person): Candidate => ({
          label: person.name,
          principal: { id: person.id, type: "user" },
          sublabel: person.email ?? undefined,
        })
      ),
    ...me.teams.map(
      ({ team }): Candidate => ({
        label: team.name,
        principal: { id: team.id, type: "team" },
      })
    ),
    ...me.orgs
      .filter((org) => !org.isPersonal)
      .map(
        (org): Candidate => ({
          label: org.name,
          principal: { id: org.id, type: "org" },
        })
      ),
  ];
};

const samePrincipal = (a: Principal, b: Principal) =>
  a.type === b.type && a.id === b.id;

/** Candidates matching `query` who don't have access yet. Pure. */
export const matchCandidates = (
  candidates: readonly Candidate[],
  grants: readonly ResourceGrant[],
  query: string
): Candidate[] => {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [];
  }
  return candidates
    .filter(
      (each) =>
        !grants.some((grant) =>
          samePrincipal(grant.principal, each.principal)
        ) &&
        (each.label.toLowerCase().includes(needle) ||
          each.sublabel?.toLowerCase().includes(needle))
    )
    .slice(0, MAX_MATCHES);
};

function LevelPicker({
  disabled,
  label,
  onChange,
  value,
}: {
  readonly disabled?: boolean;
  readonly label: string;
  readonly onChange: (level: LibraryPermission) => void;
  readonly value: LibraryPermission;
}) {
  const handleChange = useCallback(
    (values: string[]) => {
      const [next] = values;
      if (next === "use" || next === "view" || next === "edit") {
        onChange(next);
      }
    },
    [onChange]
  );
  return (
    <ToggleGroup
      aria-label={label}
      disabled={disabled}
      onValueChange={handleChange}
      size="sm"
      value={[value]}
      variant="outline"
    >
      <ToggleGroupItem value="use">
        <Trans>Use</Trans>
      </ToggleGroupItem>
      <ToggleGroupItem value="view">
        <Trans>View</Trans>
      </ToggleGroupItem>
      <ToggleGroupItem value="edit">
        <Trans>Edit</Trans>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export interface ShareDialogProps {
  readonly item: Pick<LibraryItem, "id" | "kind" | "myAccess" | "name">;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}

export function ShareDialog({ item, onOpenChange, open }: ShareDialogProps) {
  const { name } = item;
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>Share {name}</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              Use lets people chat with it. View also shows its instructions and
              lets them copy it. Edit lets them change it.
            </Trans>
          </DialogDescription>
        </DialogHeader>
        {open ? <ShareBody item={item} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ShareBody({ item }: { readonly item: ShareDialogProps["item"] }) {
  const { t } = useLingui();
  const ref = { resourceId: item.id, resourceType: item.kind } as ResourceRef;
  const manage = item.myAccess === "owner" || item.myAccess === "maintainer";
  const me = useMe();
  const orgIds = (me.data?.orgs ?? [])
    .filter((org) => !org.isPersonal)
    .map((org) => org.id);
  const people = useOrgMembers(orgIds);
  const grants = useGrants(ref);
  const share = useShare(ref, me.data?.user.id ?? null);
  const update = useUpdateGrant(ref);
  const revoke = useRevokeGrant(ref);
  const { mutate: shareWith } = share;
  const { mutate: updateGrant } = update;
  const { mutate: revokeGrant } = revoke;
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<LibraryPermission>("use");
  const failed = share.isError || update.isError || revoke.isError;

  const candidates = candidatesFrom(me.data, people.data ?? NO_PEOPLE);
  const current = grants.data ?? [];
  const matches = matchCandidates(candidates, current, query);
  const nameOf = (principal: Principal) =>
    candidates.find((each) => samePrincipal(each.principal, principal))
      ?.label ?? t`Someone`;

  const search = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      setQuery(event.currentTarget.value),
    []
  );
  const pick = useCallback(
    (principal: Principal) => {
      shareWith({ permission: level, principal });
      setQuery("");
    },
    [level, shareWith]
  );
  const changeLevel = useCallback(
    (id: GrantId, permission: LibraryPermission) =>
      updateGrant({ id, permission }),
    [updateGrant]
  );
  const remove = useCallback((id: GrantId) => revokeGrant(id), [revokeGrant]);

  return (
    <div className="flex flex-col gap-4">
      {manage ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={t`Find people, teams or orgs`}
              className="min-w-0 flex-1"
              onChange={search}
              placeholder={t`Add people, teams or orgs`}
              value={query}
            />
            <LevelPicker
              label={t`Level for new shares`}
              onChange={setLevel}
              value={level}
            />
          </div>
          {matches.length > 0 ? (
            <ul aria-label={t`Matches`} className="flex flex-col gap-1">
              {matches.map((candidate) => (
                <CandidateRow
                  candidate={candidate}
                  key={`${candidate.principal.type}:${candidate.principal.id}`}
                  onPick={pick}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {failed ? (
        <Alert variant="destructive">
          <AlertDescription>
            <Trans>That change didn't go through, so it was undone.</Trans>
          </AlertDescription>
        </Alert>
      ) : null}

      <section
        aria-label={t`People with access`}
        className="flex flex-col gap-2"
      >
        <h3 className="font-medium text-muted-foreground text-xs">
          <Trans>People with access</Trans>
        </h3>
        {current.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            <Trans>Only the owner, so far.</Trans>
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {current.map((grant) => (
              <GrantRow
                grant={grant}
                key={grant.id}
                manage={manage}
                name={nameOf(grant.principal)}
                onLevel={changeLevel}
                onRevoke={remove}
              />
            ))}
          </ul>
        )}
      </section>

      {manage ? <PublicLinks refToShare={ref} /> : null}
    </div>
  );
}

function PrincipalIcon({ principal }: { readonly principal: Principal }) {
  const Glyph = principal.type === "user" ? UserIcon : UsersIcon;
  return <Glyph className="text-muted-foreground" />;
}

function CandidateRow({
  candidate,
  onPick,
}: {
  readonly candidate: Candidate;
  readonly onPick: (principal: Principal) => void;
}) {
  const { label, principal, sublabel } = candidate;
  const pick = useCallback(() => onPick(principal), [onPick, principal]);
  return (
    <li>
      <Button className="w-full justify-start" onClick={pick} variant="ghost">
        <PrincipalIcon principal={principal} />
        <span className="truncate">{label}</span>
        {sublabel ? (
          <span className="truncate text-muted-foreground text-xs">
            {sublabel}
          </span>
        ) : null}
        <PlusIcon className="ms-auto" />
      </Button>
    </li>
  );
}

function GrantRow({
  grant,
  manage,
  name,
  onLevel,
  onRevoke,
}: {
  readonly grant: ResourceGrant;
  readonly manage: boolean;
  readonly name: string;
  readonly onLevel: (id: GrantId, level: LibraryPermission) => void;
  readonly onRevoke: (id: GrantId) => void;
}) {
  const { t } = useLingui();
  const { id } = grant;
  const level = grant.permission as LibraryPermission;
  const changeLevel = useCallback(
    (next: LibraryPermission) => onLevel(id, next),
    [id, onLevel]
  );
  const revoke = useCallback(() => onRevoke(id), [id, onRevoke]);
  return (
    <li className="flex flex-wrap items-center gap-2">
      <PrincipalIcon principal={grant.principal} />
      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
      <LevelPicker
        disabled={!manage}
        label={t`Level for ${name}`}
        onChange={changeLevel}
        value={level}
      />
      {manage ? (
        <Button
          aria-label={t`Remove ${name}`}
          onClick={revoke}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon />
        </Button>
      ) : null}
    </li>
  );
}

function PublicLinks({ refToShare }: { readonly refToShare: ResourceRef }) {
  const { t } = useLingui();
  const config = usePublicConfig();
  const enabled = config.data?.features.publicLinks === true;
  const links = useShareLinks(refToShare, enabled);
  const create = useCreateShareLink(refToShare);
  const revoke = useRevokeShareLink(refToShare);
  const { mutate: createLink } = create;
  const { mutate: revokeLink } = revoke;
  const makeLink = useCallback(() => createLink(), [createLink]);
  const turnOff = useCallback(
    (id: ShareLinkId) => revokeLink(id),
    [revokeLink]
  );
  if (!config.data) {
    return null;
  }
  const live = links.data ?? [];
  return (
    <>
      <Separator />
      <section aria-label={t`Public link`} className="flex flex-col gap-2">
        <h3 className="flex items-center gap-1 font-medium text-muted-foreground text-xs">
          <GlobeIcon className="size-3" />
          <Trans>Public link</Trans>
        </h3>
        {enabled ? (
          <>
            {live.map((link) => (
              <LinkRow key={link.id} link={link} onTurnOff={turnOff} />
            ))}
            {live.length === 0 ? (
              <Button
                className="self-start"
                disabled={create.isPending}
                onClick={makeLink}
                size="sm"
                variant="outline"
              >
                <Trans>Create a read-only link</Trans>
              </Button>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            <Trans>Public links are turned off on this instance.</Trans>
          </p>
        )}
      </section>
    </>
  );
}

function LinkRow({
  link,
  onTurnOff,
}: {
  readonly link: ShareLink;
  readonly onTurnOff: (id: ShareLinkId) => void;
}) {
  const { t } = useLingui();
  const { id, url } = link;
  const copy = useCallback(() => navigator.clipboard.writeText(url), [url]);
  const turnOff = useCallback(() => onTurnOff(id), [id, onTurnOff]);
  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label={t`Public link`}
        className="min-w-0 flex-1 font-mono text-xs"
        readOnly
        value={url}
      />
      <Button
        aria-label={t`Copy link`}
        onClick={copy}
        size="icon-sm"
        variant="ghost"
      >
        <CopyIcon />
      </Button>
      <Button onClick={turnOff} size="sm" variant="ghost">
        <Trans>Turn off</Trans>
      </Button>
    </div>
  );
}
