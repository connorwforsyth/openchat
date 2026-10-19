import { oc } from "@orpc/contract";

import { feedback, keys, me, memory, meta } from "./routes/account";
import { conversations } from "./routes/conversations";
import { dots } from "./routes/dots";
import { artifacts, files } from "./routes/files";
import { library, mcp } from "./routes/library";
import { linkPreviews } from "./routes/link-preview";
import { messages } from "./routes/messages";
import { decisions, sandbox, search, usage } from "./routes/ops";
import { runs } from "./routes/runs";
import { schedules } from "./routes/schedules";
import { grants, shareLinks } from "./routes/sharing";
import { orgs, teams } from "./routes/tenancy";

// The M1 API surface (D26): one oRPC contract that the Hono handlers
// implement, the TypeScript client is typed from, and OpenAPI 3.1 is generated
// from. Grouped by domain; the OpenAPI tag is the group. Run streams
// (`GET /runs/{id}/stream`) are SSE, not procedures: see README.md.

export const contract = {
  artifacts: oc.tag("Artifacts").router(artifacts),
  conversations: oc.tag("Conversations").router(conversations),
  decisions: oc.tag("Admin").router(decisions),
  dots: oc.tag("Dots").router(dots),
  feedback: oc.tag("Feedback").router(feedback),
  files: oc.tag("Files").router(files),
  grants: oc.tag("Sharing").router(grants),
  keys: oc.tag("Keys").router(keys),
  library: oc.tag("Library").router(library),
  linkPreviews: oc.tag("Link previews").router(linkPreviews),
  mcp: oc.tag("MCP").router(mcp),
  me: oc.tag("Account").router(me),
  memory: oc.tag("Memory").router(memory),
  messages: oc.tag("Messages").router(messages),
  meta: oc.tag("Meta").router(meta),
  orgs: oc.tag("Orgs").router(orgs),
  runs: oc.tag("Runs").router(runs),
  sandbox: oc.tag("Sandbox").router(sandbox),
  schedules: oc.tag("Schedules").router(schedules),
  search: oc.tag("Search").router(search),
  shareLinks: oc.tag("Sharing").router(shareLinks),
  teams: oc.tag("Teams").router(teams),
  usage: oc.tag("Usage").router(usage),
};

export type Contract = typeof contract;
