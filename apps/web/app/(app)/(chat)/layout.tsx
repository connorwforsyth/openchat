import type { ReactNode } from "react";

import { ChatRoute } from "./chat-route";

// `/` and `/c/[id]` share one chat screen. It has to outlive the navigation
// from a new chat to its address: the first message is sent after the chat
// is created and routed to, by the same screen that took it (ticket 015).
// The pages under here only validate the address.

export default function ChatLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <>
      <ChatRoute />
      {children}
    </>
  );
}
