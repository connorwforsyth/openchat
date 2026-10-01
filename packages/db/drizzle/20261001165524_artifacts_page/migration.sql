CREATE TABLE "artifact_grant" (
	"artifact_id" uuid NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid NOT NULL,
	"id" uuid PRIMARY KEY,
	"permission" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"principal_type" text NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_grant_permission" CHECK ("permission" in ('viewer', 'editor')),
	CONSTRAINT "artifact_grant_principal_type" CHECK ("principal_type" in ('user', 'team', 'org'))
);
--> statement-breakpoint
CREATE TABLE "artifact_use" (
	"added_by" uuid NOT NULL,
	"artifact_id" uuid,
	"conversation_id" uuid,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_use_pkey" PRIMARY KEY("artifact_id","conversation_id")
);
--> statement-breakpoint
CREATE TABLE "artifact_view" (
	"artifact_id" uuid,
	"user_id" uuid,
	"viewed_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_view_pkey" PRIMARY KEY("artifact_id","user_id")
);
--> statement-breakpoint
-- Hand-edited (124): existing rows are backfilled before the columns turn
-- NOT NULL. An artifact's owner is its chat's owner, and each version was
-- made in the artifact's own chat (nothing could be used elsewhere before).
ALTER TABLE "artifact" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
UPDATE "artifact" SET "owner_id" = "conversation"."owner_id" FROM "conversation" WHERE "conversation"."id" = "artifact"."conversation_id";--> statement-breakpoint
ALTER TABLE "artifact" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "artifact_version" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
UPDATE "artifact_version" SET "conversation_id" = "artifact"."conversation_id" FROM "artifact" WHERE "artifact"."id" = "artifact_version"."artifact_id";--> statement-breakpoint
ALTER TABLE "artifact_version" ALTER COLUMN "conversation_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "artifact_owner_idx" ON "artifact" ("owner_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_grant_principal_uidx" ON "artifact_grant" ("artifact_id","principal_type","principal_id");--> statement-breakpoint
CREATE INDEX "artifact_grant_held_by_idx" ON "artifact_grant" ("principal_type","principal_id");--> statement-breakpoint
CREATE INDEX "artifact_use_conversation_idx" ON "artifact_use" ("conversation_id");--> statement-breakpoint
CREATE INDEX "artifact_view_user_idx" ON "artifact_view" ("user_id","viewed_at");--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact_grant" ADD CONSTRAINT "artifact_grant_artifact_id_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifact"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact_grant" ADD CONSTRAINT "artifact_grant_granted_by_user_id_fkey" FOREIGN KEY ("granted_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact_use" ADD CONSTRAINT "artifact_use_added_by_user_id_fkey" FOREIGN KEY ("added_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact_use" ADD CONSTRAINT "artifact_use_artifact_id_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifact"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact_use" ADD CONSTRAINT "artifact_use_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact_version" ADD CONSTRAINT "artifact_version_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact_view" ADD CONSTRAINT "artifact_view_artifact_id_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifact"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact_view" ADD CONSTRAINT "artifact_view_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;