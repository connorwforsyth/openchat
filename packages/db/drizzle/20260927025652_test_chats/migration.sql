ALTER TABLE "conversation" ADD COLUMN "purpose" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "agent_draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "conversation_test_idx" ON "conversation" ("created_at") WHERE "purpose" = 'test';--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_purpose" CHECK ("purpose" in ('chat', 'test'));