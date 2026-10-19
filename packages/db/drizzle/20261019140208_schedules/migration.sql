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
-- chat stays as an ordinary chat, and its schedules keep running, now as
-- schedules on that chat. The primary (or else the oldest) Dot stays.
CREATE TEMP TABLE "extra_dot" AS SELECT "id", "conversation_id" FROM "dot" WHERE "id" NOT IN (SELECT DISTINCT ON ("owner_id") "id" FROM "dot" ORDER BY "owner_id", "is_primary" DESC, "created_at", "id");--> statement-breakpoint
UPDATE "dot_schedule" SET "target_kind" = 'conversation', "dot_id" = NULL, "read_only" = false WHERE "dot_id" IN (SELECT "id" FROM "extra_dot");--> statement-breakpoint
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