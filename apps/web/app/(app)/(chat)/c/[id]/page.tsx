import { conversationIdSchema } from "@workspace/contract/schemas/common";
import { notFound } from "next/navigation";

import { ChatSeedFiler } from "../../chat-seed";
import { loadChatSeed } from "../../load-chat-seed";

// A chat. The screen is the layout's (see `../../layout.tsx`); a malformed id
// is a 404, not a request the API would refuse. The page starts reading the
// chat on the server and hands the screen the promise, not the answer, so
// nothing here waits for it (ticket 103).
export default async function ChatPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const parsed = conversationIdSchema.safeParse((await params).id);
  if (!parsed.success) {
    notFound();
  }
  return (
    <ChatSeedFiler
      conversationId={parsed.data}
      seed={loadChatSeed(parsed.data)}
    />
  );
}
