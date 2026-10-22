CREATE TABLE "mcp_conversation_connector" (
	"conversation_id" uuid,
	"enabled" boolean,
	"mcp_server_id" uuid,
	"tools" jsonb DEFAULT '{}' NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	CONSTRAINT "mcp_conversation_connector_pkey" PRIMARY KEY("conversation_id","user_id","mcp_server_id")
);
--> statement-breakpoint
ALTER TABLE "mcp_connector_pref" ADD COLUMN "tools" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_connector_pref" ALTER COLUMN "enabled" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_conversation_connector" ADD CONSTRAINT "mcp_conversation_connector_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mcp_conversation_connector" ADD CONSTRAINT "mcp_conversation_connector_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;