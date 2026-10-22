CREATE TABLE "dot" (
	"auto_approve_tools" jsonb DEFAULT '[]' NOT NULL,
	"conversation_id" uuid NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"id" uuid PRIMARY KEY,
	"instructions" text DEFAULT '' NOT NULL,
	"last_viewed_at" timestamp(3) with time zone,
	"name" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"sandbox_provider" text,
	"target" jsonb NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dot_run" (
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"dot_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY,
	"run_id" uuid NOT NULL,
	"schedule_id" uuid,
	"trigger" text NOT NULL,
	CONSTRAINT "dot_run_trigger" CHECK ("trigger" in ('schedule', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "dot_schedule" (
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"cron" text NOT NULL,
	"dot_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"id" uuid PRIMARY KEY,
	"last_run_at" timestamp(3) with time zone,
	"last_status" text,
	"next_run_at" timestamp(3) with time zone,
	"prompt" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dot_schedule_last_status" CHECK ("last_status" is null or "last_status" in ('queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX "dot_owner_idx" ON "dot" ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dot_conversation_uidx" ON "dot" ("conversation_id");--> statement-breakpoint
CREATE INDEX "dot_run_dot_idx" ON "dot_run" ("dot_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dot_run_run_uidx" ON "dot_run" ("run_id");--> statement-breakpoint
CREATE INDEX "dot_schedule_dot_idx" ON "dot_schedule" ("dot_id");--> statement-breakpoint
CREATE INDEX "dot_schedule_due_idx" ON "dot_schedule" ("next_run_at") WHERE "enabled" and "next_run_at" is not null;--> statement-breakpoint
ALTER TABLE "dot" ADD CONSTRAINT "dot_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dot" ADD CONSTRAINT "dot_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dot_run" ADD CONSTRAINT "dot_run_dot_id_dot_id_fkey" FOREIGN KEY ("dot_id") REFERENCES "dot"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dot_run" ADD CONSTRAINT "dot_run_run_id_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dot_run" ADD CONSTRAINT "dot_run_schedule_id_dot_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "dot_schedule"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "dot_schedule" ADD CONSTRAINT "dot_schedule_dot_id_dot_id_fkey" FOREIGN KEY ("dot_id") REFERENCES "dot"("id") ON DELETE CASCADE;