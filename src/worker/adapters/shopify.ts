import { z } from "zod";
import type { NormalizedListing } from "@/lib/data/types";
import { parseAttributes } from "../attributes";
import { baseUrl, crawlJsonPages } from "../crawl";
import { decimalToCents } from "../price";
import type { StoreAdapter, WebStoreConfig } from "../types";
import { cleanText } from "./clean";

/**
 * Shopify: API pública de cualquier tienda, /products.json (o /collections/<handle>/products.json),
 * hasta 250 productos por página con ?page=N. Un listado por variante: las variantes suelen ser
 * estado, idioma y acabado ("NM / Español / Foil"). No da cantidades ni moneda: se asume EUR.
 *
 * Probado con El Nucli, El Duelista y Universe TCG (fixtures shopify-*.json). En estas dos últimas la
 * opción "Edition" no es la edición sino el acabado ("Normal" o "Foil Normal").
 */

const PAGE_SIZE = 250;

/** Valores de una opción "Edition"/"Edición" que en realidad son el acabado */
const FINISH_EDITION = /^(?:normal|non[ -]?foil|foil|foil normal|normal foil|etched|etched foil|foil etched)$/i;

/** Nombre/valor de una opción de variante, corrigiendo la "Edition" que es el acabado */
function optionEntry(name: string | undefined, value: string | null | undefined) {
  const text = value?.trim() ?? "";
  if (!name || !/^(?:edition|edici[oó]n)$/i.test(name.trim()) || !FINISH_EDITION.test(text)) return { name, value };
  const lower = text.toLowerCase();
  const finish = lower.includes("etched") ? "etched" : lower.includes("foil") && !/non[ -]?foil/.test(lower) ? "foil" : "nonfoil";
  return { name: "finish", value: finish };
}

const variantSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string().nullish(),
  option1: z.string().nullish(),
  option2: z.string().nullish(),
  option3: z.string().nullish(),
  price: z.union([z.string(), z.number()]),
  available: z.boolean().nullish(),
});

const productSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  handle: z.string(),
  product_type: z.string().nullish(),
  options: z.array(z.object({ name: z.string() })).nullish(),
  variants: z.array(variantSchema),
});

export interface ShopifyPage {
  listings: NormalizedListing[];
  /** ids de todos los productos de la página, también los filtrados, para saber cuándo parar */
  productIds: string[];
}

/** Una página de products.json → listados (función pura, sin red) */
export function parseShopifyProducts(
  data: unknown,
  opts: { storeId: string; baseUrl: string; productTypes?: string[]; scrapedAt: string },
): ShopifyPage {
  const { products } = z.object({ products: z.array(z.unknown()) }).parse(data);
  const types = opts.productTypes?.map((t) => t.trim().toLowerCase());
  const listings: NormalizedListing[] = [];
  const productIds: string[] = [];
  for (const raw of products) {
    const parsed = productSchema.safeParse(raw);
    if (!parsed.success) continue;
    const product = parsed.data;
    productIds.push(String(product.id));
    if (types && !types.includes((product.product_type ?? "").trim().toLowerCase())) continue;

    const title = cleanText(product.title);
    const optionNames = (product.options ?? []).map((o) => o.name);
    for (const variant of product.variants) {
      const priceCents = decimalToCents(variant.price);
      if (!priceCents) continue;
      const values = [variant.option1, variant.option2, variant.option3];
      const { attrs, unrecognized } = parseAttributes(values.map((value, i) => optionEntry(optionNames[i], value)));
      // Si la variante lleva algo más que estado/idioma/acabado (una edición, "Borderless"…), al título.
      const variantTitle = cleanText(variant.title ?? "");
      listings.push({
        storeId: opts.storeId,
        externalId: String(variant.id),
        rawTitle: unrecognized && variantTitle ? `${title} - ${variantTitle}` : title,
        url: `${opts.baseUrl}/products/${encodeURIComponent(product.handle)}?variant=${variant.id}`,
        priceCents,
        currency: "EUR",
        inStock: variant.available === true,
        ...attrs,
        scrapedAt: opts.scrapedAt,
      });
    }
  }
  return { listings, productIds };
}

function withPage(url: string, page: number): string {
  const next = new URL(url);
  next.searchParams.set("limit", String(PAGE_SIZE));
  next.searchParams.set("page", String(page));
  return next.href;
}

function startUrls(store: WebStoreConfig): string[] {
  const base = baseUrl(store.website);
  const collections = store.shopify?.collections;
  const lists = collections?.length
    ? collections.map((handle) => `${base}/collections/${encodeURIComponent(handle)}/products.json`)
    : [`${base}/products.json`];
  return lists.map((url) => withPage(url, 1));
}

export const shopifyAdapter: StoreAdapter = {
  startUrls,
  scrape(store, ctx) {
    const base = baseUrl(store.website);
    // productos vistos en cada lista, por si la tienda ignorase ?page= y devolviera siempre lo mismo
    const seen = new Map<string, Set<string>>();
    return crawlJsonPages(ctx, startUrls(store), ({ url, data }) => {
      const page = parseShopifyProducts(data, {
        storeId: store.id,
        baseUrl: base,
        productTypes: store.shopify?.productTypes,
        scrapedAt: new Date().toISOString(),
      });
      const current = new URL(url);
      const ids = seen.get(current.pathname) ?? new Set<string>();
      seen.set(current.pathname, ids);
      const fresh = page.productIds.filter((id) => !ids.has(id));
      for (const id of fresh) ids.add(id);
      // Se sigue mientras lleguen productos nuevos: la última página viene vacía.
      const next = fresh.length > 0 ? withPage(url, Number(current.searchParams.get("page") ?? 1) + 1) : null;
      return { listings: page.listings, next };
    });
  },
};
