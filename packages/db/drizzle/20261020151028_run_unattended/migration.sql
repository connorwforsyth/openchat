ALTER TABLE "run" ADD COLUMN "unattended" jsonb;--> statement-breakpoint
-- Runs the engine started before this column: `dot_run`, which only the server writes, names them.
UPDATE "run" r SET "unattended" = CASE WHEN dr."schedule_id" IS NULL THEN '{"type":"check_in"}'::jsonb ELSE jsonb_build_object('type', 'schedule', 'scheduleId', dr."schedule_id") END FROM "dot_run" dr WHERE dr."run_id" = r."id";
