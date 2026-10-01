import { activeRunsInput } from "@workspace/chat-ui/chat/seed";
import type { ConversationId } from "@workspace/contract/schemas/common";

import { getServerApi, loopbackSignal } from "@/lib/server-session";

import type { ChatSeed } from "./chat-seed";

// Ticket 103 (D27): what a chat's first paint needs, read on the server in
// the page's own request. It goes through the API as the caller (loopback,
// their cookie), so access is decided by exactly the checks the browser's
// request would meet. Anything short of three answers seeds nothing: the
// browser then asks as it always has, and gets the API's answer (a chat the
// caller can't read is the same 404), with nothing of it in the HTML.

export const loadChatSeed = async (
  conversationId: ConversationId
): Promise<ChatSeed | null> => {
  const api = await getServerApi();
  if (!api) {
    return null;
  }
  const signal = loopbackSignal();
  try {
    const [conversation, path, runs] = await Promise.all([
      api.conversations.get({ id: conversationId }, { signal }),
      api.messages.path({ conversationId }, { signal }),
      api.runs.list(activeRunsInput(conversationId), { signal }),
    ]);
    return { conversation, path, runs };
  } catch {
    // Not found, signed out, or the API didn't answer: never rejects, so the
    // page's stream can't fail on it.
    return null;
  }
};
