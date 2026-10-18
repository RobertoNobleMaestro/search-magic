import { load } from "cheerio";
import { z } from "zod";
import type { Platform } from "@/lib/data/types";
import { CSV_FIELDS } from "./adapters/cardmarket-csv";
import { normalizeEncoding } from "./encoding";
import { isCardmarketUrl } from "./fetch";
import type { StoreConfig } from "./types";

/**
 * Validación de stores.config.ts. TypeScript ya comprueba la forma; aquí se comprueba lo demás:
 * ids únicos, URLs https, selectores CSS válidos, opciones según la plataforma y la fuente, y claves
 * mal escritas.
 */

const probe = load("");

/** "selector" o "selector@atributo"; el selector vacío ("@data-id") es el propio producto */
function isValidSelector(spec: string): boolean {
  const selector = spec.replace(/@[\w:-]+$/, "").trim();
  if (!selector) return true;
  try {
    probe(selector);
    return true;
  } catch {
    return false;
  }
}

const text = z.string().trim().min(1, "no puede estar vacío");
const httpsUrl = z.url({ protocol: /^https$/, error: "tiene que ser una URL completa con https://" });
const selector = text.refine(isValidSelector, "no es un selector CSS válido");
const encoding = text.refine((label) => normalizeEncoding(label) !== null, "codificación desconocida (p. ej. \"iso-8859-1\" o \"windows-1252\")");
const list = <T extends z.ZodType>(item: T) => z.array(item).min(1, "pon al menos uno o quita la opción");

const shopifySchema = z.strictObject({
  collections: list(z.string().regex(/^[^/?#\s]+$/, "solo el handle (lo que va tras /collections/)")).optional(),
  productTypes: list(text).optional(),
});

const wooCommerceSchema = z.strictObject({
  categories: list(z.string().regex(/^[\w-]+$/, "ID o slug de la categoría")).optional(),
  variations: z.boolean().optional(),
});

const htmlSchema = z.strictObject({
  startUrls: list(httpsUrl),
  selectors: z.strictObject({
    item: selector,
    title: selector,
    price: selector,
    url: selector.optional(),
    stock: selector.optional(),
    outOfStock: selector.optional(),
    condition: selector.optional(),
    language: selector.optional(),
    set: selector.optional(),
    image: selector.optional(),
  }),
  nextPage: selector.optional(),
  encoding: encoding.optional(),
  renderJs: z.boolean().optional(),
});

const cardmarketCsvSchema = z.strictObject({
  file: text.refine((path) => !/^https?:/i.test(path), "es una ruta local; para un enlace usa url").optional(),
  url: httpsUrl.refine((url) => !isCardmarketUrl(url), "no se descarga nada de cardmarket.com: pide a la tienda el CSV").optional(),
  encoding: encoding.optional(),
  columns: z.partialRecord(z.enum(CSV_FIELDS), text).optional(),
});

const PLATFORMS = ["shopify", "woocommerce", "prestashop", "html"] as const satisfies readonly Platform[];

/** Las ciudades del foco de search-magic, tal como las muestra la web */
export const LOCAL_CITIES = ["Barcelona", "L'Hospitalet de Llobregat"] as const;

const storeSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "tiene que ser un slug: minúsculas, números y guiones"),
    name: text,
    city: text,
    province: text.nullable(),
    local: z.boolean(),
    address: text.nullable(),
    website: httpsUrl.nullable(),
    platform: z.enum(PLATFORMS).nullable(),
    cardmarketUser: z
      .string()
      .regex(/^[\w.-]+$/, "solo el nombre de usuario, tal como sale en cardmarket.com/es/Magic/Users/<usuario>")
      .nullable(),
    enabled: z.boolean(),
    notes: z.string().optional(),
    crawlDelaySeconds: z.number().positive().max(60, "más de 60 s entre peticiones no tiene sentido").optional(),
    webKind: z.enum(["single", "sealed"]).optional(),
    slow: z.boolean().optional(),
    shopify: shopifySchema.optional(),
    woocommerce: wooCommerceSchema.optional(),
    html: htmlSchema.optional(),
    cardmarketCsv: cardmarketCsvSchema.optional(),
  })
  .superRefine((store, ctx) => {
    const issue = (path: PropertyKey[], message: string) => ctx.addIssue({ code: "custom", path, message });
    if (store.platform && !store.website) issue(["website"], `con platform "${store.platform}" hace falta la web`);
    if (store.local && !store.address) issue(["address"], "una tienda física (local: true) necesita dirección");
    if (store.local && !(LOCAL_CITIES as readonly string[]).includes(store.city)) {
      issue(["city"], `una tienda local tiene que estar en ${LOCAL_CITIES.map((c) => `"${c}"`).join(" o ")} (escrito así)`);
    }

    const usesHtml = store.platform === "prestashop" || store.platform === "html";
    if (usesHtml && !store.html) issue(["html"], `una tienda ${store.platform} necesita html: { startUrls, selectors }`);
    for (const key of ["shopify", "woocommerce", "html"] as const) {
      const fits = key === "html" ? usesHtml : store.platform === key;
      if (store[key] && !fits) issue([key], `no sirve para una tienda ${store.platform ?? "sin platform"}`);
    }
    if (store.crawlDelaySeconds !== undefined && !store.platform) issue(["crawlDelaySeconds"], "solo sirve para rastrear su web (platform)");
    if (store.webKind !== undefined && !store.platform) issue(["webKind"], "solo sirve para rastrear su web (platform)");
    if (store.slow && !store.platform) issue(["slow"], "solo sirve para rastrear su web (platform)");
    if (store.cardmarketCsv && !store.cardmarketUser) {
      issue(["cardmarketCsv"], "hace falta cardmarketUser: los listados del CSV enlazan a sus ofertas en Cardmarket");
    }

    // Un crawler por tienda y un robots.txt por tienda: todo tiene que estar en su dominio.
    // (zod pasa por aquí aunque alguna URL ya haya fallado, así que no se da por buena)
    const origin = store.website && URL.canParse(store.website) ? new URL(store.website).origin : null;
    store.html?.startUrls.forEach((url, i) => {
      if (origin && URL.canParse(url) && new URL(url).origin !== origin) {
        issue(["html", "startUrls", i], `tiene que ser de ${origin}, como website`);
      }
    });
  });

const storesSchema = z.array(storeSchema).superRefine((stores, ctx) => {
  const seen = new Set<string>();
  stores.forEach((store, i) => {
    if (seen.has(store.id)) ctx.addIssue({ code: "custom", path: [i, "id"], message: `id repetido: "${store.id}"` });
    seen.add(store.id);
  });
});

/** Valida la lista de tiendas; si algo está mal, lanza un error con todos los problemas. */
export function parseStoreConfigs(input: unknown): StoreConfig[] {
  const result = storesSchema.safeParse(input, { error: z.locales.es().localeError });
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => `  - ${describePath(issue.path, input)}: ${issue.message}`);
  throw new Error(`stores.config.ts no es válido:\n${problems.join("\n")}`);
}

/** [2, "html", "startUrls", 0] → "tierras-basicas-sants.html.startUrls.0" */
function describePath(path: PropertyKey[], input: unknown): string {
  if (path.length === 0) return "lista de tiendas";
  const [index, ...rest] = path;
  const id = Array.isArray(input) && typeof index === "number" ? (input[index] as { id?: unknown } | undefined)?.id : undefined;
  const store = typeof id === "string" && id ? id : `tienda ${String(index)}`;
  return [store, ...rest.map(String)].join(".");
}
