CREATE TABLE "space_allowance" (
	"monthly_tokens" bigint NOT NULL,
	"org_id" uuid NOT NULL,
	"space_id" uuid,
	"space_type" text,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "space_allowance_pkey" PRIMARY KEY("space_type","space_id"),
	CONSTRAINT "space_allowance_type" CHECK ("space_type" in ('org', 'team')),
	CONSTRAINT "space_allowance_non_negative" CHECK ("monthly_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "space_allowance_grant" (
	"decided_at" timestamp(3) with time zone,
	"decided_by" uuid,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"monthly_tokens" bigint NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"space_id" uuid NOT NULL,
	"space_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "space_allowance_grant_type" CHECK ("space_type" in ('org', 'team')),
	CONSTRAINT "space_allowance_grant_status" CHECK ("status" in ('pending', 'approved', 'denied')),
	CONSTRAINT "space_allowance_grant_positive" CHECK ("monthly_tokens" > 0)
);
--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "provider_key_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "space_allowance_grant_member_uidx" ON "space_allowance_grant" ("space_type","space_id","user_id");--> statement-breakpoint
CREATE INDEX "space_allowance_grant_user_idx" ON "space_allowance_grant" ("user_id");--> statement-breakpoint
CREATE INDEX "transaction_provider_key_idx" ON "transaction" ("provider_key_id","created_at");--> statement-breakpoint
ALTER TABLE "space_allowance" ADD CONSTRAINT "space_allowance_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "space_allowance" ADD CONSTRAINT "space_allowance_updated_by_user_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "space_allowance_grant" ADD CONSTRAINT "space_allowance_grant_decided_by_user_id_fkey" FOREIGN KEY ("decided_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "space_allowance_grant" ADD CONSTRAINT "space_allowance_grant_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "space_allowance_grant" ADD CONSTRAINT "space_allowance_grant_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_provider_key_id_provider_key_id_fkey" FOREIGN KEY ("provider_key_id") REFERENCES "provider_key"("id") ON DELETE SET NULL;