ALTER TABLE "notes" ADD COLUMN "status" "processing_status" DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "failure_reason" text;