import type { AnyNode, Cheerio, CheerioAPI } from "cheerio";
import { CheerioCrawler, PlaywrightCrawler } from "crawlee";
import type { NormalizedListing } from "@/lib/data/types";
import { parseAttributes, parseStock } from "../attributes";
import { baseCrawlerOptions, Channel, checkStatus, drain, httpCrawlerOptions, memoryConfig, shareRobots } from "../crawl";
import { parsePrice } from "../price";
import type { HtmlSelectors, PageFailure, ScrapeContext, StoreAdapter, WebStoreConfig } from "../types";
import { cleanText, httpsImageUrl } from "./clean";

/**
 * Tiendas sin API (PrestaShop o webs a medida): se leen las páginas de categoría con los selectores
 * de stores.config.ts. Un listado por producto del listado, con el precio que se ve (en PrestaShop, el
 * de la combinación por defecto; en WooCommerce, el rebajado o el mínimo de un producto variable) y,
 * con el selector `image`, la foto de la miniatura.
 *
 * `nextPage` sigue todos los enlaces del selector que sean de la misma tienda (Crawlee no repite
 * URLs): la página siguiente y, si se quiere, las subcategorías ("una categoría por edición").
 * Los enlaces relativos se resuelven con el <base href> de la página, si lo tiene (ePages).
 *
 * Una web con un listado que no se puede describir con selectores puede tener su propio lector de
 * páginas (htmlAdapterWith, registrado por id de tienda en adapters/index.ts); el rastreo y los
 * enlaces a seguir siguen siendo los de aquí.
 */

/** "selector" → texto; "selector@atributo" → atributo (o `attr` si no se indica); "" → el propio elemento */
export function read(scope: Cheerio<AnyNode>, spec: string, attr?: string): string {
  const match = /^(.*?)@([\w:-]+)$/.exec(spec.trim());
  const selector = (match ? match[1]! : spec).trim();
  const target = selector ? scope.find(selector).first() : scope;
  const name = match?.[2] ?? attr;
  return (name ? target.attr(name) : target.text()) ?? "";
}

/** Dónde puede estar la foto de una <img>: los atributos de carga diferida van antes que src (un marcador data:…) */
const IMAGE_ATTRIBUTES = ["data-src", "data-lazy-src", "data-original", "src", "data-srcset", "data-lazy-srcset", "srcset"];

/** Primera URL de un srcset: "a-300.jpg 300w, a-150.jpg 150w" → "a-300.jpg" */
function firstSrcsetUrl(srcset: string): string {
  return srcset.trim().split(/\s+/)[0]!.replace(/,$/, "");
}

/**
 * Foto del producto con el selector `image`: "img" prueba los atributos de IMAGE_ATTRIBUTES por orden;
 * "img@atributo", solo ese. URL absoluta (con `base`) y https; undefined si no hay ninguna que valga.
 */
export function readImage(scope: Cheerio<AnyNode>, spec: string, base: string): string | undefined {
  const match = /^(.*?)@([\w:-]+)$/.exec(spec.trim());
  const selector = (match ? match[1]! : spec).trim();
  const target = selector ? scope.find(selector).first() : scope;
  for (const name of match ? [match[2]!] : IMAGE_ATTRIBUTES) {
    const value = target.attr(name);
    const url = value && httpsImageUrl(/srcset$/i.test(name) ? firstSrcsetUrl(value) : value, base);
    if (url) return url;
  }
  return undefined;
}

/** URL absoluta sin #fragmento; null si no es http(s) */
export function absoluteUrl(href: string, base: string): string | null {
  if (!href.trim()) return null;
  try {
    const url = new URL(href.trim(), base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/** Base para los enlaces relativos: el <base href> de la página o, si no tiene, su URL */
export function documentBase($: CheerioAPI, pageUrl: string): string {
  const href = $("base[href]").first().attr("href");
  return (href && absoluteUrl(href, pageUrl)) || pageUrl;
}

export interface HtmlPage {
  listings: NormalizedListing[];
  /** productos sin título, precio o enlace */
  skipped: number;
  /** páginas que se sabe que existen pero no se pueden leer (cuentan como fallo: ejecución parcial) */
  unread?: PageFailure[];
}

export interface HtmlParseOptions {
  storeId: string;
  pageUrl: string;
  selectors: HtmlSelectors;
  scrapedAt: string;
}

/** Lector de una página de listado (función pura, sin red) */
export type HtmlParser = ($: CheerioAPI, opts: HtmlParseOptions) => HtmlPage;

/** Una página de listado → listados, con los selectores de stores.config.ts */
export const parseHtmlListings: HtmlParser = ($, opts) => {
  const { selectors: sel, pageUrl } = opts;
  const base = documentBase($, pageUrl);
  const listings: NormalizedListing[] = [];
  let skipped = 0;
  $(sel.item).each((_, element) => {
    const item = $(element);
    const title = cleanText(read(item, sel.title));
    const priceCents = parsePrice(read(item, sel.price));
    const href = sel.url ? read(item, sel.url, "href") : (item.find("a[href]").first().attr("href") ?? "");
    const url = absoluteUrl(href, base);
    if (!title || !priceCents || !url) {
      skipped++;
      return;
    }
    const soldOut = sel.outOfStock !== undefined && (item.is(sel.outOfStock) || item.find(sel.outOfStock).length > 0);
    const stock = soldOut ? { inStock: false, quantity: 0 } : sel.stock ? parseStock(read(item, sel.stock)) : { inStock: true };
    const { attrs } = parseAttributes([
      { name: "condition", value: sel.condition && read(item, sel.condition) },
      { name: "language", value: sel.language && read(item, sel.language) },
      { name: "set", value: sel.set && cleanText(read(item, sel.set)) },
    ]);
    const imageUrl = sel.image ? readImage(item, sel.image, base) : undefined;
    listings.push({
      storeId: opts.storeId,
      externalId: url,
      rawTitle: title,
      url,
      priceCents,
      currency: "EUR",
      ...stock,
      ...attrs,
      ...(imageUrl ? { imageUrl } : {}),
      scrapedAt: opts.scrapedAt,
    });
  });
  return { listings, skipped };
};

/** Enlaces a seguir (página siguiente, subcategorías…): todos los del selector que sean de la misma tienda */
export function nextPageUrls($: CheerioAPI, pageUrl: string, selector: string): string[] {
  const match = /^(.*?)@([\w:-]+)$/.exec(selector.trim());
  const css = (match ? match[1]! : selector).trim();
  const attr = match?.[2] ?? "href";
  const base = documentBase($, pageUrl);
  const origin = new URL(pageUrl).origin;
  const urls = new Set<string>();
  $(css).each((_, element) => {
    const url = absoluteUrl($(element).attr(attr) ?? "", base);
    if (url && new URL(url).origin === origin) urls.add(url);
  });
  return [...urls];
}

type OnPage = ($: CheerioAPI, pageUrl: string, addRequests: (urls: string[]) => Promise<unknown>) => Promise<void>;

function cheerioCrawler(ctx: ScrapeContext, onPage: OnPage, encoding?: string) {
  return new CheerioCrawler(
    {
      ...httpCrawlerOptions(ctx, "text/html,application/xhtml+xml", encoding),
      requestHandler: async ({ request, response, $, addRequests }) => {
        checkStatus(response.statusCode, request.url);
        await onPage($, request.loadedUrl ?? request.url, addRequests);
      },
    },
    memoryConfig(),
  );
}

/** El nombre en una variable para que ni TypeScript ni el bundler intenten resolver el paquete. */
const PLAYWRIGHT = "playwright";

/** Solo para las tiendas con renderJs: true. Playwright no es dependencia del proyecto. */
async function browserCrawler(ctx: ScrapeContext, onPage: OnPage) {
  try {
    await import(PLAYWRIGHT);
  } catch {
    throw new Error(
      "esta tienda tiene renderJs: true y Playwright no está instalado. Instálalo (npm i -D playwright && " +
        "npx playwright install chromium) o busca una página de la tienda que no necesite JavaScript.",
    );
  }
  return new PlaywrightCrawler(
    {
      ...baseCrawlerOptions(ctx),
      navigationTimeoutSecs: ctx.settings.timeoutSecs,
      launchContext: { userAgent: ctx.userAgent },
      // sin huellas de navegador inventadas
      browserPoolOptions: { useFingerprints: false },
      // ni imágenes, ni CSS, ni fuentes: solo lo necesario para pintar los productos
      preNavigationHooks: [
        async ({ blockRequests }) => {
          await ctx.throttle.wait();
          await blockRequests();
        },
      ],
      requestHandler: async ({ request, response, parseWithCheerio, addRequests }) => {
        checkStatus(response?.status(), request.url);
        await onPage(await parseWithCheerio(), request.loadedUrl ?? request.url, addRequests);
      },
    },
    memoryConfig(),
  );
}

/** Rastreo de páginas HTML con un lector de listados (el de selectores o el propio de una web) */
export function htmlAdapterWith(parse: HtmlParser): StoreAdapter {
  return {
    startUrls: (store) => store.html?.startUrls ?? [],
    async *scrape(store: WebStoreConfig, ctx: ScrapeContext) {
      const html = store.html;
      if (!html) throw new Error(`a ${store.id} le faltan las opciones html (startUrls y selectors)`);
      const channel = new Channel<NormalizedListing[]>();
      const onPage: OnPage = async ($, pageUrl, addRequests) => {
        const page = parse($, { storeId: store.id, pageUrl, selectors: html.selectors, scrapedAt: new Date().toISOString() });
        ctx.pagesOk++;
        if (page.skipped > 0) ctx.log(`${page.skipped} producto(s) sin título, precio o enlace en ${pageUrl}`);
        if (page.unread?.length) ctx.failures.push(...page.unread);
        if (page.listings.length > 0) channel.push(page.listings);
        const next = html.nextPage ? nextPageUrls($, pageUrl, html.nextPage) : [];
        if (next.length > 0) await addRequests(next);
      };
      // Con Playwright decide el navegador (que lee <meta charset>); `encoding` es para el HTML sin navegador
      const crawler = html.renderJs ? await browserCrawler(ctx, onPage) : cheerioCrawler(ctx, onPage, html.encoding);
      shareRobots(crawler, ctx.robots);
      yield* drain(crawler, html.startUrls, channel, ctx);
    },
  };
}

export const htmlAdapter: StoreAdapter = htmlAdapterWith(parseHtmlListings);
