import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, it } from "vitest";

import { MIGRATIONS_FOLDER } from "./migrator";

const ONE_DOT = "20261019140208_schedules";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const migratedBefore = async (before: string): Promise<PGlite> => {
  const client = await PGlite.create({ extensions: { vector } });
  closers.push(() => client.close());
  const dir = await mkdtemp(join(tmpdir(), "migrations-"));
  closers.push(() => rm(dir, { force: true, recursive: true }));
  const names = (await readdir(MIGRATIONS_FOLDER)).filter(
    (name) => name < before
  );
  await Promise.all(
    names.map((name) => symlink(join(MIGRATIONS_FOLDER, name), join(dir, name)))
  );
  await migrate(drizzle({ client }), { migrationsFolder: dir });
  return client;
};

const MODEL = JSON.stringify({ model: "test:model", type: "model" });
const CUT = "\n[Cut to fit the 4,000-character prompt limit.]";

describe("the one-Dot migration", () => {
  it("keeps the primary Dot and turns an extra Dot's schedules into guarded chat schedules", async () => {
    const db = await migratedBefore(ONE_DOT);
    const [ann, bo, org] = [randomUUID(), randomUUID(), randomUUID()];
    const [primaryChat, extraChat, boChat] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    const [primary, extra, off, bos] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    const offChat = randomUUID();
    const [primarySchedule, extraSchedule, offSchedule] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    const long = `Summarise the week. ${"x".repeat(3920)}`;
    const [message, extraRun] = [randomUUID(), randomUUID()];

    await db.query(
      `insert into "user" (id, name, email) values ($1, 'Ann', 'ann@example.com'), ($2, 'Bo', 'bo@example.com')`,
      [ann, bo]
    );
    await db.query(
      `insert into organization (id, name, slug) values ($1, 'Ann', 'ann')`,
      [org]
    );
    await db.query(
      `insert into conversation (id, owner_id, context_id, context_type) values ($1, $4, $6, 'personal'), ($2, $4, $6, 'personal'), ($3, $5, $6, 'personal'), ($7, $4, $6, 'personal')`,
      [primaryChat, extraChat, boChat, ann, bo, org, offChat]
    );
    await db.query(
      `insert into dot (id, owner_id, conversation_id, name, handle, target, is_primary, created_at, instructions, rules, auto_approve_tools) values
        ($1, $4, $5, 'Morning brief', 'morning', $8, true, '2026-10-02', 'Be brief.', '', '[]'),
        ($2, $4, $6, 'Build watch', 'build', $8, false, '2026-10-01', 'Watch the release build.', 'Ask before you open an issue.', '["deploy"]'),
        ($3, $7, $9, 'Pip', 'pip', $8, true, '2026-10-01', '', '', '[]')`,
      [primary, extra, bos, ann, primaryChat, extraChat, bo, MODEL, boChat]
    );
    await db.query(
      `insert into dot (id, owner_id, conversation_id, name, handle, target, created_at, enabled, instructions, rules) values ($1, $2, $3, 'Weekly', 'weekly', $4, '2026-10-03', false, E'\n  Keep it short. Lead with what changed.\n', E' \n')`,
      [off, ann, offChat, MODEL]
    );
    await db.query(
      `insert into dot_schedule (id, dot_id, cron, prompt, next_run_at) values ($1, $3, '0 8 * * *', 'Brief me on today.', null), ($2, $4, '0 * * * *', 'Is the build green?', null), ($5, $6, '0 9 * * 1', $7, '2026-10-05 09:00Z')`,
      [primarySchedule, extraSchedule, primary, extra, offSchedule, off, long]
    );
    await db.query(
      `insert into message (id, conversation_id, role, parts) values ($1, $2, 'user', '[]')`,
      [message, extraChat]
    );
    await db.query(
      `insert into run (id, conversation_id, created_by, context_id, context_type, status, target, user_message_id) values ($1, $2, $3, $4, 'personal', 'succeeded', $5, $6)`,
      [extraRun, extraChat, ann, org, MODEL, message]
    );
    await db.query(
      `insert into dot_run (id, dot_id, run_id, schedule_id, trigger) values ($1, $2, $3, $4, 'schedule')`,
      [randomUUID(), extra, extraRun, extraSchedule]
    );

    await migrate(drizzle({ client: db }), {
      migrationsFolder: MIGRATIONS_FOLDER,
    });

    const dots = await db.query<{ id: string; is_primary: boolean }>(
      "select id, is_primary from dot order by created_at"
    );
    expect(dots.rows).toEqual([
      { id: bos, is_primary: true },
      { id: primary, is_primary: true },
    ]);
    const chats = await db.query<{ id: string }>(
      "select id from conversation where id in ($1, $2)",
      [extraChat, offChat]
    );
    expect(chats.rows).toHaveLength(2);

    const schedules = await db.query<Record<string, unknown>>(
      "select id, target_kind, dot_id, conversation_id, owner_id, read_only, auto_approve_tools, enabled, paused_reason, next_run_at, title, prompt from dot_schedule order by prompt"
    );
    expect(schedules.rows).toEqual([
      {
        auto_approve_tools: [],
        conversation_id: primaryChat,
        dot_id: primary,
        enabled: true,
        id: primarySchedule,
        next_run_at: null,
        owner_id: ann,
        paused_reason: null,
        prompt: "Brief me on today.",
        read_only: false,
        target_kind: "dot",
        title: "Brief me on today.",
      },
      {
        auto_approve_tools: ["deploy"],
        conversation_id: extraChat,
        dot_id: null,
        enabled: true,
        id: extraSchedule,
        next_run_at: null,
        owner_id: ann,
        paused_reason: null,
        prompt: [
          "Is the build green?",
          "Standing instructions from the owner:\nWatch the release build.",
          "The owner's rules on when to act and when to ask:\nAsk before you open an issue.",
        ].join("\n\n"),
        read_only: true,
        target_kind: "conversation",
        title: "Is the build green?",
      },
      {
        auto_approve_tools: [],
        conversation_id: offChat,
        dot_id: null,
        enabled: false,
        id: offSchedule,
        next_run_at: null,
        owner_id: ann,
        paused_reason: "user",
        prompt: `${long}${"\n\nStanding instructions from the owner:\nKeep it short. Lead with what changed.".slice(0, 4000 - long.length - CUT.length)}${CUT}`,
        read_only: true,
        target_kind: "conversation",
        title: long.slice(0, 60),
      },
    ]);

    const history = await db.query<Record<string, unknown>>(
      "select dot_id, owner_id, conversation_id, schedule_id from dot_run"
    );
    expect(history.rows).toEqual([
      {
        conversation_id: extraChat,
        dot_id: null,
        owner_id: ann,
        schedule_id: extraSchedule,
      },
    ]);
  });
});
