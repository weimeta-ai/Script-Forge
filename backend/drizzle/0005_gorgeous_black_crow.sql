CREATE TABLE "prompt_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(32) NOT NULL,
	"content" text NOT NULL,
	"note" varchar(200),
	"version" integer NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_by" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_settings_type_check" CHECK (type IN ('report_system', 'cover_template'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_settings_one_current" ON "prompt_settings" USING btree ("type") WHERE is_current = true;