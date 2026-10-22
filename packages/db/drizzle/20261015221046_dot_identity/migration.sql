ALTER TABLE "dot" ADD COLUMN "avatar_color" text DEFAULT 'sea' NOT NULL;--> statement-breakpoint
ALTER TABLE "dot" ADD COLUMN "avatar_style" text DEFAULT 'orb' NOT NULL;--> statement-breakpoint
ALTER TABLE "dot" ADD COLUMN "handle" text;--> statement-breakpoint
-- Existing Dots (172) get a handle from their id, and each owner's oldest
-- Dot becomes primary; new ones get theirs from the server.
UPDATE "dot" SET "handle" = 'dot-' || substr(replace("id"::text, '-', ''), 1, 8);--> statement-breakpoint
ALTER TABLE "dot" ALTER COLUMN "handle" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dot" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dot" ADD COLUMN "rules" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "dot" SET "is_primary" = true WHERE "id" IN (SELECT DISTINCT ON ("owner_id") "id" FROM "dot" ORDER BY "owner_id", "created_at", "id");--> statement-breakpoint
CREATE UNIQUE INDEX "dot_owner_handle_uidx" ON "dot" ("owner_id","handle");--> statement-breakpoint
CREATE UNIQUE INDEX "dot_owner_primary_uidx" ON "dot" ("owner_id") WHERE "is_primary";--> statement-breakpoint
ALTER TABLE "dot" ADD CONSTRAINT "dot_avatar_color" CHECK ("avatar_color" in ('ember', 'sun', 'moss', 'sea', 'dusk', 'bloom'));--> statement-breakpoint
ALTER TABLE "dot" ADD CONSTRAINT "dot_avatar_style" CHECK ("avatar_style" in ('orb', 'blob', 'ring', 'spark', 'pebble'));