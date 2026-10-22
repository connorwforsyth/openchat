ALTER TABLE "dot_run" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "dot_run" ADD COLUMN "missed_slots" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dot_run" ADD COLUMN "nominal_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "dot_run" ADD COLUMN "notified" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "dot_run" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "dot_run" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "dot_run" ADD COLUMN "read_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "dot_run" ADD COLUMN "skip_reason" text;--> statement-breakpoint
ALTER TABLE "dot_run" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD COLUMN "auto_approve_tools" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD COLUMN "completed_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD COLUMN "ends_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD COLUMN "last_outcome" text;--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD COLUMN "missed_run_policy" text DEFAULT 'run_once' NOT NULL;--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD COLUMN "next_run_nominal_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD COLUMN "notify" text DEFAULT 'important' NOT NULL;--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD COLUMN "paused_reason" text;--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD COLUMN "read_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD COLUMN "rrule" text;--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD COLUMN "start_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD COLUMN "target_kind" text DEFAULT 'dot' NOT NULL;--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "dot_run" ALTER COLUMN "dot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dot_run" ALTER COLUMN "run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dot_schedule" ALTER COLUMN "cron" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dot_schedule" ALTER COLUMN "dot_id" DROP NOT NULL;--> statement-breakpoint
-- Schedules (173): existing ones target their Dot's thread, keep notifying
-- on every run as they did, and get a title from their prompt.
UPDATE "dot_schedule" s SET "owner_id" = d."owner_id", "conversation_id" = d."conversation_id", "notify" = 'all', "title" = left(regexp_replace(s."prompt", '\s+', ' ', 'g'), 60) FROM "dot" d WHERE d."id" = s."dot_id";--> statement-breakpoint
UPDATE "dot_schedule" SET "next_run_nominal_at" = "next_run_at";--> statement-breakpoint
UPDATE "dot_run" r SET "owner_id" = d."owner_id", "conversation_id" = d."conversation_id" FROM "dot" d WHERE d."id" = r."dot_id";--> statement-breakpoint
-- One Dot per user (174): an owner's extra Dots stop being Dots. Each one's
-- chat stays as an ordinary chat, and its schedules keep running there, as
-- every chat schedule does: read-only, on the instance's schedule model (the
-- Dot's model or agent and sandbox don't carry over). They keep the Dot's
-- auto-approved tools, end their prompt with its instructions and rules,
-- and stay paused if the Dot was off. The primary (or else the oldest) Dot
-- stays.
-- A string's length as the contract's limits count it: UTF-16 code units,
-- as JavaScript does, where char_length counts code points.
CREATE FUNCTION pg_temp.utf16_length(t text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT char_length(t) + char_length(regexp_replace(t, '[^\U00010000-\U0010FFFF]', '', 'g'))
$$;--> statement-breakpoint
-- The start of `t` that fits in `n` units (a character short at most).
CREATE FUNCTION pg_temp.utf16_left(t text, n integer) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT left(t, n - greatest(0, pg_temp.utf16_length(left(t, n)) - n))
$$;--> statement-breakpoint
-- What an extra Dot adds to a schedule's prompt: its instructions, then its
-- rules, each under a header. The owner's prompt is never cut. A tail that
-- doesn't fit the 4000-unit limit is cut and says so, unless not even the
-- marker fits. A cut keeps at least one character after a header, or drops
-- that section.
CREATE FUNCTION pg_temp.dot_prompt_tail(prompt text, instructions text, rules text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  sections text[] := array_remove(ARRAY[
    E'\n\nStanding instructions from the owner:\n' || nullif(btrim(instructions, E' \t\r\n'), ''),
    E'\n\nThe owner''s rules on when to act and when to ask:\n' || nullif(btrim(rules, E' \t\r\n'), '')
  ], NULL);
  marker constant text := E'\n[Cut to fit the 4,000-character prompt limit.]';
  room integer := 4000 - pg_temp.utf16_length(prompt);
  kept text := '';
  section text;
BEGIN
  IF pg_temp.utf16_length(array_to_string(sections, '')) <= room THEN
    RETURN array_to_string(sections, '');
  END IF;
  IF room < char_length(marker) THEN
    RETURN '';
  END IF;
  room := room - char_length(marker);
  FOREACH section IN ARRAY sections LOOP
    IF pg_temp.utf16_length(section) > room THEN
      -- The header ends at the first line break after the leading two.
      IF room > strpos(substr(section, 3), E'\n') + 2 THEN
        kept := kept || pg_temp.utf16_left(section, room);
      END IF;
      EXIT;
    END IF;
    kept := kept || section;
    room := room - pg_temp.utf16_length(section);
  END LOOP;
  RETURN kept || marker;
END
$$;--> statement-breakpoint
CREATE TEMP TABLE "extra_dot" AS SELECT "id", "enabled", "auto_approve_tools", "instructions", "rules" FROM "dot" WHERE "id" NOT IN (SELECT DISTINCT ON ("owner_id") "id" FROM "dot" ORDER BY "owner_id", "is_primary" DESC, "created_at", "id");--> statement-breakpoint
UPDATE "dot_schedule" s SET
  "target_kind" = 'conversation',
  "dot_id" = NULL,
  "read_only" = true,
  "auto_approve_tools" = d."auto_approve_tools",
  "enabled" = s."enabled" AND d."enabled",
  "paused_reason" = CASE WHEN d."enabled" THEN s."paused_reason" ELSE 'user' END,
  "next_run_at" = CASE WHEN d."enabled" THEN s."next_run_at" END,
  "next_run_nominal_at" = CASE WHEN d."enabled" THEN s."next_run_nominal_at" END,
  "prompt" = s."prompt" || pg_temp.dot_prompt_tail(s."prompt", d."instructions", d."rules")
FROM "extra_dot" d WHERE s."dot_id" = d."id";--> statement-breakpoint
UPDATE "dot_run" SET "dot_id" = NULL WHERE "dot_id" IN (SELECT "id" FROM "extra_dot");--> statement-breakpoint
DELETE FROM "dot" WHERE "id" IN (SELECT "id" FROM "extra_dot");--> statement-breakpoint
DROP TABLE "extra_dot";--> statement-breakpoint
UPDATE "dot" SET "is_primary" = true;--> statement-breakpoint
ALTER TABLE "dot_run" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dot_schedule" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dot_owner_uidx" ON "dot" ("owner_id");--> statement-breakpoint
CREATE INDEX "dot_run_schedule_idx" ON "dot_run" ("schedule_id","created_at");--> statement-breakpoint
CREATE INDEX "dot_run_owner_idx" ON "dot_run" ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "dot_schedule_owner_idx" ON "dot_schedule" ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "dot_schedule_conversation_idx" ON "dot_schedule" ("conversation_id");--> statement-breakpoint
ALTER TABLE "dot_run" ADD CONSTRAINT "dot_run_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "dot_run" ADD CONSTRAINT "dot_run_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD CONSTRAINT "dot_schedule_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD CONSTRAINT "dot_schedule_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dot_run" ADD CONSTRAINT "dot_run_outcome" CHECK ("outcome" is null or "outcome" in ('update', 'no_update', 'needs_attention', 'failed', 'skipped'));--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD CONSTRAINT "dot_schedule_target_kind" CHECK ("target_kind" in ('dot', 'conversation', 'new_chat_each_run'));--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD CONSTRAINT "dot_schedule_notify" CHECK ("notify" in ('all', 'failures', 'important', 'none'));--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD CONSTRAINT "dot_schedule_missed_run_policy" CHECK ("missed_run_policy" in ('run_once', 'skip'));--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD CONSTRAINT "dot_schedule_recurrence" CHECK ("cron" is not null or ("rrule" is not null and "start_at" is not null));