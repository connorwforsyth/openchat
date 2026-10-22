ALTER TABLE "dot_run" ADD COLUMN "starting_at" timestamp(3) with time zone;--> statement-breakpoint
-- NOT VALID: rows written before these checks stay, and the run history
-- skips any it can't show; every row written from now on is checked.
ALTER TABLE "dot_run" ADD CONSTRAINT "dot_run_skip_reason" CHECK ("skip_reason" is null or "skip_reason" in ('cap', 'budget', 'target_archived', 'busy', 'missed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "dot_run" ADD CONSTRAINT "dot_run_shape" CHECK (("skip_reason" is null and "outcome" is distinct from 'skipped') or ("skip_reason" is not null and "outcome" is not distinct from 'skipped' and "run_id" is null)) NOT VALID;
