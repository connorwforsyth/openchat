CREATE TABLE "mcp_connector_pref" (
	"enabled" boolean NOT NULL,
	"mcp_server_id" uuid,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	CONSTRAINT "mcp_connector_pref_pkey" PRIMARY KEY("user_id","mcp_server_id")
);
--> statement-breakpoint
ALTER TABLE "mcp_oauth_token" DROP CONSTRAINT "mcp_oauth_token_mcp_server_id_mcp_server_id_fkey";--> statement-breakpoint
ALTER TABLE "mcp_connector_pref" ADD CONSTRAINT "mcp_connector_pref_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;