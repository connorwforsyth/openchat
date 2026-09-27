import { libraryItemIdSchema } from "@workspace/contract/schemas/common";
import { initLingui } from "@workspace/i18n/server";
import { notFound } from "next/navigation";

import { requestLocale } from "@/lib/i18n";

import { BuilderScreen } from "../builder-screen";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  initLingui(await requestLocale());
  const id = libraryItemIdSchema.safeParse((await params).id);
  if (!id.success) {
    notFound();
  }
  return <BuilderScreen target={{ id: id.data, type: "existing" }} />;
}
