-- Añadido a mano: drizzle-kit no gestiona extensiones y el índice GIN de card_names la necesita.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."card_condition" AS ENUM('PO', 'PL', 'LP', 'GD', 'EX', 'NM', 'MT');--> statement-breakpoint
CREATE TYPE "public"."city" AS ENUM('barcelona', 'hospitalet');--> statement-breakpoint
CREATE TYPE "public"."finish" AS ENUM('nonfoil', 'foil', 'etched');--> statement-breakpoint
CREATE TYPE "public"."match_method" AS ENUM('override', 'exact_en', 'exact_es', 'trigram');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('matched', 'unmatched', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'ok', 'partial', 'error', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."store_platform" AS ENUM('shopify', 'woocommerce', 'prestashop', 'html');--> statement-breakpoint
CREATE TABLE "card_names" (
	"oracle_id" uuid NOT NULL,
	"lang" text NOT NULL,
	"name" text NOT NULL,
	"name_norm" text NOT NULL,
	"is_face" boolean DEFAULT false NOT NULL,
	CONSTRAINT "card_names_oracle_id_lang_name_norm_pk" PRIMARY KEY("oracle_id","lang","name_norm")
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"oracle_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_es" text,
	"type_line" text,
	"mana_cost" text,
	"image_uri" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"external_id" text NOT NULL,
	"raw_title" text NOT NULL,
	"title_norm" text NOT NULL,
	"url" text NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"in_stock" boolean NOT NULL,
	"quantity" integer,
	"condition" "card_condition",
	"language" text,
	"finish" "finish" DEFAULT 'nonfoil' NOT NULL,
	"set_hint" text,
	"match_status" "match_status" DEFAULT 'unmatched' NOT NULL,
	"match_method" "match_method",
	"match_confidence" real,
	"oracle_id" uuid,
	"scryfall_id" uuid,
	"candidates" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_run_id" integer,
	CONSTRAINT "listings_price_nonnegative" CHECK (price_cents >= 0),
	CONSTRAINT "listings_confidence_range" CHECK (match_confidence is null or match_confidence between 0 and 1),
	CONSTRAINT "listings_matched_has_card" CHECK (match_status <> 'matched' or oracle_id is not null)
);
--> statement-breakpoint
CREATE TABLE "match_overrides" (
	"store_id" text NOT NULL,
	"title_norm" text NOT NULL,
	"oracle_id" uuid,
	"scryfall_id" uuid,
	"ignore" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_overrides_store_id_title_norm_pk" PRIMARY KEY("store_id","title_norm"),
	CONSTRAINT "match_overrides_has_target" CHECK (ignore or oracle_id is not null)
);
--> statement-breakpoint
CREATE TABLE "printings" (
	"scryfall_id" uuid PRIMARY KEY NOT NULL,
	"oracle_id" uuid NOT NULL,
	"set_code" text NOT NULL,
	"collector_number" text NOT NULL,
	"lang" text NOT NULL,
	"rarity" text NOT NULL,
	"finishes" "finish"[] NOT NULL,
	"border_color" text,
	"frame_effects" text[] DEFAULT '{}'::text[] NOT NULL,
	"promo_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"full_art" boolean DEFAULT false NOT NULL,
	"promo" boolean DEFAULT false NOT NULL,
	"image_uri" text,
	"price_eur_cents" integer,
	"price_eur_foil_cents" integer,
	"released_at" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"found" integer DEFAULT 0 NOT NULL,
	"matched" integer DEFAULT 0 NOT NULL,
	"unmatched" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "scryfall_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"bulk_type" text NOT NULL,
	"scryfall_updated_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"rows" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "set_aliases" (
	"alias_norm" text PRIMARY KEY NOT NULL,
	"set_code" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sets" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_norm" text NOT NULL,
	"set_type" text NOT NULL,
	"released_at" date
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"city" "city" NOT NULL,
	"address" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"website_url" text NOT NULL,
	"platform" "store_platform" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"scraping_allowed" boolean,
	"robots_checked_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_names" ADD CONSTRAINT "card_names_oracle_id_cards_oracle_id_fk" FOREIGN KEY ("oracle_id") REFERENCES "public"."cards"("oracle_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_oracle_id_cards_oracle_id_fk" FOREIGN KEY ("oracle_id") REFERENCES "public"."cards"("oracle_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_scryfall_id_printings_scryfall_id_fk" FOREIGN KEY ("scryfall_id") REFERENCES "public"."printings"("scryfall_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_last_run_id_scrape_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."scrape_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_overrides" ADD CONSTRAINT "match_overrides_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_overrides" ADD CONSTRAINT "match_overrides_oracle_id_cards_oracle_id_fk" FOREIGN KEY ("oracle_id") REFERENCES "public"."cards"("oracle_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_overrides" ADD CONSTRAINT "match_overrides_scryfall_id_printings_scryfall_id_fk" FOREIGN KEY ("scryfall_id") REFERENCES "public"."printings"("scryfall_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printings" ADD CONSTRAINT "printings_oracle_id_cards_oracle_id_fk" FOREIGN KEY ("oracle_id") REFERENCES "public"."cards"("oracle_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printings" ADD CONSTRAINT "printings_set_code_sets_code_fk" FOREIGN KEY ("set_code") REFERENCES "public"."sets"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_aliases" ADD CONSTRAINT "set_aliases_set_code_sets_code_fk" FOREIGN KEY ("set_code") REFERENCES "public"."sets"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_names_name_norm_idx" ON "card_names" USING btree ("name_norm");--> statement-breakpoint
CREATE INDEX "card_names_name_norm_trgm_idx" ON "card_names" USING gin ("name_norm" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "listings_store_external_idx" ON "listings" USING btree ("store_id","external_id");--> statement-breakpoint
CREATE INDEX "listings_oracle_matched_idx" ON "listings" USING btree ("oracle_id") WHERE match_status = 'matched';--> statement-breakpoint
CREATE INDEX "listings_store_status_idx" ON "listings" USING btree ("store_id","match_status");--> statement-breakpoint
CREATE INDEX "printings_oracle_id_idx" ON "printings" USING btree ("oracle_id");--> statement-breakpoint
CREATE INDEX "printings_set_number_idx" ON "printings" USING btree ("set_code","collector_number");--> statement-breakpoint
CREATE INDEX "scrape_runs_store_started_idx" ON "scrape_runs" USING btree ("store_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scryfall_imports_type_started_idx" ON "scryfall_imports" USING btree ("bulk_type","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sets_name_norm_idx" ON "sets" USING btree ("name_norm");--> statement-breakpoint
CREATE VIEW "public"."unmatched_listings" AS (select "id", "store_id", "raw_title", "title_norm", "url", "price_cents", "in_stock", "set_hint", "candidates", "first_seen_at", "last_seen_at", "last_run_id" from "listings" where "listings"."match_status" = 'unmatched');