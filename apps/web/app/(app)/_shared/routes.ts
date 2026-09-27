import type {
  ConversationId,
  LibraryItemId,
  MessageId,
  OrgId,
} from "@workspace/contract/schemas/common";

// Where things live. Chat and library routes belong to the shell (015/025);
// they're named once here so the palette and these pages agree with it.

export const routes = {
  admin: "/admin",
  adminOrg: (orgId: OrgId, section = "policies") =>
    `/admin/${orgId}/${section}`,
  askAi: (prompt: string) => `/?${new URLSearchParams({ prompt })}`,
  chat: (id: ConversationId, messageId: MessageId | null) =>
    messageId ? `/c/${id}#${messageId}` : `/c/${id}`,
  home: "/",
  library: (id: LibraryItemId) => `/library/${id}`,
  settings: (section = "profile") => `/settings/${section}`,
  signIn: "/sign-in",
} as const;
