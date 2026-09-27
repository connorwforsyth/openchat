import { initLingui } from "@workspace/i18n/server";
import { BUILDABLE_KINDS } from "@workspace/library-ui/kinds";
import { notFound } from "next/navigation";

import { requestLocale } from "@/lib/i18n";

import { BuilderScreen } from "../../builder-screen";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ kind: string }>;
}) {
  initLingui(await requestLocale());
  const { kind } = await params;
  const buildable = BUILDABLE_KINDS.find((each) => each === kind);
  if (!buildable) {
    notFound();
  }
  return <BuilderScreen target={{ kind: buildable, type: "new" }} />;
}
