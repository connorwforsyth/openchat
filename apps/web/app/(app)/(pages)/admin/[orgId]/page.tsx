import { redirect } from "next/navigation";

export default async function OrgAdminIndex({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  // The layout has already checked the id and the caller's role.
  redirect(`/admin/${encodeURIComponent(orgId)}/policies`);
}
