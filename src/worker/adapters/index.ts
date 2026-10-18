import type { Platform } from "@/lib/data/types";
import type { StoreAdapter, WebStoreConfig } from "../types";
import { htmlAdapter, htmlAdapterWith } from "./html";
import { parseRebellionPage } from "./rebellion";
import { shopifyAdapter } from "./shopify";
import { wooCommerceAdapter } from "./woocommerce";

/** PrestaShop no tiene API pública: se lee su HTML con selectores, como una web a medida. */
const ADAPTERS: Record<Platform, StoreAdapter> = {
  shopify: shopifyAdapter,
  woocommerce: wooCommerceAdapter,
  prestashop: htmlAdapter,
  html: htmlAdapter,
};

/**
 * Webs que necesitan algo más que selectores, por id de tienda: mismo rastreo HTML, con su propio
 * lector de páginas.
 */
const SITE_ADAPTERS: Record<string, StoreAdapter> = {
  rebellion: htmlAdapterWith(parseRebellionPage),
};

export function adapterFor(platform: Platform): StoreAdapter {
  const fallback = ADAPTERS[platform];
  const pick = (store: WebStoreConfig) => (store.platform === platform && SITE_ADAPTERS[store.id]) || fallback;
  return {
    startUrls: (store) => pick(store).startUrls(store),
    scrape: (store, ctx) => pick(store).scrape(store, ctx),
  };
}
