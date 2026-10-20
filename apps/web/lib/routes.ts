import type {
  ArtifactId,
  ConversationId,
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
  /** `/c/:id?dot=scheduled` opens the Dot's profile on that tab (181). */
  dotTab: "dot",
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
  /** The Dot's chat with its profile open on Scheduled (181). */
  dotSchedules: (conversationId: ConversationId) =>
    withQuery(`/c/${conversationId}`, { [routeParams.dotTab]: "scheduled" }),
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
  settings: (section = "profile") => `/settings/${section}`,
  signIn: "/sign-in",
  signInThen: (next: string) =>
    withQuery("/sign-in", { [routeParams.next]: next }),
  signUp: "/sign-up",
  signUpForInvite: (token: string) =>
    withQuery("/sign-up", { [routeParams.invite]: token }),
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
