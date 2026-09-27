import { conversationIdSchema } from "@workspace/contract/schemas/common";
import { notFound } from "next/navigation";

// A chat. The screen is the layout's (see `../../layout.tsx`); a malformed id
// is a 404, not a request the API would refuse.
export default async function ChatPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  if (!conversationIdSchema.safeParse((await params).id).success) {
    notFound();
  }
  return null;
}
