ALTER TABLE "conversation" ADD COLUMN "mode" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "mode" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_mode" CHECK ("mode" in ('chat', 'code'));--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_mode" CHECK ("mode" in ('chat', 'code'));