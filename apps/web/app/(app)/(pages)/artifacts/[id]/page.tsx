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
  return (
    <ArtifactScreen
      id={id.data}
      runtimeOrigin={runtimeOriginFrom(process.env.ARTIFACTS_ORIGIN)}
    />
  );
}
