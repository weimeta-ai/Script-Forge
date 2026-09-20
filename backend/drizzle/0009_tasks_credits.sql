ALTER TABLE "tasks" ADD COLUMN "credits_locked" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "credits_charged" integer DEFAULT 0 NOT NULL;
