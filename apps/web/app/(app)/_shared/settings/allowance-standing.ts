import type {
  AllowanceGrant,
  Space,
  SpaceAllowance,
} from "@workspace/contract/schemas/spaces";

/** Where the caller stands with a space's token allowance (192). */
export type AllowanceStanding =
  | { readonly type: "not_member" }
  | { readonly type: "no_pool" }
  | { readonly tokens: number; readonly type: "remaining" }
  | { readonly type: "pending" }
  | { readonly type: "denied" }
  | { readonly type: "not_asked" };

export const allowanceStanding = (
  space: Pick<Space, "access" | "canManage">,
  allowance: Pick<SpaceAllowance, "monthlyTokens" | "myRemainingTokens">,
  grant: Pick<AllowanceGrant, "status"> | undefined
): AllowanceStanding => {
  if (space.access === "root_member" && !space.canManage) {
    return { type: "not_member" };
  }
  if (allowance.monthlyTokens === null) {
    return { type: "no_pool" };
  }
  if (space.canManage || grant?.status === "approved") {
    return { tokens: allowance.myRemainingTokens, type: "remaining" };
  }
  switch (grant?.status) {
    case "pending":
      return { type: "pending" };
    case "denied":
      return { type: "denied" };
    default:
      return { type: "not_asked" };
  }
};
