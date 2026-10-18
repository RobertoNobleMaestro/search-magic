import { existsSync } from "node:fs";
import type { ListingSource } from "@/lib/data/types";
import { hasCardmarketCsv } from "./adapters/cardmarket-csv";
import type { StoreConfig, WebStoreConfig } from "./types";

/**
 * Qué fuentes tiene cada tienda:
 *   "web"             si tiene website y platform
 *   "cardmarket_csv"  si tiene cardmarketUser y un CSV: enlace configurado o fichero en disco
 *                     (por defecto data/cardmarket/<id>.csv)
 */

export function hasWeb(store: StoreConfig): store is WebStoreConfig {
  return Boolean(store.website && store.platform);
}

export function storeSources(store: StoreConfig, exists: (path: string) => boolean = existsSync): ListingSource[] {
  const sources: ListingSource[] = [];
  if (hasWeb(store)) sources.push("web");
  if (hasCardmarketCsv(store, exists)) sources.push("cardmarket_csv");
  return sources;
}
