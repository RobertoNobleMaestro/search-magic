ALTER TABLE "stores" ALTER COLUMN "website_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ALTER COLUMN "platform" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "cardmarket_id" integer;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "cardmarket_user" text;