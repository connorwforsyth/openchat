import type { ConversationId } from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { Space } from "@workspace/contract/schemas/spaces";
import {
  type ChatContext,
  chatContextSchema,
} from "@workspace/contract/schemas/tenancy";

// The active space (ticket 191) is the context new chats start in: the
// switcher sets it, and it's remembered per browser. Personal is the
// personal space (the hidden personal org, D17).

export const ACTIVE_SPACE_KEY = "spaces.active";

/** The space a chat context names, among the caller's spaces. */
export const spaceForContext = (
  spaces: readonly Space[],
  context: ChatContext
): Space | undefined =>
  context.type === "personal"
    ? spaces.find((space) => space.isPersonal)
    : spaces.find(
        (space) => space.type === context.type && space.id === context.id
      );

/** Each chat's space by name, for its sidebar row; personal chats are absent. */
export const spaceNamesByChat = (
  chats: readonly Pick<Conversation, "context" | "id">[],
  spaces: readonly Space[]
): ReadonlyMap<ConversationId, string> =>
  new Map(
    chats.flatMap((chat) => {
      const space = spaceForContext(spaces, chat.context);
      return space && !space.isPersonal ? [[chat.id, space.name] as const] : [];
    })
  );

/** The chat context a space stands for. */
export const contextForSpace = (space: Space): ChatContext => {
  if (space.isPersonal) {
    return { type: "personal" };
  }
  return space.type === "team"
    ? { id: space.id as never, type: "team" }
    : { id: space.id as never, type: "org" };
};

/** Reads the remembered pick; anything unreadable is Personal. */
export const readActiveSpace = (
  storage: Pick<Storage, "getItem"> | undefined
): ChatContext => {
  try {
    const raw = storage?.getItem(ACTIVE_SPACE_KEY);
    const parsed = chatContextSchema.safeParse(raw ? JSON.parse(raw) : null);
    return parsed.success ? parsed.data : { type: "personal" };
  } catch {
    return { type: "personal" };
  }
};

export const writeActiveSpace = (
  storage: Pick<Storage, "setItem"> | undefined,
  context: ChatContext
): void => {
  try {
    storage?.setItem(ACTIVE_SPACE_KEY, JSON.stringify(context));
  } catch {
    // Private mode or a full quota: the pick lasts for this page only.
  }
};

/**
 * Spaces as an outline: each with its depth below its root space, in the
 * order the API returns them (already depth-first).
 */
export const withDepth = (
  spaces: readonly Space[]
): { readonly depth: number; readonly space: Space }[] => {
  const depthOf = new Map<string, number>();
  return spaces.map((space) => {
    const depth = space.parent
      ? (depthOf.get(`${space.parent.type}:${space.parent.id}`) ?? 0) + 1
      : 0;
    depthOf.set(`${space.type}:${space.id}`, depth);
    return { depth, space };
  });
};

/** `?space=team:<id>` (or `org:<id>`), as a chat context; anything else is `undefined`. */
export const spaceFromQuery = (search: string): ChatContext | undefined => {
  const raw = new URLSearchParams(search).get("space");
  const [type, id] = raw?.split(":") ?? [];
  const parsed = chatContextSchema.safeParse({ id, type });
  return parsed.success && parsed.data.type !== "personal"
    ? parsed.data
    : undefined;
};
