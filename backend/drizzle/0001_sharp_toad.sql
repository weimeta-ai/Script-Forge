CREATE TABLE "script_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"script_id" uuid NOT NULL,
	"version_no" integer DEFAULT 1 NOT NULL,
	"block_index" integer NOT NULL,
	"start_offset" integer,
	"end_offset" integer,
	"type" varchar(16) NOT NULL,
	"user_note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rewrite_diffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"script_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"from_version" integer NOT NULL,
	"to_version" integer NOT NULL,
	"block_index" integer NOT NULL,
	"original_text" text NOT NULL,
	"rewritten_text" text NOT NULL,
	"decision" varchar(16) DEFAULT 'pending' NOT NULL,
	"edited_text" text,
	"formula" varchar(64),
	"reference_pattern" text,
	"reason" text,
	"estimated_score_delta" integer,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "script_annotations" ADD CONSTRAINT "script_annotations_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_annotations" ADD CONSTRAINT "script_annotations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewrite_diffs" ADD CONSTRAINT "rewrite_diffs_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewrite_diffs" ADD CONSTRAINT "rewrite_diffs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "script_annotations_script_version_idx" ON "script_annotations" USING btree ("script_id","version_no");--> statement-breakpoint
CREATE INDEX "script_annotations_script_block_idx" ON "script_annotations" USING btree ("script_id","block_index");--> statement-breakpoint
CREATE INDEX "rewrite_diffs_script_version_idx" ON "rewrite_diffs" USING btree ("script_id","to_version");--> statement-breakpoint
CREATE INDEX "rewrite_diffs_task_idx" ON "rewrite_diffs" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rewrite_diffs_script_block_task_uniq" ON "rewrite_diffs" USING btree ("script_id","to_version","block_index","task_id");