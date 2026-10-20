import { orgIdSchema } from "@workspace/contract/schemas/common";
import { notFound, redirect } from "next/navigation";

import { routes } from "@/lib/routes";

export default async function Page({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  const orgId = orgIdSchema.safeParse((await params).orgId);
  if (!orgId.success) {
    notFound();
  }
  redirect(
    routes.spaceSettings({ id: orgId.data, type: "org" }, "space-members")
  );
}
