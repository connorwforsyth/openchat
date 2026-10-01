"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryUtils } from "@workspace/client/api";
import type {
  ConversationId,
  GrantId,
} from "@workspace/contract/schemas/common";
import type {
  ArtifactGrant,
  ArtifactListItem,
  ArtifactPermission,
} from "@workspace/contract/schemas/files";
import type { Me } from "@workspace/contract/schemas/meta";
import type {
  Principal,
  UserSummary,
} from "@workspace/contract/schemas/tenancy";
import {
  CopyIcon,
  EllipsisIcon,
  MessageSquareIcon,
  NewChatIcon,
  PencilIcon,
  PlusIcon,
  ShareIcon,
  Trash2Icon,
  UserIcon,
  UsersIcon,
  XIcon,
} from "@workspace/icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import { type ChangeEvent, type FormEvent, useCallback, useState } from "react";

import { SIDEBAR_LIST_INPUT } from "../chat/use-chat-data";

// An artifact's actions (124), the same from its row on the Artifacts page
// and from its full-page view: Use in chat, Share, Rename, Go to chat,
// Duplicate, Delete. Each asks for what it needs in a dialog of its own.

/** Where things are, named by the app (chat-ui doesn't know its routes). */
export interface ArtifactLinks {
  readonly chat: (id: ConversationId) => string;
  readonly navigate: (href: string) => void;
}

type Dialogs = "delete" | "rename" | "share" | "use" | null;

export interface ArtifactMenuProps {
  readonly api: QueryUtils;
  readonly artifact: ArtifactListItem;
  readonly links: ArtifactLinks;
  readonly me: Me;
  /** After it's deleted (a full view leaves the page). */
  readonly onDeleted?: () => void;
  /** The trigger's look: a quiet icon on a row, or an outlined one in a toolbar. */
  readonly variant?: "ghost" | "outline";
}

/** Refetches every artifact query: lists, details and a chat's panel. */
export const useRefreshArtifacts = (api: QueryUtils) => {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: api.artifacts.key() }),
    [api, queryClient]
  );
};

export function ArtifactMenu({
  api,
  artifact,
  links,
  me,
  onDeleted,
  variant = "ghost",
}: ArtifactMenuProps) {
  const { t } = useLingui();
  const refresh = useRefreshArtifacts(api);
  const [open, setOpen] = useState<Dialogs>(null);
  const { title } = artifact;
  const owner = artifact.access === "owner";
  const canEdit = owner || artifact.access === "editor";

  const duplicate = useMutation(
    api.artifacts.duplicate.mutationOptions({ onSettled: refresh })
  );
  const remove = useMutation(
    api.artifacts.delete.mutationOptions({
      onSettled: refresh,
      onSuccess: () => onDeleted?.(),
    })
  );
  const { mutate: duplicateIt } = duplicate;
  const { mutate: removeIt } = remove;

  const close = useCallback((next: boolean) => {
    if (!next) {
      setOpen(null);
    }
  }, []);
  const openUse = useCallback(() => setOpen("use"), []);
  const openShare = useCallback(() => setOpen("share"), []);
  const openRename = useCallback(() => setOpen("rename"), []);
  const openDelete = useCallback(() => setOpen("delete"), []);
  const goToChat = useCallback(
    () => links.navigate(links.chat(artifact.conversationId)),
    [artifact.conversationId, links]
  );
  const copy = useCallback(
    () => duplicateIt({ id: artifact.id }),
    [artifact.id, duplicateIt]
  );
  const confirmDelete = useCallback(() => {
    removeIt({ id: artifact.id });
    setOpen(null);
  }, [artifact.id, removeIt]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={t`Actions for ${title}`}
              size="icon-sm"
              variant={variant}
            />
          }
        >
          <EllipsisIcon aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={openUse}>
              <MessageSquareIcon aria-hidden />
              <Trans>Use in chat</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openShare}>
              <ShareIcon aria-hidden />
              <Trans>Share</Trans>
            </DropdownMenuItem>
            {canEdit ? (
              <DropdownMenuItem onClick={openRename}>
                <PencilIcon aria-hidden />
                <Trans>Rename</Trans>
              </DropdownMenuItem>
            ) : null}
            {artifact.canGoToChat ? (
              <DropdownMenuItem onClick={goToChat}>
                <NewChatIcon aria-hidden />
                <Trans>Go to chat</Trans>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              disabled={artifact.latestVersionId === null}
              onClick={copy}
            >
              <CopyIcon aria-hidden />
              <Trans>Duplicate</Trans>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {owner ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={openDelete} variant="destructive">
                  <Trash2Icon aria-hidden />
                  <Trans>Delete</Trans>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameDialog
        api={api}
        artifact={artifact}
        onOpenChange={close}
        open={open === "rename"}
      />
      <ShareDialog
        api={api}
        artifact={artifact}
        me={me}
        onOpenChange={close}
        open={open === "share"}
      />
      <UseInChatDialog
        api={api}
        artifact={artifact}
        links={links}
        onOpenChange={close}
        open={open === "use"}
      />
      <AlertDialog onOpenChange={close} open={open === "delete"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Delete {title}?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                Its versions go too, and anyone it's shared with loses it. This
                can't be undone.
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} variant="destructive">
              <Trans>Delete</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface DialogProps {
  readonly api: QueryUtils;
  readonly artifact: ArtifactListItem;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}

function RenameDialog({ api, artifact, onOpenChange, open }: DialogProps) {
  const { t } = useLingui();
  const refresh = useRefreshArtifacts(api);
  const [title, setTitle] = useState(artifact.title);
  const rename = useMutation(
    api.artifacts.rename.mutationOptions({ onSettled: refresh })
  );
  const { mutate: renameIt } = rename;
  const change = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      setTitle(event.currentTarget.value),
    []
  );
  const openChange = useCallback(
    (next: boolean) => {
      if (next) {
        setTitle(artifact.title);
      }
      onOpenChange(next);
    },
    [artifact.title, onOpenChange]
  );
  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const next = title.trim();
      if (next !== "" && next !== artifact.title) {
        renameIt({ id: artifact.id, title: next });
      }
      onOpenChange(false);
    },
    [artifact.id, artifact.title, onOpenChange, renameIt, title]
  );
  return (
    <Dialog onOpenChange={openChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              <Trans>Rename artifact</Trans>
            </DialogTitle>
          </DialogHeader>
          <Input
            aria-label={t`Title`}
            maxLength={200}
            onChange={change}
            value={title}
          />
          <DialogFooter>
            <Button disabled={title.trim() === ""} type="submit">
              <Trans>Save</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface Candidate {
  readonly label: string;
  readonly principal: Principal;
  readonly sublabel?: string;
}

const NO_PEOPLE: readonly UserSummary[] = [];
const MAX_MATCHES = 6;

const samePrincipal = (a: Principal, b: Principal) =>
  a.type === b.type && a.id === b.id;

/** People in the caller's orgs, their teams and their orgs. Pure. */
export const shareCandidates = (
  me: Me,
  people: readonly UserSummary[]
): Candidate[] => [
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

/** Candidates matching `query` who don't have access yet. Pure. */
export const matchShareCandidates = (
  candidates: readonly Candidate[],
  grants: readonly ArtifactGrant[],
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

/** Everyone in the caller's shared orgs, for the share picker. */
const usePeople = (api: QueryUtils, me: Me, enabled: boolean) => {
  const orgIds = me.orgs.filter((org) => !org.isPersonal).map((org) => org.id);
  return useQuery({
    enabled: enabled && orgIds.length > 0,
    queryFn: async ({ signal }) => {
      const pages = await Promise.all(
        orgIds.map((orgId) =>
          api.orgs.members.call({ limit: 100, orgId }, { signal })
        )
      );
      const seen = new Map<string, UserSummary>();
      for (const page of pages) {
        for (const member of page.items) {
          seen.set(member.user.id, member.user);
        }
      }
      return [...seen.values()];
    },
    queryKey: [...api.orgs.key(), "artifact-share-people", orgIds],
  });
};

function LevelPicker({
  disabled,
  label,
  onChange,
  value,
}: {
  readonly disabled?: boolean;
  readonly label: string;
  readonly onChange: (level: ArtifactPermission) => void;
  readonly value: ArtifactPermission;
}) {
  const change = useCallback(
    (values: string[]) => {
      const [next] = values;
      if (next === "viewer" || next === "editor") {
        onChange(next);
      }
    },
    [onChange]
  );
  return (
    <ToggleGroup
      aria-label={label}
      disabled={disabled}
      onValueChange={change}
      size="sm"
      value={[value]}
      variant="outline"
    >
      <ToggleGroupItem value="viewer">
        <Trans>View</Trans>
      </ToggleGroupItem>
      <ToggleGroupItem value="editor">
        <Trans>Edit</Trans>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

function ShareDialog({
  api,
  artifact,
  me,
  onOpenChange,
  open,
}: DialogProps & { readonly me: Me }) {
  const { title } = artifact;
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>Share {title}</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              View lets people open it and use it in their chats. Edit also lets
              them rename it and make new versions.
            </Trans>
          </DialogDescription>
        </DialogHeader>
        {open ? <ShareBody api={api} artifact={artifact} me={me} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ShareBody({
  api,
  artifact,
  me,
}: {
  readonly api: QueryUtils;
  readonly artifact: ArtifactListItem;
  readonly me: Me;
}) {
  const { t } = useLingui();
  const refresh = useRefreshArtifacts(api);
  const owner = artifact.access === "owner";
  const { ownerName } = artifact;
  const grants = useQuery(
    api.artifacts.listGrants.queryOptions({ input: { id: artifact.id } })
  );
  const people = usePeople(api, me, true);
  const share = useMutation(
    api.artifacts.share.mutationOptions({ onSettled: refresh })
  );
  const unshare = useMutation(
    api.artifacts.unshare.mutationOptions({ onSettled: refresh })
  );
  const { mutate: shareWith } = share;
  const { mutate: unshareIt } = unshare;
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<ArtifactPermission>("viewer");

  const candidates = shareCandidates(me, people.data ?? NO_PEOPLE);
  const current = grants.data ?? [];
  const matches = matchShareCandidates(candidates, current, query);
  const nameOf = (principal: Principal) =>
    candidates.find((each) => samePrincipal(each.principal, principal))
      ?.label ??
    (principal.type === "user" && principal.id === me.user.id
      ? me.user.name
      : t`Someone`);

  const search = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      setQuery(event.currentTarget.value),
    []
  );
  const pick = useCallback(
    (principal: Principal) => {
      shareWith({ id: artifact.id, permission: level, principal });
      setQuery("");
    },
    [artifact.id, level, shareWith]
  );
  const changeLevel = useCallback(
    (grant: ArtifactGrant, permission: ArtifactPermission) =>
      shareWith({ id: artifact.id, permission, principal: grant.principal }),
    [artifact.id, shareWith]
  );
  const remove = useCallback(
    (grantId: GrantId) => unshareIt({ grantId, id: artifact.id }),
    [artifact.id, unshareIt]
  );

  return (
    <div className="flex flex-col gap-4">
      {owner ? (
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
      {share.isError || unshare.isError ? (
        <p className="text-destructive text-sm" role="alert">
          <Trans>That change didn't go through.</Trans>
        </p>
      ) : null}
      <section
        aria-label={t`People with access`}
        className="flex flex-col gap-2"
      >
        <h3 className="font-medium text-muted-foreground text-xs">
          <Trans>People with access</Trans>
        </h3>
        <p className="text-sm">
          <Trans>{ownerName} (owner)</Trans>
        </p>
        {current.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {current.map((grant) => (
              <GrantRow
                grant={grant}
                key={grant.id}
                manage={owner}
                name={nameOf(grant.principal)}
                onLevel={changeLevel}
                onRemove={remove}
              />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            <Trans>Not shared with anyone yet.</Trans>
          </p>
        )}
      </section>
    </div>
  );
}

function PrincipalIcon({ principal }: { readonly principal: Principal }) {
  const Glyph = principal.type === "user" ? UserIcon : UsersIcon;
  return <Glyph aria-hidden className="size-4 text-muted-foreground" />;
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
        <PlusIcon aria-hidden className="ms-auto" />
      </Button>
    </li>
  );
}

function GrantRow({
  grant,
  manage,
  name,
  onLevel,
  onRemove,
}: {
  readonly grant: ArtifactGrant;
  readonly manage: boolean;
  readonly name: string;
  readonly onLevel: (grant: ArtifactGrant, level: ArtifactPermission) => void;
  readonly onRemove: (id: GrantId) => void;
}) {
  const { t } = useLingui();
  const changeLevel = useCallback(
    (next: ArtifactPermission) => onLevel(grant, next),
    [grant, onLevel]
  );
  const remove = useCallback(() => onRemove(grant.id), [grant.id, onRemove]);
  return (
    <li className="flex flex-wrap items-center gap-2">
      <PrincipalIcon principal={grant.principal} />
      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
      <LevelPicker
        disabled={!manage}
        label={t`Level for ${name}`}
        onChange={changeLevel}
        value={grant.permission}
      />
      {manage ? (
        <Button
          aria-label={t`Remove ${name}`}
          onClick={remove}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon aria-hidden />
        </Button>
      ) : null}
    </li>
  );
}

const RECENT_CHATS = 8;

function UseInChatDialog({
  api,
  artifact,
  links,
  onOpenChange,
  open,
}: DialogProps & { readonly links: ArtifactLinks }) {
  const { title } = artifact;
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>Use {title} in a chat</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              The chat's model sees its latest version and, if you can edit it,
              can make new versions of it there.
            </Trans>
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <UseInChatBody
            api={api}
            artifact={artifact}
            links={links}
            onDone={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function UseInChatBody({
  api,
  artifact,
  links,
  onDone,
}: {
  readonly api: QueryUtils;
  readonly artifact: ArtifactListItem;
  readonly links: ArtifactLinks;
  readonly onDone: (open: boolean) => void;
}) {
  const { t } = useLingui();
  const refresh = useRefreshArtifacts(api);
  const chats = useQuery(
    api.conversations.list.queryOptions({ input: SIDEBAR_LIST_INPUT })
  );
  const create = useMutation(api.conversations.create.mutationOptions());
  const attaching = useMutation(
    api.artifacts.use.mutationOptions({ onSettled: refresh })
  );
  const { mutateAsync: createChat } = create;
  const { mutateAsync: attach } = attaching;
  const busy = create.isPending || attaching.isPending;

  const attachTo = useCallback(
    async (conversationId: ConversationId) => {
      await attach({ conversationId, id: artifact.id });
      onDone(false);
      links.navigate(links.chat(conversationId));
    },
    [artifact.id, attach, links, onDone]
  );
  const newChat = useCallback(async () => {
    const chat = await createChat({ title: artifact.title });
    await attachTo(chat.id);
  }, [artifact.title, attachTo, createChat]);

  const recent = (chats.data?.items ?? []).slice(0, RECENT_CHATS);
  return (
    <div className="flex flex-col gap-3">
      <Button className="justify-start" disabled={busy} onClick={newChat}>
        <NewChatIcon aria-hidden data-icon="inline-start" />
        <Trans>New chat</Trans>
      </Button>
      {attaching.isError || create.isError ? (
        <p className="text-destructive text-sm" role="alert">
          <Trans>That didn't work. Try again.</Trans>
        </p>
      ) : null}
      {recent.length > 0 ? (
        <section aria-label={t`Recent chats`} className="flex flex-col gap-1">
          <h3 className="font-medium text-muted-foreground text-xs">
            <Trans>Or add it to a recent chat</Trans>
          </h3>
          <ul className="flex flex-col">
            {recent.map((chat) => (
              <ChatChoice
                disabled={busy}
                id={chat.id}
                key={chat.id}
                onPick={attachTo}
                title={chat.title ?? t`New chat`}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ChatChoice({
  disabled,
  id,
  onPick,
  title,
}: {
  readonly disabled: boolean;
  readonly id: ConversationId;
  readonly onPick: (id: ConversationId) => void;
  readonly title: string;
}) {
  const pick = useCallback(() => onPick(id), [id, onPick]);
  return (
    <li>
      <Button
        className="w-full justify-start"
        disabled={disabled}
        onClick={pick}
        variant="ghost"
      >
        <MessageSquareIcon aria-hidden data-icon="inline-start" />
        <span className="truncate">{title}</span>
      </Button>
    </li>
  );
}
