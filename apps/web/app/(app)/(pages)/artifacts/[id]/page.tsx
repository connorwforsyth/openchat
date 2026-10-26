import { runtimeOriginFrom } from "@workspace/chat-ui/artifacts/runtime-protocol";
import { artifactIdSchema } from "@workspace/contract/schemas/common";
import { initLingui } from "@workspace/i18n/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { requestLocale } from "@/lib/i18n";

import { ArtifactScreen } from "../artifacts-screen";

// The artifact runtime's origin is read per request, as the chat's layout
// does, so one build serves any deployment (D24).
export default async function Page({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  await connection();
  initLingui(await requestLocale());
  const id = artifactIdSchema.safeParse((await params).id);
  if (!id.success) {
    notFound();
  }
  // A definite height, not a minimum: a grid, a canvas or a code view
  // fills the page and scrolls inside it.
  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col p-4 md:p-6">
      <ArtifactScreen
        id={id.data}
        runtimeOrigin={runtimeOriginFrom(process.env.ARTIFACTS_ORIGIN)}
      />
    </div>
  );
}
