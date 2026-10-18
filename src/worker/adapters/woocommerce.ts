import type { IncomingHttpHeaders } from "node:http";
import { z } from "zod";
import type { NormalizedListing } from "@/lib/data/types";
import { normalizeName } from "@/lib/normalize";
import { parseAttributes } from "../attributes";
import { baseUrl, crawlJsonPages } from "../crawl";
import { minorUnitsToCents } from "../price";
import { htmlToText } from "../text";
import type { StoreAdapter, WebStoreConfig } from "../types";

/**
 * WooCommerce: Store API pública, /wp-json/wc/store/v1/products, 100 productos por página.
 * - Productos simples: un listado cada uno, con precio en unidades mínimas (prices.price) y stock.
 * - Productos variables (una variación por estado, idioma…):
 *     - por defecto, una segunda pasada con ?type=variation, donde cada variación lleva su precio y su
 *       stock, y se quedan las de los productos vistos;
 *     - con variations: false, sin segunda pasada: un listado por producto con lo que da el listado, el
 *       precio mínimo (price_range.min_amount) y el stock del producto (hay alguna variación con stock).
 *       Estado, idioma y acabado solo se rellenan si todas sus variaciones coinciden. Es lo que conviene
 *       cuando la tienda tiene decenas de miles de variaciones (MTG Canarias).
 * - Agrupados, externos y otros tipos no tienen precio propio: se ignoran.
 *
 * De los atributos solo se leen los que describen el listado (idioma, estado, acabado, edición);
 * "Conjunto" (el código de la edición, en MTG Canarias) gana a "Colección", y el "Tratamiento"
 * (Borderless, Showcase…) se añade al título para que el emparejador elija la impresión.
 */

const PER_PAGE = 100;
const API_PATH = "/wp-json/wc/store/v1/products";

const amount = z.union([z.string(), z.number()]);

const attributeSchema = z.object({
  name: z.string(),
  has_variations: z.boolean().nullish(),
  terms: z.array(z.object({ name: z.string() })).nullish(),
  value: z.string().nullish(),
});

const productSchema = z.object({
  id: z.number(),
  parent: z.number().nullish(),
  type: z.string(),
  name: z.string(),
  permalink: z.string(),
  /** en las variaciones: "Idioma: Español, Estado: Near Mint" */
  variation: z.unknown(),
  prices: z.object({
    price: amount,
    /** solo en los productos variables con precios distintos */
    price_range: z.object({ min_amount: amount }).nullish(),
    currency_code: z.string(),
    currency_minor_unit: z.number(),
  }),
  is_in_stock: z.boolean(),
  /** solo cuando quedan pocas unidades */
  low_stock_remaining: z.number().nullish(),
  attributes: z.array(attributeSchema).nullish(),
  /** en los productos variables: los atributos de cada variación (valores en slug: "near-mint") */
  variations: z
    .array(z.object({ attributes: z.array(z.object({ name: z.string(), value: z.string().nullish() })).nullish() }))
    .nullish(),
});

type WooProduct = z.infer<typeof productSchema>;

/** Atributos que describen el listado; el resto (artista, maná, rareza…) no se lee */
// prettier-ignore
const LISTING_ATTRIBUTES = new Set([
  "idioma", "language", "lengua",
  "estado", "condition", "condicion", "estat", "calidad", "conservacion",
  "foil", "acabado", "acabat", "finish",
  "coleccion", "edicion", "edicio", "edition", "expansion", "set",
]);
/** Código de la edición: va delante de "Colección" para que sea el setHint */
const SET_CODE_ATTRIBUTES = new Set(["conjunto", "set code", "codigo de edicion", "codigo"]);
const TREATMENT_ATTRIBUTES = new Set(["tratamiento", "treatment"]);

export interface WooPage {
  listings: NormalizedListing[];
  /** productos variables pendientes de la segunda pasada */
  variableIds: number[];
  /** productos en la página, para saber si hay más */
  count: number;
}

/** "near-mint" → "near mint" */
const unslug = (value: string) => value.replace(/[-_]+/g, " ").trim();

/** Valor común a todas las variaciones de un atributo, o undefined si varía */
function sharedVariationValue(product: WooProduct, name: string): string | undefined {
  const values = new Set((product.variations ?? []).map((v) => v.attributes?.find((a) => a.name === name)?.value ?? ""));
  const [only] = values;
  return values.size === 1 && only ? unslug(only) : undefined;
}

/**
 * Atributos del listado: los de un único valor ("Idioma: Español"), los de la variación ("variation")
 * y, en un producto variable leído sin segunda pasada, los que comparten todas sus variaciones.
 */
function attributeEntries(product: WooProduct): Array<{ name: string; value: string }> {
  const codes: Array<{ name: string; value: string }> = [];
  const entries: Array<{ name: string; value: string }> = [];
  for (const attribute of product.attributes ?? []) {
    const key = normalizeName(attribute.name);
    const fromVariations = product.type === "variable" && attribute.has_variations;
    const value = fromVariations
      ? sharedVariationValue(product, attribute.name)
      : (attribute.value ?? (attribute.terms?.length === 1 ? attribute.terms[0]!.name : undefined));
    if (!value) continue;
    if (SET_CODE_ATTRIBUTES.has(key)) codes.push({ name: "set", value: htmlToText(value) });
    else if (LISTING_ATTRIBUTES.has(key)) entries.push({ name: attribute.name, value: htmlToText(value) });
  }
  if (typeof product.variation === "string") {
    for (const part of htmlToText(product.variation).split(/,\s*(?=[^,:]+:)/)) {
      const [name = "", ...value] = part.split(":");
      if (value.length > 0) entries.push({ name: name.trim(), value: value.join(":").trim() });
    }
  }
  return [...codes, ...entries];
}

/** "Captain Kirk" + Tratamiento "Showcase" → "Captain Kirk (Showcase)" */
function titleOf(product: WooProduct): string {
  const name = htmlToText(product.name);
  const treatments = (product.attributes ?? [])
    .filter((a) => TREATMENT_ATTRIBUTES.has(normalizeName(a.name)) && a.terms?.length === 1)
    .map((a) => htmlToText(a.terms![0]!.name))
    .filter((t) => t && !/^(?:normal|regular|est[aá]ndar)$/i.test(t));
  return treatments.length > 0 ? `${name} (${treatments.join(", ")})` : name;
}

/** Una página de la Store API → listados (función pura, sin red) */
export function parseWooProducts(
  data: unknown,
  opts: {
    storeId: string;
    scrapedAt: string;
    /** en la segunda pasada: solo las variaciones de estos productos */
    parents?: ReadonlySet<number>;
    /** variations: false: los productos variables salen como un listado con su precio mínimo */
    variableAsListing?: boolean;
  },
): WooPage {
  const items = z.array(z.unknown()).parse(data);
  const listings: NormalizedListing[] = [];
  const variableIds: number[] = [];
  for (const raw of items) {
    const parsed = productSchema.safeParse(raw);
    if (!parsed.success) continue;
    const product = parsed.data;
    if (product.type === "variable" && !opts.variableAsListing) {
      variableIds.push(product.id);
      continue;
    }
    if (product.type !== "simple" && product.type !== "variation" && product.type !== "variable") continue;
    if (product.type === "variation" && opts.parents && !opts.parents.has(product.parent ?? -1)) continue;
    if (product.prices.currency_code.toUpperCase() !== "EUR") continue;
    const price = product.type === "variable" ? (product.prices.price_range?.min_amount ?? product.prices.price) : product.prices.price;
    const priceCents = minorUnitsToCents(price, product.prices.currency_minor_unit);
    if (!priceCents) continue;
    listings.push({
      storeId: opts.storeId,
      externalId: String(product.id),
      rawTitle: titleOf(product),
      url: product.permalink,
      priceCents,
      currency: "EUR",
      inStock: product.is_in_stock,
      ...(product.low_stock_remaining != null ? { quantity: product.low_stock_remaining } : {}),
      ...parseAttributes(attributeEntries(product)).attrs,
      scrapedAt: opts.scrapedAt,
    });
  }
  return { listings, variableIds, count: items.length };
}

function withPage(url: string, page: number): string {
  const next = new URL(url);
  next.searchParams.set("per_page", String(PER_PAGE));
  next.searchParams.set("page", String(page));
  return next.href;
}

/** Siguiente página según X-WP-TotalPages o, si el servidor no la manda, si la página venía llena */
function nextPage(url: string, headers: IncomingHttpHeaders, count: number): string | null {
  const page = Number(new URL(url).searchParams.get("page") ?? 1);
  const total = Number(headers["x-wp-totalpages"]);
  const more = Number.isInteger(total) && total > 0 ? page < total : count >= PER_PAGE;
  return more ? withPage(url, page + 1) : null;
}

function startUrls(store: WebStoreConfig): string[] {
  const api = `${baseUrl(store.website)}${API_PATH}`;
  const categories = store.woocommerce?.categories;
  const lists = categories?.length ? categories.map((c) => `${api}?category=${encodeURIComponent(c)}`) : [api];
  return lists.map((url) => withPage(url, 1));
}

export const wooCommerceAdapter: StoreAdapter = {
  startUrls,
  async *scrape(store, ctx) {
    const variableAsListing = store.woocommerce?.variations === false;
    const parents = new Set<number>();
    yield* crawlJsonPages(ctx, startUrls(store), ({ url, headers, data }) => {
      const page = parseWooProducts(data, { storeId: store.id, scrapedAt: new Date().toISOString(), variableAsListing });
      for (const id of page.variableIds) parents.add(id);
      return { listings: page.listings, next: nextPage(url, headers, page.count) };
    });
    if (parents.size === 0) return;

    // Segunda pasada: todas las variaciones de la tienda; se quedan las de los productos vistos.
    // (ctx.throttle mantiene la separación con la última petición de la primera)
    const first = withPage(`${baseUrl(store.website)}${API_PATH}?type=variation`, 1);
    yield* crawlJsonPages(ctx, [first], ({ url, headers, data }) => {
      const page = parseWooProducts(data, { storeId: store.id, scrapedAt: new Date().toISOString(), parents });
      return { listings: page.listings, next: nextPage(url, headers, page.count) };
    });
  },
};
