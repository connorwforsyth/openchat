CREATE TABLE "artifact_publication" (
	"artifact_id" uuid PRIMARY KEY,
	"published_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"published_by" uuid NOT NULL,
	"token" text NOT NULL,
	"version_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_publication_token_uidx" ON "artifact_publication" ("token");--> statement-breakpoint
ALTER TABLE "artifact_publication" ADD CONSTRAINT "artifact_publication_artifact_id_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifact"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact_publication" ADD CONSTRAINT "artifact_publication_published_by_user_id_fkey" FOREIGN KEY ("published_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact_publication" ADD CONSTRAINT "artifact_publication_version_id_artifact_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "artifact_version"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact" DROP CONSTRAINT "artifact_kind", ADD CONSTRAINT "artifact_kind" CHECK ("kind" in ('code', 'html', 'react', 'markdown', 'svg', 'mermaid', 'site'));