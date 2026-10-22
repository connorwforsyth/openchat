import { slugFor, type Terms } from "@workspace/config/terms";
import type {
  ArtifactId,
  ConversationId,
  DotScheduleId,
  LibraryItemId,
  MessageId,
  OrgId,
} from "@workspace/contract/schemas/common";
import type { LibraryKind } from "@workspace/contract/schemas/library";
import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";
import type { LibraryTab } from "@workspace/library-ui/cache";

// Where things live, named once so the shell, the palette, the auth pages
// and the proxy agree. In-app links go through here.

/** Query parameters the routes read. */
export const routeParams = {
  /** `/?agent=` starts a new chat with that agent ("Use in chat"). */
  agent: "agent",
  /** `/?prompt=` starts a new chat and sends it (the palette's "Ask AI"). */
  askAi: "prompt",
  /** `/schedules?edit=:id` opens that schedule; `?edit=new` a new one (181). */
  edit: "edit",
  /** `/sign-up?invite=` returns to the invitation once the account exists. */
  invite: "invite",
  /** `/library?kind=`, `/artifacts?kind=`: the kind filter to open on (181). */
  kind: "kind",
  /** `/sign-in?next=` is where to go once signed in. */
  next: "next",
  /** `/library?tab=`: the library tab to open on (181). */
  tab: "tab",
} as const;

const withQuery = (path: string, query: Record<string, string>) =>
  `${path}?${new URLSearchParams(query)}`;

export const routes = {
  admin: "/admin",
  adminOrg: (orgId: OrgId, section = "policies") =>
    `/admin/${orgId}/${section}`,
  artifact: (id: ArtifactId) => `/artifacts/${id}`,
  artifacts: "/artifacts",
  artifactsOfKind: (kind: ArtifactKind) =>
    withQuery("/artifacts", { [routeParams.kind]: kind }),
  askAi: (prompt: string) => withQuery("/", { [routeParams.askAi]: prompt }),
  chat: (id: ConversationId, messageId: MessageId | null = null) =>
    messageId ? `/c/${id}#${messageId}` : `/c/${id}`,
  // A search hit names the message; the fragment keeps it in the address.
  chatWithAgent: (agentId: LibraryItemId) =>
    withQuery("/", { [routeParams.agent]: agentId }),
  /** Always-on agents (172). */
  dots: "/dots",
  home: "/",
  invite: (token: string) => `/invite/${encodeURIComponent(token)}`,
  library: "/library",
  libraryItem: (id: LibraryItemId) => `/library/${id}`,
  libraryNew: (kind: LibraryKind) => `/library/new/${kind}`,
  libraryOfKind: (kind: LibraryKind) =>
    withQuery("/library", { [routeParams.kind]: kind }),
  libraryTab: (tab: LibraryTab) =>
    withQuery("/library", { [routeParams.tab]: tab }),
  /** Quick AI (118): the composer alone, for the desktop app's floating window. */
  quick: "/quick",
  /** The schedules page with one open in the editor, or a new one (181). */
  scheduleEdit: (id: DotScheduleId | "new") =>
    withQuery("/schedules", { [routeParams.edit]: id }),
  /** Scheduled tasks (183). */
  schedules: "/schedules",
  /**
   * Settings, a full-screen view over the current page (185); see
   * `settings-route.ts`. A section named by `terms:` (191) is addressed by
   * its configured slug, so links follow a fork's renames.
   */
  settings: (terms: Terms, section?: string) =>
    section ? `/settings/${slugFor(terms, section)}` : "/settings",
  signIn: "/sign-in",
  signInThen: (next: string) =>
    withQuery("/sign-in", { [routeParams.next]: next }),
  signUp: "/sign-up",
  signUpForInvite: (token: string) =>
    withQuery("/sign-up", { [routeParams.invite]: token }),
  /** The active space's shared chats, agents and skills (187). */
  space: "/space",
  /** Settings for one space, which becomes the active one (187). */
  spaceSettings: (
    space: { id: string; type: "org" | "team" },
    section: string
  ) =>
    `/settings/${section}?${new URLSearchParams({ space: `${space.type}:${space.id}` })}`,
} as const;

const SAFE_NEXT = /^\/(?![/\\])[^\s\\]*$/;

/**
 * Where to go after signing in. Only a path on this origin: `?next=` is
 * user input, and an absolute or protocol-relative URL would turn the
 * sign-in page into an open redirect.
 */
export const safeNext = (value: string | null | undefined): string =>
  value && SAFE_NEXT.test(value) && !value.startsWith("/sign-")
    ? value
    : routes.home;
