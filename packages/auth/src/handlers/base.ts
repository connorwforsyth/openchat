import { implement } from "@orpc/server";
import { contract } from "@workspace/contract/contract";

import { type HandlerContext, requireSession } from "./context";

// Just the procedure groups this package implements. The shell merges the
// router built from these into the full one (`implement(contract)` there),
// so each group is typed by the frozen contract and nothing else.

export const authContract = {
  grants: contract.grants,
  me: contract.me,
  orgs: contract.orgs,
  shareLinks: contract.shareLinks,
  spaces: contract.spaces,
  teams: contract.teams,
};

export const os = implement(authContract).$context<HandlerContext>();

/** Every procedure here except `shareLinks.resolve` needs a session. */
export const authed = os.use(requireSession);
