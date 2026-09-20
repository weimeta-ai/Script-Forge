CREATE TABLE "user_prompt_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"content" text NOT NULL,
	"note" varchar(200),
	"version" integer NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_prompt_settings_type_check" CHECK (type IN ('report_system', 'cover_template'))
);
--> statement-breakpoint
ALTER TABLE "user_prompt_settings" ADD CONSTRAINT "user_prompt_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_prompt_settings_one_current" ON "user_prompt_settings" USING btree ("user_id","type") WHERE is_current = true;--> statement-breakpoint
CREATE INDEX "user_prompt_settings_user_type_idx" ON "user_prompt_settings" USING btree ("user_id","type");