ALTER TABLE "uploads" ADD COLUMN "filename" text NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "content_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "used_at" timestamp with time zone;