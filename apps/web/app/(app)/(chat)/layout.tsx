import { runtimeOriginFrom } from "@workspace/chat-ui/artifacts/runtime-protocol";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { ChatRoute } from "./chat-route";
import { ChatSeedsProvider } from "./chat-seed";

// `/` and `/c/[id]` share one chat screen. It has to outlive the navigation
// from a new chat to its address: the first message is sent after the chat
// is created and routed to, by the same screen that took it (ticket 015).
// The pages under here validate the address and, for a chat, start reading
// it on the server (ticket 103). They render before the screen, so the
// screen finds what they filed (`chat-seed.tsx`).
//
// The artifact runtime's origin is read per request, not baked in at build
// time, so one build serves any deployment; unset or invalid, it's `null`
// and previews fall back to `srcdoc` (D24).

export default async function ChatLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  await connection();
  return (
    <ChatSeedsProvider>
      {children}
      <ChatRoute
        artifactsRuntimeOrigin={runtimeOriginFrom(process.env.ARTIFACTS_ORIGIN)}
      />
    </ChatSeedsProvider>
  );
}
