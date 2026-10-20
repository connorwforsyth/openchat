#!/usr/bin/env bun
/**
 * Creates a chain of sub-spaces (ticket 188) for someone with only Postgres
 * access: `bun run spaces:chain <org-slug> "Design/Brand/Social"`. Each
 * level is found by name under its parent, or created, so re-running is
 * safe. Members are added in the app afterwards (Space settings › Members).
 */
import { and, eq, isNull } from "drizzle-orm";

import { connect } from "../client";
import { organization } from "../schema/auth";
import { team } from "../schema/tenancy";

const [slug, path] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!(slug && path && url)) {
  process.stderr.write(
    'Usage: DATABASE_URL=… bun run spaces:chain <org-slug> "A/B/C"\n'
  );
  process.exit(1);
}
const connection = connect(url);
if (!connection.ok) {
  process.stderr.write("DATABASE_URL must be a postgres:// URL.\n");
  process.exit(1);
}
const { db, close } = connection.value;
const [org] = await db
  .select()
  .from(organization)
  .where(eq(organization.slug, slug));
if (!org) {
  process.stderr.write(`No space with the slug ${slug}.\n`);
  await close();
  process.exit(1);
}

const names = path
  .split("/")
  .map((name) => name.trim())
  .filter(Boolean);
let parentId: (typeof team.$inferSelect)["id"] | null = null;
for (const name of names) {
  // biome-ignore lint/performance/noAwaitInLoops: each level needs its parent's id
  const [found] = await db
    .select()
    .from(team)
    .where(
      and(
        eq(team.orgId, org.id),
        eq(team.name, name),
        parentId === null ? isNull(team.parentId) : eq(team.parentId, parentId)
      )
    );
  const row: typeof team.$inferSelect | undefined =
    found ??
    (
      await db
        .insert(team)
        .values({ name, orgId: org.id, parentId })
        .returning()
    )[0];
  if (!row) {
    throw new Error("insert returned no row");
  }
  process.stdout.write(`${found ? "found" : "created"} ${name}\n`);
  parentId = row.id;
}
await close();
