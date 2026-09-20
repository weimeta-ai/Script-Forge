CREATE TABLE "export_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"script_id" uuid NOT NULL,
	"format" varchar(16) NOT NULL,
	"storage_key" varchar(512) NOT NULL,
	"file_size" bigint NOT NULL,
	"download_url" varchar(1024),
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hot_dramas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"genre" varchar(64),
	"platform" varchar(64),
	"metrics" jsonb,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" varchar(64) DEFAULT 'default' NOT NULL,
	"api_key" varchar(512) NOT NULL,
	"model" varchar(128) NOT NULL,
	"base_url" varchar(512) NOT NULL,
	"timeout_ms" integer DEFAULT 120000 NOT NULL,
	"default_size" varchar(32) DEFAULT '1024x1024' NOT NULL,
	"default_count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_settings_singleton_check" CHECK (id = 1)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(64) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"display_name" varchar(64),
	"role" varchar(16) DEFAULT 'user' NOT NULL,
	"preferences" jsonb DEFAULT '{"theme":"light","fontSize":"medium"}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"genre" varchar(64),
	"file_name" varchar(255),
	"source_content" text NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"script_id" uuid NOT NULL,
	"version_no" integer DEFAULT 1 NOT NULL,
	"content" text NOT NULL,
	"score_details" jsonb,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"script_id" uuid NOT NULL,
	"type" varchar(16) DEFAULT 'analyze' NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"report_id" uuid,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"genre" varchar(64) NOT NULL,
	"grade" char(1) NOT NULL,
	"overall_score" numeric(5, 2),
	"six_dimensions" jsonb,
	"summary" text NOT NULL,
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_type" varchar(32) DEFAULT 'manual_import' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" varchar(64) DEFAULT 'default' NOT NULL,
	"api_key" varchar(512) NOT NULL,
	"model" varchar(128) NOT NULL,
	"base_url" varchar(512) NOT NULL,
	"timeout_ms" integer DEFAULT 90000 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_settings_singleton_check" CHECK (id = 1)
);
--> statement-breakpoint
ALTER TABLE "export_files" ADD CONSTRAINT "export_files_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_versions" ADD CONSTRAINT "script_versions_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_report_id_script_versions_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."script_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_files_script_idx" ON "export_files" USING btree ("script_id","created_at");--> statement-breakpoint
CREATE INDEX "hot_dramas_genre_idx" ON "hot_dramas" USING btree ("genre");--> statement-breakpoint
CREATE INDEX "hot_dramas_platform_idx" ON "hot_dramas" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "scripts_user_status_idx" ON "scripts" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "script_versions_script_version_idx" ON "script_versions" USING btree ("script_id","version_no");--> statement-breakpoint
CREATE INDEX "script_versions_script_idx" ON "script_versions" USING btree ("script_id");--> statement-breakpoint
CREATE INDEX "tasks_script_active_idx" ON "tasks" USING btree ("script_id","status");--> statement-breakpoint
CREATE INDEX "tasks_status_created_idx" ON "tasks" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_samples_genre_grade_idx" ON "knowledge_samples" USING btree ("genre","grade");--> statement-breakpoint
CREATE INDEX "knowledge_samples_grade_idx" ON "knowledge_samples" USING btree ("grade");