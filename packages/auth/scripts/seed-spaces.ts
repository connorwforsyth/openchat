#!/usr/bin/env bun
/**
 * Seeds a demo tree of spaces (ticket 187) into DATABASE_URL, through the
 * same handlers the API uses, so the demo obeys the real rules:
 *
 *   Acme (owner: Maya)
 *   ├── Design      demo@dots.local owns it; Sam is a member
 *   │   └── Brand   Sam owns it; Lee is a member
 *   └── Engineering Maya owns it; demo and Lee are members
 *       └── Platform
 *
 * Plus shared agents, skills and chats at each level, token allowances with
 * an approved and a pending request, and a Design key with usage against it.
 *
 *   SEED_PASSWORD=… DATABASE_URL=… bun scripts/seed-spaces.ts
 *
 * SEED_PASSWORD is demo@dots.local's password and the one the new demo
 * users get. Safe to re-run: it stops if Acme already exists.
 */
import { call } from "@orpc/server";
import { loadConfig } from "@workspace/config/load";
import type {
  LibraryItemId,
  OrgId,
  TeamId,
  UserId,
} from "@workspace/contract/schemas/common";
import { connect } from "@workspace/db/client";
import { recordTransaction } from "@workspace/db/queries/usage";
import { organization, user } from "@workspace/db/schema/auth";
import { conversation } from "@workspace/db/schema/chat";
import { agent, skill } from "@workspace/db/schema/library";
import { providerKey } from "@workspace/db/schema/usage";
import { eq } from "drizzle-orm";

import { type HandlerContext, resolveSession } from "../src/handlers/context";
import { authRouter } from "../src/handlers/index";
import { createAuth } from "../src/server";

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const password = process.env.SEED_PASSWORD ?? fail("Set SEED_PASSWORD.");
const url = process.env.DATABASE_URL ?? fail("Set DATABASE_URL.");
const connection = connect(url);
const { db, close } = connection.ok
  ? connection.value
  : fail("DATABASE_URL must be a postgres:// URL.");
const loaded = await loadConfig();
const config = loaded.ok
  ? loaded.value.config
  : fail("app.config.yaml is invalid.");
// The demo users are created directly, whatever the instance's sign-up rule.
const created = createAuth({
  config: { ...config, auth: { ...config.auth, signup: "open" } },
  db,
});
const auth = created.ok
  ? created.value
  : fail("Auth couldn't start (BETTER_AUTH_SECRET?).");

const [existing] = await db
  .select()
  .from(organization)
  .where(eq(organization.slug, "acme"));
if (existing) {
  process.stdout.write("Acme already exists; nothing to do.\n");
  await close();
  process.exit(0);
}

const contextFor = async (email: string, name: string) => {
  const [found] = await db.select().from(user).where(eq(user.email, email));
  if (!found) {
    await auth.api.signUpEmail({ body: { email, name, password } });
  }
  const signedIn = await auth.api.signInEmail({ body: { email, password } });
  const headers = new Headers({ authorization: `Bearer ${signedIn.token}` });
  const context: HandlerContext = {
    appUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    auth,
    config,
    db,
    headers,
    session: await resolveSession(auth, headers),
  };
  return { context, id: signedIn.user.id as UserId };
};

const demo = await contextFor("demo@dots.local", "Demo");
const maya = await contextFor("maya@acme.local", "Maya Chen");
const sam = await contextFor("sam@acme.local", "Sam Ortiz");
const lee = await contextFor("lee@acme.local", "Lee Park");

const as = (who: { context: HandlerContext }) => ({ context: who.context });

const acme = await call(
  authRouter.orgs.create,
  { name: "Acme", slug: "acme" },
  as(maya)
);
const root = { id: acme.id as OrgId, type: "org" as const };
interface SpaceArg {
  readonly id: OrgId | TeamId;
  readonly type: "org" | "team";
}
const child = async (parent: SpaceArg, name: string) => {
  const made = await call(
    authRouter.spaces.createChild,
    { ...parent, name },
    as(maya)
  );
  return { id: made.id as TeamId, type: "team" as const };
};
const design = await child(root, "Design");
const brand = await child(design, "Brand");
const eng = await child(root, "Engineering");
await child(eng, "Platform");

for (const who of [demo, sam, lee]) {
  // biome-ignore lint/performance/noAwaitInLoops: a one-off seed; each step reads what the last wrote
  const invitation = await call(
    authRouter.orgs.invite,
    {
      email:
        (await db.select().from(user).where(eq(user.id, who.id)))[0]?.email ??
        "",
      orgId: acme.id,
      role: "member",
      teamIds: [],
    },
    as(maya)
  );
  await call(
    authRouter.orgs.acceptInvitation,
    { token: invitation.token ?? "" },
    as(who)
  );
}

const put = (
  space: typeof design,
  who: { id: UserId },
  role: "owner" | "member"
) =>
  call(
    authRouter.spaces.setMember,
    { ...space, role, userId: who.id },
    as(maya)
  );
await put(design, demo, "owner");
await put(design, sam, "member");
await put(brand, sam, "owner");
await put(brand, lee, "member");
await put(eng, maya, "owner");
await put(eng, demo, "member");
await put(eng, lee, "member");

const item = async (
  table: typeof agent | typeof skill,
  owner: { id: UserId },
  name: string,
  description: string
) => {
  const [row] = await db
    .insert(table)
    .values({
      createdBy: owner.id,
      description,
      name,
      ownerId: owner.id,
      ownerType: "user",
    })
    .returning();
  return row?.id as LibraryItemId;
};
const chat = async (
  owner: { id: UserId },
  title: string,
  space: typeof design
) => {
  const [row] = await db
    .insert(conversation)
    .values({
      contextId: space.id,
      contextType: "team",
      ownerId: owner.id,
      title,
    })
    .returning();
  return row?.id as string;
};
const share = (
  who: { context: HandlerContext },
  space: SpaceArg,
  resourceType: "agent" | "skill" | "conversation",
  resourceId: string
) =>
  call(
    authRouter.spaces.share,
    { ...space, resourceId, resourceType },
    as(who)
  );

await share(
  maya,
  root,
  "agent",
  await item(
    agent,
    maya,
    "Acme writing style",
    "House style for anything customers read."
  )
);
await share(
  maya,
  root,
  "skill",
  await item(skill, maya, "Expense policy", "What can be expensed, and how.")
);
await share(
  demo,
  design,
  "skill",
  await item(
    skill,
    demo,
    "Figma handoff checklist",
    "What a design needs before it goes to engineering."
  )
);
await share(
  demo,
  design,
  "agent",
  await item(
    agent,
    demo,
    "Design critic",
    "Critiques a design against its goals."
  )
);
await share(
  demo,
  design,
  "conversation",
  await chat(demo, "Q4 launch moodboard", design)
);
await share(
  sam,
  brand,
  "agent",
  await item(
    agent,
    sam,
    "Brand voice reviewer",
    "Checks copy against the brand voice."
  )
);
await share(
  sam,
  brand,
  "conversation",
  await chat(sam, "Logo refresh feedback", brand)
);
await share(
  maya,
  eng,
  "skill",
  await item(
    skill,
    maya,
    "Code review rubric",
    "How Acme reviews pull requests."
  )
);
await share(
  maya,
  eng,
  "conversation",
  await chat(maya, "Incident retro: checkout outage", eng)
);

await call(
  authRouter.spaces.setAllowance,
  { ...design, monthlyTokens: 2_000_000 },
  as(demo)
);
await call(
  authRouter.spaces.setAllowance,
  { ...brand, monthlyTokens: 500_000 },
  as(sam)
);
const samAsk = await call(
  authRouter.spaces.requestAllowance,
  {
    ...design,
    monthlyTokens: 300_000,
    note: "Moodboards and copy drafts for the Q4 launch.",
  },
  as(sam)
);
await call(
  authRouter.spaces.decideAllowance,
  { ...design, decision: "approved", grantId: samAsk.id },
  as(demo)
);
await call(
  authRouter.spaces.requestAllowance,
  {
    ...brand,
    monthlyTokens: 120_000,
    note: "Logo exploration with image prompts.",
  },
  as(lee)
);

// An admin-created key in Design. Not a real key: it's only ever looked up
// for Anthropic models, which the demo doesn't run; it exists so usage has
// a key to be counted against.
for (const [label, provider, hint] of [
  ["Design team (Anthropic)", "anthropic", "q9Xf"],
  ["Design prototypes (OpenAI)", "openai", "7mKd"],
] as const) {
  // biome-ignore lint/performance/noAwaitInLoops: a one-off seed; each step reads what the last wrote
  await db.insert(providerKey).values({
    createdBy: demo.id,
    encryptedKey: "demo-placeholder-not-a-key",
    hint,
    keyId: "demo",
    label,
    provider,
    scopeId: design.id,
    scopeType: "team",
  });
}
const now = Date.now();
const usage: [typeof demo, "anthropic" | "openai", number, number][] = [
  [demo, "anthropic", 42_000, 9000],
  [demo, "anthropic", 18_500, 4200],
  [sam, "anthropic", 61_000, 15_500],
  [sam, "openai", 12_000, 3100],
  [demo, "openai", 8000, 2600],
];
for (const [
  index,
  [who, provider, inputTokens, outputTokens],
] of usage.entries()) {
  // biome-ignore lint/performance/noAwaitInLoops: a one-off seed; each step reads what the last wrote
  await recordTransaction(
    db,
    {
      context: { id: design.id, type: "team" },
      costMicros: inputTokens * 3 + outputTokens * 15,
      kind: "chat",
      model:
        provider === "anthropic"
          ? "anthropic:claude-sonnet-4-5"
          : "openai:gpt-5-mini",
      orgId: acme.id as OrgId,
      paidBy: { id: design.id, type: "team" },
      usage: { inputTokens, outputTokens },
      userId: who.id,
    },
    new Date(now - (usage.length - index) * 3_600_000)
  );
}

process.stdout.write(
  "Seeded Acme › Design › Brand and Acme › Engineering › Platform.\nUsers: demo@dots.local, maya@acme.local, sam@acme.local, lee@acme.local (password: SEED_PASSWORD).\n"
);
await close();
