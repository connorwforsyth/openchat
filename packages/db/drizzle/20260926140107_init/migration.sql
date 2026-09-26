CREATE TABLE "resource_grant" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid NOT NULL,
	"id" uuid PRIMARY KEY,
	"permission" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"principal_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_grant_resource_type" CHECK ("resource_type" in ('conversation', 'agent', 'prompt', 'skill', 'mcp_server', 'preset')),
	CONSTRAINT "resource_grant_principal_type" CHECK ("principal_type" in ('user', 'team', 'org')),
	CONSTRAINT "resource_grant_permission" CHECK (("resource_type" = 'conversation' and "permission" in ('viewer', 'editor')) or ("resource_type" <> 'conversation' and "permission" in ('use', 'view', 'edit')))
);
--> statement-breakpoint
CREATE TABLE "share_link" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"id" uuid PRIMARY KEY,
	"resource_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"token" text NOT NULL,
	CONSTRAINT "share_link_resource_type" CHECK ("resource_type" in ('conversation', 'agent', 'prompt', 'skill', 'mcp_server', 'preset'))
);
--> statement-breakpoint
CREATE TABLE "account" (
	"access_token" text,
	"access_token_expires_at" timestamp with time zone,
	"account_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY,
	"id_token" text,
	"password" text,
	"provider_id" text NOT NULL,
	"refresh_token" text,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY,
	"inviter_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY,
	"is_personal" boolean DEFAULT false NOT NULL,
	"logo" text,
	"metadata" text,
	"name" text NOT NULL,
	"slug" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"active_organization_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY,
	"impersonated_by" text,
	"ip_address" text,
	"token" text NOT NULL UNIQUE,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"ban_expires" timestamp with time zone,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"id" uuid PRIMARY KEY,
	"image" text,
	"locale" text,
	"name" text NOT NULL,
	"role" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"default_context" jsonb DEFAULT '{"type":"personal"}' NOT NULL,
	"default_target" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY,
	"identifier" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"archived_at" timestamp with time zone,
	"context_id" uuid NOT NULL,
	"context_locked_at" timestamp with time zone,
	"context_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"default_target" jsonb,
	"id" uuid PRIMARY KEY,
	"last_message_at" timestamp with time zone,
	"owner_id" uuid NOT NULL,
	"title" text,
	"title_search" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("title", ''))) STORED,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_context_type" CHECK ("context_type" in ('personal', 'team', 'org'))
);
--> statement-breakpoint
CREATE TABLE "conversation_participant" (
	"active_leaf_id" uuid,
	"conversation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"following_user_id" uuid,
	"last_read_at" timestamp with time zone,
	"pinned_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	CONSTRAINT "conversation_participant_pkey" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "message" (
	"agent_id" uuid,
	"agent_version_id" uuid,
	"author_id" uuid,
	"conversation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY,
	"model" text,
	"parent_id" uuid,
	"parts" jsonb NOT NULL,
	"parts_version" integer DEFAULT 1 NOT NULL,
	"role" text NOT NULL,
	"run_id" uuid,
	"status" text DEFAULT 'complete' NOT NULL,
	"text_search" tsvector GENERATED ALWAYS AS (to_tsvector('simple', jsonb_path_query_array("parts", '$[*] ? (@.type == "text").text'))) STORED,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"usage" jsonb,
	CONSTRAINT "message_conversation_id_id_unique" UNIQUE("conversation_id","id"),
	CONSTRAINT "message_parent_not_self" CHECK ("parent_id" <> "id"),
	CONSTRAINT "message_role" CHECK ("role" in ('user', 'assistant', 'system')),
	CONSTRAINT "message_status" CHECK ("status" in ('complete', 'partial', 'error'))
);
--> statement-breakpoint
CREATE TABLE "run" (
	"after_run_id" uuid,
	"approvals" jsonb,
	"assistant_message_id" uuid,
	"cancelled_by" uuid,
	"context_id" uuid NOT NULL,
	"context_type" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"error" jsonb,
	"executor" text,
	"finished_at" timestamp with time zone,
	"id" uuid PRIMARY KEY,
	"idempotency_key" text,
	"last_seq" integer DEFAULT 0 NOT NULL,
	"options" jsonb,
	"resolved_model" text,
	"started_at" timestamp with time zone,
	"status" text NOT NULL,
	"target" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"usage" jsonb,
	"user_message_id" uuid NOT NULL,
	CONSTRAINT "run_status" CHECK ("status" in ('queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "run_context_type" CHECK ("context_type" in ('personal', 'team', 'org')),
	CONSTRAINT "run_last_seq_non_negative" CHECK ("last_seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "run_chunk" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"run_id" uuid,
	"seq" integer,
	CONSTRAINT "run_chunk_pkey" PRIMARY KEY("run_id","seq"),
	CONSTRAINT "run_chunk_seq_positive" CHECK ("seq" >= 1)
);
--> statement-breakpoint
CREATE TABLE "artifact" (
	"conversation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY,
	"kind" text NOT NULL,
	"latest_version_id" uuid,
	"message_id" uuid NOT NULL,
	"title" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_kind" CHECK ("kind" in ('code', 'html', 'react', 'markdown', 'svg', 'mermaid'))
);
--> statement-breakpoint
CREATE TABLE "artifact_version" (
	"artifact_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY,
	"language" text,
	"message_id" uuid NOT NULL,
	"number" integer NOT NULL,
	CONSTRAINT "artifact_version_number_positive" CHECK ("number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "file" (
	"conversation_id" uuid,
	"chunk_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"embedding_model" text,
	"id" uuid PRIMARY KEY,
	"media_type" text NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"sha256" text,
	"size" bigint NOT NULL,
	"state" text DEFAULT 'uploaded' NOT NULL,
	"state_message" text,
	"storage_driver" text NOT NULL,
	"storage_key" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_purpose" CHECK ("purpose" in ('attachment', 'knowledge', 'skill')),
	CONSTRAINT "file_state" CHECK ("state" in ('uploaded', 'processing', 'ready', 'failed')),
	CONSTRAINT "file_storage_driver" CHECK ("storage_driver" in ('local', 's3')),
	CONSTRAINT "file_size_non_negative" CHECK ("size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "file_chunk" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dimensions" integer,
	"embedding" vector,
	"embedding_model" text,
	"file_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY,
	"ordinal" integer NOT NULL,
	"page" integer,
	"text" text NOT NULL,
	"token_count" integer,
	CONSTRAINT "file_chunk_embedding_recorded" CHECK (("embedding" is null and "embedding_model" is null and "dimensions" is null) or ("embedding" is not null and "embedding_model" is not null and "dimensions" = vector_dims("embedding")))
);
--> statement-breakpoint
CREATE TABLE "skill_file" (
	"file_id" uuid NOT NULL,
	"path" text,
	"skill_version_id" uuid,
	CONSTRAINT "skill_file_pkey" PRIMARY KEY("skill_version_id","path")
);
--> statement-breakpoint
CREATE TABLE "agent" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text,
	"id" uuid PRIMARY KEY,
	"maintainers" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"owner_type" text NOT NULL,
	"published_from" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"draft_version_id" uuid,
	"latest_version_id" uuid,
	CONSTRAINT "agent_owner_type" CHECK ("owner_type" in ('user', 'team', 'org'))
);
--> statement-breakpoint
CREATE TABLE "agent_version" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"id" uuid PRIMARY KEY,
	"notes" text,
	"number" integer,
	"published_at" timestamp with time zone,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"definition" jsonb NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "agent_version_status" CHECK ("status" in ('draft', 'published')),
	CONSTRAINT "agent_version_published_shape" CHECK (("status" = 'draft' and "number" is null and "published_at" is null) or ("status" = 'published' and "number" >= 1 and "published_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "mcp_oauth_token" (
	"ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"key_id" text NOT NULL,
	"mcp_server_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	CONSTRAINT "mcp_oauth_token_pkey" PRIMARY KEY("mcp_server_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_server" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text,
	"id" uuid PRIMARY KEY,
	"maintainers" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"owner_type" text NOT NULL,
	"published_from" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"definition" jsonb NOT NULL,
	"secret_ciphertext" text,
	"secret_key_id" text,
	CONSTRAINT "mcp_server_owner_type" CHECK ("owner_type" in ('user', 'team', 'org')),
	CONSTRAINT "mcp_server_secret_key_id" CHECK (("secret_ciphertext" is null) = ("secret_key_id" is null))
);
--> statement-breakpoint
CREATE TABLE "preset" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text,
	"id" uuid PRIMARY KEY,
	"maintainers" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"owner_type" text NOT NULL,
	"published_from" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"definition" jsonb NOT NULL,
	CONSTRAINT "preset_owner_type" CHECK ("owner_type" in ('user', 'team', 'org'))
);
--> statement-breakpoint
CREATE TABLE "prompt" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text,
	"id" uuid PRIMARY KEY,
	"maintainers" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"owner_type" text NOT NULL,
	"published_from" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"draft_version_id" uuid,
	"latest_version_id" uuid,
	CONSTRAINT "prompt_owner_type" CHECK ("owner_type" in ('user', 'team', 'org'))
);
--> statement-breakpoint
CREATE TABLE "prompt_version" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"id" uuid PRIMARY KEY,
	"notes" text,
	"number" integer,
	"published_at" timestamp with time zone,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"definition" jsonb NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "prompt_version_status" CHECK ("status" in ('draft', 'published')),
	CONSTRAINT "prompt_version_published_shape" CHECK (("status" = 'draft' and "number" is null and "published_at" is null) or ("status" = 'published' and "number" >= 1 and "published_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "skill" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text,
	"id" uuid PRIMARY KEY,
	"maintainers" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"owner_type" text NOT NULL,
	"published_from" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"draft_version_id" uuid,
	"latest_version_id" uuid,
	CONSTRAINT "skill_owner_type" CHECK ("owner_type" in ('user', 'team', 'org'))
);
--> statement-breakpoint
CREATE TABLE "skill_version" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"id" uuid PRIMARY KEY,
	"notes" text,
	"number" integer,
	"published_at" timestamp with time zone,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"definition" jsonb NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "skill_version_status" CHECK ("status" in ('draft', 'published')),
	CONSTRAINT "skill_version_published_shape" CHECK (("status" = 'draft' and "number" is null and "published_at" is null) or ("status" = 'published' and "number" >= 1 and "published_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "memory" (
	"content" text DEFAULT '' NOT NULL,
	"current_version_id" uuid,
	"mode" text DEFAULT 'auto' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid PRIMARY KEY,
	CONSTRAINT "memory_mode" CHECK ("mode" in ('auto', 'propose'))
);
--> statement-breakpoint
CREATE TABLE "memory_version" (
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY,
	"number" integer NOT NULL,
	"source" jsonb NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "memory_version_number_positive" CHECK ("number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "decision_log" (
	"adapter" text NOT NULL,
	"answer" jsonb,
	"conversation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text,
	"id" uuid PRIMARY KEY,
	"latency_ms" integer NOT NULL,
	"model" text,
	"purpose" text NOT NULL,
	"question" jsonb NOT NULL,
	"run_id" uuid,
	"user_id" uuid,
	CONSTRAINT "decision_log_adapter" CHECK ("adapter" in ('llm-fallback', 'jev', 'rules')),
	CONSTRAINT "decision_log_purpose" CHECK ("purpose" in ('auto-route', 'retrieval-gate', 'risk-score', 'context-select', 'addressed-to-ai', 'intent', 'moderation', 'quality-score')),
	CONSTRAINT "decision_log_latency_non_negative" CHECK ("latency_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "eval_case" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dataset_id" uuid NOT NULL,
	"expected" jsonb,
	"id" uuid PRIMARY KEY,
	"input" jsonb NOT NULL,
	"rubric" text,
	"source_message_id" uuid
);
--> statement-breakpoint
CREATE TABLE "eval_dataset" (
	"agent_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_result" (
	"case_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"details" jsonb,
	"id" uuid PRIMARY KEY,
	"output" jsonb,
	"passed" boolean,
	"run_id" uuid NOT NULL,
	"score" real,
	"scorer" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_run" (
	"agent_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"dataset_id" uuid NOT NULL,
	"finished_at" timestamp with time zone,
	"id" uuid PRIMARY KEY,
	"passed" integer,
	"started_at" timestamp with time zone,
	"status" text NOT NULL,
	"total" integer,
	CONSTRAINT "eval_run_status" CHECK ("status" in ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY,
	"message_id" uuid NOT NULL,
	"rating" text NOT NULL,
	"share_with_maintainers" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "feedback_rating" CHECK ("rating" in ('up', 'down'))
);
--> statement-breakpoint
CREATE TABLE "quality_score" (
	"agent_version_id" uuid,
	"context_id" uuid NOT NULL,
	"context_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY,
	"message_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"model" text,
	"score" real NOT NULL,
	"scorer" text NOT NULL,
	CONSTRAINT "quality_score_context_type" CHECK ("context_type" in ('personal', 'team', 'org')),
	CONSTRAINT "quality_score_range" CHECK ("score" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "sandbox" (
	"conversation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"external_id" text,
	"id" uuid PRIMARY KEY,
	"isolation" text NOT NULL,
	"limits" jsonb NOT NULL,
	"previews" jsonb DEFAULT '[]' NOT NULL,
	"provider" text NOT NULL,
	"snapshot_ref" text,
	"state" text NOT NULL,
	"state_message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_provider" CHECK ("provider" in ('just-bash', 'docker', 'e2b', 'vercel', 'microsandbox', 'local')),
	CONSTRAINT "sandbox_isolation" CHECK ("isolation" in ('gvisor', 'container', 'vm', 'simulated', 'none')),
	CONSTRAINT "sandbox_state" CHECK ("state" in ('provisioning', 'ready', 'stopped', 'failed', 'destroyed'))
);
--> statement-breakpoint
CREATE TABLE "budget" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hard" boolean DEFAULT true NOT NULL,
	"id" uuid PRIMARY KEY,
	"limit_micros" bigint NOT NULL,
	"org_id" uuid NOT NULL,
	"period" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"principal_type" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_period" CHECK ("period" in ('day', 'week', 'month')),
	CONSTRAINT "budget_principal_type" CHECK ("principal_type" in ('user', 'team', 'org')),
	CONSTRAINT "budget_limit_non_negative" CHECK ("limit_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invitation_team" (
	"invitation_id" uuid,
	"team_id" uuid,
	CONSTRAINT "invitation_team_pkey" PRIMARY KEY("invitation_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "org_settings" (
	"audit_enabled" boolean DEFAULT false NOT NULL,
	"chat_contexts" text[] DEFAULT '{personal,team,org}'::text[] NOT NULL,
	"org_id" uuid PRIMARY KEY,
	"personal_key_fallback" boolean DEFAULT false NOT NULL,
	"publish_gate" text DEFAULT 'informational' NOT NULL,
	"sampled_scoring" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "org_settings_publish_gate" CHECK ("publish_gate" in ('informational', 'no-regressions')),
	CONSTRAINT "org_settings_chat_contexts" CHECK ("chat_contexts" <@ '{personal,team,org}'::text[] and cardinality("chat_contexts") > 0)
);
--> statement-breakpoint
CREATE TABLE "team" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL,
	"org_id" uuid NOT NULL,
	"parent_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_parent_not_self" CHECK ("parent_id" <> "id")
);
--> statement-breakpoint
CREATE TABLE "team_member" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"team_id" uuid,
	"user_id" uuid,
	CONSTRAINT "team_member_pkey" PRIMARY KEY("team_id","user_id"),
	CONSTRAINT "team_member_role" CHECK ("role" in ('admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "balance" (
	"org_id" uuid,
	"period" text,
	"period_start" timestamp with time zone,
	"principal_id" uuid,
	"principal_type" text,
	"spent_micros" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balance_pkey" PRIMARY KEY("org_id","principal_type","principal_id","period","period_start"),
	CONSTRAINT "balance_period" CHECK ("period" in ('day', 'week', 'month')),
	CONSTRAINT "balance_principal_type" CHECK ("principal_type" in ('user', 'team', 'org'))
);
--> statement-breakpoint
CREATE TABLE "provider_key" (
	"base_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"encrypted_key" text NOT NULL,
	"hint" text NOT NULL,
	"id" uuid PRIMARY KEY,
	"key_id" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"last_used_at" timestamp with time zone,
	"provider" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_key_scope_type" CHECK ("scope_type" in ('org', 'team', 'user'))
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"cached_input_tokens" integer,
	"context_id" uuid NOT NULL,
	"context_type" text NOT NULL,
	"cost_micros" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY,
	"input_tokens" integer NOT NULL,
	"kind" text NOT NULL,
	"model" text NOT NULL,
	"org_id" uuid NOT NULL,
	"output_tokens" integer NOT NULL,
	"paid_by_id" uuid,
	"paid_by_type" text NOT NULL,
	"reasoning_tokens" integer,
	"run_id" uuid,
	"user_id" uuid NOT NULL,
	CONSTRAINT "transaction_kind" CHECK ("kind" in ('chat', 'embedding', 'decider', 'title', 'tool')),
	CONSTRAINT "transaction_context_type" CHECK ("context_type" in ('personal', 'team', 'org')),
	CONSTRAINT "transaction_paid_by_type" CHECK ("paid_by_type" in ('instance', 'org', 'team', 'user')),
	CONSTRAINT "transaction_paid_by_id" CHECK (("paid_by_type" = 'instance') = ("paid_by_id" is null)),
	CONSTRAINT "transaction_cost_non_negative" CHECK ("cost_micros" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "resource_grant_resource_principal_uidx" ON "resource_grant" ("resource_type","resource_id","principal_type","principal_id");--> statement-breakpoint
CREATE INDEX "resource_grant_principal_idx" ON "resource_grant" ("principal_type","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "share_link_token_uidx" ON "share_link" ("token");--> statement-breakpoint
CREATE INDEX "share_link_resource_idx" ON "share_link" ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organization_id_idx" ON "invitation" ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" ("email");--> statement-breakpoint
CREATE INDEX "member_organization_id_idx" ON "member" ("organization_id");--> statement-breakpoint
CREATE INDEX "member_user_id_idx" ON "member" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_org_user_uidx" ON "member" ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" ("slug");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE INDEX "conversation_owner_idx" ON "conversation" ("owner_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "conversation_context_idx" ON "conversation" ("context_type","context_id");--> statement-breakpoint
CREATE INDEX "conversation_title_search_idx" ON "conversation" USING gin ("title_search");--> statement-breakpoint
CREATE INDEX "conversation_participant_user_idx" ON "conversation_participant" ("user_id");--> statement-breakpoint
CREATE INDEX "message_parent_idx" ON "message" ("conversation_id","parent_id","created_at");--> statement-breakpoint
CREATE INDEX "message_conversation_created_idx" ON "message" ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "message_run_idx" ON "message" ("run_id");--> statement-breakpoint
CREATE INDEX "message_text_search_idx" ON "message" USING gin ("text_search");--> statement-breakpoint
CREATE INDEX "run_conversation_idx" ON "run" ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "run_active_idx" ON "run" ("conversation_id","created_at") WHERE "status" in ('queued', 'running', 'awaiting_approval');--> statement-breakpoint
CREATE UNIQUE INDEX "run_idempotency_uidx" ON "run" ("created_by","idempotency_key") WHERE "idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "artifact_conversation_idx" ON "artifact" ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_version_number_uidx" ON "artifact_version" ("artifact_id","number");--> statement-breakpoint
CREATE INDEX "file_owner_idx" ON "file" ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "file_conversation_idx" ON "file" ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_storage_key_uidx" ON "file" ("storage_driver","storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "file_chunk_file_ordinal_uidx" ON "file_chunk" ("file_id","ordinal");--> statement-breakpoint
CREATE INDEX "file_chunk_model_idx" ON "file_chunk" ("embedding_model","dimensions");--> statement-breakpoint
CREATE INDEX "file_chunk_embedding_384_idx" ON "file_chunk" USING hnsw (("embedding"::vector(384)) vector_cosine_ops) WHERE "dimensions" = 384;--> statement-breakpoint
CREATE INDEX "file_chunk_embedding_768_idx" ON "file_chunk" USING hnsw (("embedding"::vector(768)) vector_cosine_ops) WHERE "dimensions" = 768;--> statement-breakpoint
CREATE INDEX "file_chunk_embedding_1024_idx" ON "file_chunk" USING hnsw (("embedding"::vector(1024)) vector_cosine_ops) WHERE "dimensions" = 1024;--> statement-breakpoint
CREATE INDEX "file_chunk_embedding_1536_idx" ON "file_chunk" USING hnsw (("embedding"::vector(1536)) vector_cosine_ops) WHERE "dimensions" = 1536;--> statement-breakpoint
CREATE INDEX "file_chunk_embedding_3072_idx" ON "file_chunk" USING hnsw (("embedding"::halfvec(3072)) halfvec_cosine_ops) WHERE "dimensions" = 3072;--> statement-breakpoint
CREATE INDEX "agent_owner_idx" ON "agent" ("owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_version_number_uidx" ON "agent_version" ("item_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_version_draft_uidx" ON "agent_version" ("item_id") WHERE "status" = 'draft';--> statement-breakpoint
CREATE INDEX "mcp_server_owner_idx" ON "mcp_server" ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "preset_owner_idx" ON "preset" ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "prompt_owner_idx" ON "prompt" ("owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_version_number_uidx" ON "prompt_version" ("item_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_version_draft_uidx" ON "prompt_version" ("item_id") WHERE "status" = 'draft';--> statement-breakpoint
CREATE INDEX "skill_owner_idx" ON "skill" ("owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_version_number_uidx" ON "skill_version" ("item_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_version_draft_uidx" ON "skill_version" ("item_id") WHERE "status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "memory_version_number_uidx" ON "memory_version" ("user_id","number");--> statement-breakpoint
CREATE INDEX "decision_log_conversation_idx" ON "decision_log" ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "decision_log_run_idx" ON "decision_log" ("run_id");--> statement-breakpoint
CREATE INDEX "decision_log_purpose_idx" ON "decision_log" ("purpose","created_at");--> statement-breakpoint
CREATE INDEX "eval_case_dataset_idx" ON "eval_case" ("dataset_id");--> statement-breakpoint
CREATE INDEX "eval_dataset_agent_idx" ON "eval_dataset" ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_result_run_case_scorer_uidx" ON "eval_result" ("run_id","case_id","scorer");--> statement-breakpoint
CREATE INDEX "eval_run_version_idx" ON "eval_run" ("agent_version_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_message_user_uidx" ON "feedback" ("message_id","user_id");--> statement-breakpoint
CREATE INDEX "quality_score_version_idx" ON "quality_score" ("agent_version_id","metric");--> statement-breakpoint
CREATE INDEX "quality_score_context_idx" ON "quality_score" ("context_type","context_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_conversation_uidx" ON "sandbox" ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_principal_period_uidx" ON "budget" ("org_id","principal_type","principal_id","period");--> statement-breakpoint
CREATE INDEX "team_org_id_idx" ON "team" ("org_id");--> statement-breakpoint
CREATE INDEX "team_parent_id_idx" ON "team" ("parent_id");--> statement-breakpoint
CREATE INDEX "team_member_user_id_idx" ON "team_member" ("user_id");--> statement-breakpoint
CREATE INDEX "provider_key_scope_idx" ON "provider_key" ("scope_type","scope_id","provider");--> statement-breakpoint
CREATE INDEX "transaction_user_idx" ON "transaction" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "transaction_context_idx" ON "transaction" ("context_type","context_id","created_at");--> statement-breakpoint
CREATE INDEX "transaction_org_idx" ON "transaction" ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "transaction_run_idx" ON "transaction" ("run_id");--> statement-breakpoint
ALTER TABLE "resource_grant" ADD CONSTRAINT "resource_grant_granted_by_user_id_fkey" FOREIGN KEY ("granted_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_active_leaf_id_message_id_fkey" FOREIGN KEY ("active_leaf_id") REFERENCES "message"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_following_user_id_user_id_fkey" FOREIGN KEY ("following_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_agent_version_id_agent_version_id_fkey" FOREIGN KEY ("agent_version_id") REFERENCES "agent_version"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_run_id_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_parent_fk" FOREIGN KEY ("conversation_id","parent_id") REFERENCES "message"("conversation_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_after_run_id_run_id_fkey" FOREIGN KEY ("after_run_id") REFERENCES "run"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_assistant_message_id_message_id_fkey" FOREIGN KEY ("assistant_message_id") REFERENCES "message"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_user_message_id_message_id_fkey" FOREIGN KEY ("user_message_id") REFERENCES "message"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "run_chunk" ADD CONSTRAINT "run_chunk_run_id_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_latest_version_id_artifact_version_id_fkey" FOREIGN KEY ("latest_version_id") REFERENCES "artifact_version"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact_version" ADD CONSTRAINT "artifact_version_artifact_id_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifact"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact_version" ADD CONSTRAINT "artifact_version_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "file_chunk" ADD CONSTRAINT "file_chunk_file_id_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "skill_file" ADD CONSTRAINT "skill_file_file_id_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file"("id");--> statement-breakpoint
ALTER TABLE "skill_file" ADD CONSTRAINT "skill_file_skill_version_id_skill_version_id_fkey" FOREIGN KEY ("skill_version_id") REFERENCES "skill_version"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_draft_version_id_agent_version_id_fkey" FOREIGN KEY ("draft_version_id") REFERENCES "agent_version"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_latest_version_id_agent_version_id_fkey" FOREIGN KEY ("latest_version_id") REFERENCES "agent_version"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "agent_version" ADD CONSTRAINT "agent_version_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_version" ADD CONSTRAINT "agent_version_item_id_agent_id_fkey" FOREIGN KEY ("item_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mcp_oauth_token" ADD CONSTRAINT "mcp_oauth_token_mcp_server_id_mcp_server_id_fkey" FOREIGN KEY ("mcp_server_id") REFERENCES "mcp_server"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mcp_oauth_token" ADD CONSTRAINT "mcp_oauth_token_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mcp_server" ADD CONSTRAINT "mcp_server_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "preset" ADD CONSTRAINT "preset_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "prompt" ADD CONSTRAINT "prompt_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "prompt" ADD CONSTRAINT "prompt_draft_version_id_prompt_version_id_fkey" FOREIGN KEY ("draft_version_id") REFERENCES "prompt_version"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "prompt" ADD CONSTRAINT "prompt_latest_version_id_prompt_version_id_fkey" FOREIGN KEY ("latest_version_id") REFERENCES "prompt_version"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "prompt_version" ADD CONSTRAINT "prompt_version_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "prompt_version" ADD CONSTRAINT "prompt_version_item_id_prompt_id_fkey" FOREIGN KEY ("item_id") REFERENCES "prompt"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_draft_version_id_skill_version_id_fkey" FOREIGN KEY ("draft_version_id") REFERENCES "skill_version"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_latest_version_id_skill_version_id_fkey" FOREIGN KEY ("latest_version_id") REFERENCES "skill_version"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "skill_version" ADD CONSTRAINT "skill_version_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "skill_version" ADD CONSTRAINT "skill_version_item_id_skill_id_fkey" FOREIGN KEY ("item_id") REFERENCES "skill"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_current_version_id_memory_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "memory_version"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "memory_version" ADD CONSTRAINT "memory_version_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_run_id_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "eval_case" ADD CONSTRAINT "eval_case_dataset_id_eval_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "eval_dataset"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "eval_case" ADD CONSTRAINT "eval_case_source_message_id_message_id_fkey" FOREIGN KEY ("source_message_id") REFERENCES "message"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "eval_dataset" ADD CONSTRAINT "eval_dataset_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "eval_dataset" ADD CONSTRAINT "eval_dataset_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "eval_result" ADD CONSTRAINT "eval_result_case_id_eval_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "eval_case"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "eval_result" ADD CONSTRAINT "eval_result_run_id_eval_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "eval_run"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "eval_run" ADD CONSTRAINT "eval_run_agent_version_id_agent_version_id_fkey" FOREIGN KEY ("agent_version_id") REFERENCES "agent_version"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "eval_run" ADD CONSTRAINT "eval_run_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "eval_run" ADD CONSTRAINT "eval_run_dataset_id_eval_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "eval_dataset"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "quality_score" ADD CONSTRAINT "quality_score_agent_version_id_agent_version_id_fkey" FOREIGN KEY ("agent_version_id") REFERENCES "agent_version"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "quality_score" ADD CONSTRAINT "quality_score_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sandbox" ADD CONSTRAINT "sandbox_conversation_id_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation_team" ADD CONSTRAINT "invitation_team_invitation_id_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation_team" ADD CONSTRAINT "invitation_team_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_parent_id_team_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "team"("id");--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_team_id_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "balance" ADD CONSTRAINT "balance_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "provider_key" ADD CONSTRAINT "provider_key_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_org_id_organization_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_run_id_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;