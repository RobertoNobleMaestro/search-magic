CREATE TYPE "public"."listing_kind" AS ENUM('single', 'sealed');--> statement-breakpoint
CREATE TYPE "public"."listing_source" AS ENUM('web', 'cardmarket_csv');--> statement-breakpoint
ALTER TYPE "public"."match_method" ADD VALUE 'cardmarket_id';--> statement-breakpoint
CREATE TABLE "sealed_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"set_code" text NOT NULL,
	"set_name" text NOT NULL,
	"name" text NOT NULL,
	"name_norm" text NOT NULL,
	"category" text,
	"subtype" text,
	"card_count" integer,
	"released_at" date,
	"cardmarket_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP VIEW "public"."unmatched_listings";--> statement-breakpoint
ALTER TABLE "listings" DROP CONSTRAINT "listings_matched_has_card";--> statement-breakpoint
ALTER TABLE "match_overrides" DROP CONSTRAINT "match_overrides_has_target";--> statement-breakpoint
DROP INDEX "listings_store_external_idx";--> statement-breakpoint
ALTER TABLE "stores" ALTER COLUMN "city" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "stores" ALTER COLUMN "address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "source" "listing_source" DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "kind" "listing_kind" DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "sealed_product_id" uuid;--> statement-breakpoint
ALTER TABLE "match_overrides" ADD COLUMN "sealed_product_id" uuid;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD COLUMN "source" "listing_source" DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "set_aliases" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "province" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "is_local" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "sealed_products_set_category_idx" ON "sealed_products" USING btree ("set_code","category","subtype");--> statement-breakpoint
CREATE INDEX "sealed_products_cardmarket_id_idx" ON "sealed_products" USING btree ("cardmarket_id");--> statement-breakpoint
CREATE INDEX "sealed_products_name_norm_trgm_idx" ON "sealed_products" USING gin ("name_norm" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_sealed_product_id_sealed_products_id_fk" FOREIGN KEY ("sealed_product_id") REFERENCES "public"."sealed_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_overrides" ADD CONSTRAINT "match_overrides_sealed_product_id_sealed_products_id_fk" FOREIGN KEY ("sealed_product_id") REFERENCES "public"."sealed_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listings_store_source_external_idx" ON "listings" USING btree ("store_id","source","external_id");--> statement-breakpoint
CREATE INDEX "listings_sealed_matched_idx" ON "listings" USING btree ("sealed_product_id") WHERE match_status = 'matched';--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_matched_has_target" CHECK (match_status <> 'matched'
        or (kind = 'single' and oracle_id is not null)
        or (kind = 'sealed' and sealed_product_id is not null));--> statement-breakpoint
ALTER TABLE "match_overrides" ADD CONSTRAINT "match_overrides_has_target" CHECK (ignore or oracle_id is not null or sealed_product_id is not null);--> statement-breakpoint
CREATE VIEW "public"."unmatched_listings" AS (select "id", "store_id", "source", "kind", "raw_title", "title_norm", "url", "price_cents", "in_stock", "set_hint", "candidates", "first_seen_at", "last_seen_at", "last_run_id" from "listings" where "listings"."match_status" = 'unmatched');