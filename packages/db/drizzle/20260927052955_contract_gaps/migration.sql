CREATE TABLE "invitation_token" (
	"invitation_id" uuid PRIMARY KEY,
	"token_hash" text NOT NULL UNIQUE
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "shortcuts" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "persist_client_cache" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation_token" ADD CONSTRAINT "invitation_token_invitation_id_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitation"("id") ON DELETE CASCADE;