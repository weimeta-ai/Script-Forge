CREATE TABLE "credit_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"credits_per_unit" integer DEFAULT 0 NOT NULL,
	"unit_type" varchar(16) DEFAULT 'per_call' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_rules_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"type" varchar(32) NOT NULL,
	"ref_task_id" uuid,
	"ref_rule_code" varchar(64),
	"remark" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_llm_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(64) DEFAULT 'default' NOT NULL,
	"api_key" varchar(512) NOT NULL,
	"model" varchar(128) NOT NULL,
	"base_url" varchar(512) NOT NULL,
	"timeout_ms" integer DEFAULT 90000 NOT NULL,
	"default_analyze_mode" varchar(20) DEFAULT 'standard' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_image_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(64) DEFAULT 'default' NOT NULL,
	"api_key" varchar(512) NOT NULL,
	"model" varchar(128) NOT NULL,
	"base_url" varchar(512) NOT NULL,
	"timeout_ms" integer DEFAULT 120000 NOT NULL,
	"default_size" varchar(32) DEFAULT '1024x1024' NOT NULL,
	"default_count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid,
	"script_id" uuid,
	"type" varchar(16) NOT NULL,
	"phase" varchar(32) NOT NULL,
	"model" varchar(128),
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"image_count" integer,
	"latency_ms" integer NOT NULL,
	"cost_credits" integer DEFAULT 0 NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" varchar(16) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "credit_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "credit_locked" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_llm_settings" ADD CONSTRAINT "user_llm_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_image_settings" ADD CONSTRAINT "user_image_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_rules_code_idx" ON "credit_rules" USING btree ("code");--> statement-breakpoint
CREATE INDEX "credit_tx_user_created_idx" ON "credit_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_llm_settings_user_idx" ON "user_llm_settings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_image_settings_user_idx" ON "user_image_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_logs_user_created_idx" ON "usage_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_logs_task_idx" ON "usage_logs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "usage_logs_type_created_idx" ON "usage_logs" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");