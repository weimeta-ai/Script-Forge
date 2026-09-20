CREATE TABLE "oss_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" varchar(64) DEFAULT 'default' NOT NULL,
	"access_key_id" varchar(128) NOT NULL,
	"access_key_secret" varchar(256) NOT NULL,
	"region" varchar(64) NOT NULL,
	"bucket" varchar(64) NOT NULL,
	"endpoint" varchar(256),
	"custom_domain" varchar(256),
	"path_prefix" varchar(128) DEFAULT 'drama/images' NOT NULL,
	"timeout_ms" integer DEFAULT 60000 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oss_settings_singleton_check" CHECK (id = 1)
);
