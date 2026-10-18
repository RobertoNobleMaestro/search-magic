ALTER TABLE "printings" ADD COLUMN "cardmarket_id" integer;--> statement-breakpoint
CREATE INDEX "printings_cardmarket_id_idx" ON "printings" USING btree ("cardmarket_id");