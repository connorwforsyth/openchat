import { os } from "./base";
import { grants, shareLinks } from "./grants";
import { me } from "./me";
import { orgs } from "./orgs";
import { teams } from "./teams";

// The orgs, teams, sharing and `me` procedure groups, implemented against
// the frozen contract. The shell (014/025) spreads `authRouter` into the
// full router and builds a `HandlerContext` (`@workspace/auth/handlers/context`)
// per request.

export const authRouter = os.router({ grants, me, orgs, shareLinks, teams });
export type AuthRouter = typeof authRouter;
