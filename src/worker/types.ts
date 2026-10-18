import type { RobotsTxtFile } from "crawlee";
import type { ListingKind, NormalizedListing, Platform, StoreInfo } from "@/lib/data/types";
import type { CsvField } from "./adapters/cardmarket-csv";
import type { Throttle } from "./crawl";

/**
 * Configuración de las tiendas (stores.config.ts) y contrato de los adaptadores del worker.
 * La validación en tiempo de ejecución está en config.ts.
 *
 * Fuentes de una tienda:
 *   "web"             su web, si tiene website y platform (opciones shopify / woocommerce / html)
 *   "cardmarket_csv"  el stock que exporta de Cardmarket, si tiene cardmarketUser (opciones cardmarketCsv)
 */

/** Shopify: API pública /products.json */
export interface ShopifyOptions {
  /** Solo estas colecciones (/collections/<handle>/products.json). Sin esto, todo el catálogo. */
  collections?: string[];
  /** Solo productos con estos product_type, sin distinguir mayúsculas (p. ej. ["MTG Single"]). */
  productTypes?: string[];
}

/** WooCommerce: Store API pública /wp-json/wc/store/v1/products */
export interface WooCommerceOptions {
  /** Solo estas categorías: ID o slug (?category=). Sin esto, todo el catálogo. */
  categories?: string[];
  /**
   * Pedir también las variaciones de los productos variables (?type=variation), cada una con su precio
   * y su stock (estado, idioma…). Por defecto true. Con false no hay segunda pasada: cada producto
   * variable sale como un listado con su precio mínimo (y estado, idioma o acabado solo si todas sus
   * variaciones coinciden).
   */
  variations?: boolean;
}

/**
 * Selectores CSS de una página de listado; todos menos `item` son relativos a cada producto.
 * Se lee el texto del elemento o, con "selector@atributo", un atributo ("img@alt", ".price@content");
 * "@atributo" a secas lee el propio producto. `url` lee href si no se indica otro atributo.
 */
export interface HtmlSelectors {
  /** cada producto del listado */
  item: string;
  title: string;
  price: string;
  /** enlace a la ficha; por defecto, el primer a[href] del producto */
  url?: string;
  /** texto de disponibilidad ("Agotado", "3 disponibles"…); si el elemento no está, se da por disponible */
  stock?: string;
  /**
   * Selector que, si coincide con el propio producto o con algo dentro, lo marca sin stock: p. ej.
   * ".outofstock" en WooCommerce, que pone esa clase a los agotados del listado. Manda sobre `stock`.
   */
  outOfStock?: string;
  condition?: string;
  language?: string;
  set?: string;
}

/** Tiendas sin API (PrestaShop o webs a medida): se lee el HTML de las páginas de categoría */
export interface HtmlOptions {
  /** páginas por las que empezar, del mismo dominio que `website` */
  startUrls: string[];
  selectors: HtmlSelectors;
  /**
   * Enlaces a seguir desde cada página: se siguen todos los del selector que sean de la misma tienda
   * (Crawlee no repite URLs), así que sirve para la página siguiente ("a[rel=next]") y también para
   * las subcategorías ("una categoría por edición"). Sin esto solo se leen las startUrls.
   */
  nextPage?: string;
  /**
   * Codificación de las páginas cuando no es UTF-8 y la web no la declara bien en Content-Type
   * (p. ej. "iso-8859-1" o "windows-1252"). Manda sobre lo que diga el servidor.
   */
  encoding?: string;
  /** la web pinta los productos con JavaScript: necesita Playwright, que no está instalado */
  renderJs?: boolean;
}

/** Stock exportado de Cardmarket ("Descargar stock" en CSV) que nos comparte la tienda */
export interface CardmarketCsvOptions {
  /** CSV local, relativo a la raíz del repositorio; por defecto data/cardmarket/<id>.csv (no se sube a git) */
  file?: string;
  /**
   * Enlace https a un CSV publicado por la tienda (Google Sheets, Dropbox…). Si está, manda sobre `file`:
   * se descarga una vez por ejecución con nuestro User-Agent. Nunca un enlace de cardmarket.com.
   */
  url?: string;
  /** codificación si no es UTF-8 (p. ej. "windows-1252"); el BOM de UTF-8/UTF-16 se detecta solo */
  encoding?: string;
  /** cabecera exacta de las columnas que el mapeo automático no reconozca: { price: "Preu" } */
  columns?: Partial<Record<CsvField, string>>;
}

export type StoreConfig = StoreInfo & {
  /** false: el worker no la rastrea y deja de mostrarse en la web */
  enabled: boolean;
  /** notas internas: permiso de la tienda, contacto, particularidades… */
  notes?: string;
  /**
   * Segundos mínimos entre peticiones a su web, si la tienda nos pide ir más despacio. Se suma como
   * mínimo a 1 s y al Crawl-delay de su robots.txt: se usa el mayor de los tres.
   */
  crawlDelaySeconds?: number;
  /**
   * Qué se rastrea de su web, si es todo de un tipo (una colección solo de sueltas o solo de sellado):
   * el emparejador no lo adivina por el título. "Sheoldred (Promo Pack)" en una colección de sueltas
   * es una carta, no un sobre. Sin esto, lo decide el emparejador listado a listado.
   */
  webKind?: ListingKind;
  /**
   * Tarda horas (muchas páginas y un Crawl-delay alto): no entra en las ejecuciones normales sino en
   * las de --slow, que en GitHub Actions tienen su propio job semanal con más tiempo.
   */
  slow?: boolean;
  shopify?: ShopifyOptions;
  woocommerce?: WooCommerceOptions;
  /** obligatorio con platform "prestashop" o "html" */
  html?: HtmlOptions;
  /** requiere cardmarketUser; sin esto, se busca data/cardmarket/<id>.csv */
  cardmarketCsv?: CardmarketCsvOptions;
};

/** Tienda con web rastreable: lo que reciben los adaptadores web */
export type WebStoreConfig = StoreConfig & { website: string; platform: Platform };

/** Ajustes del rastreo educado (valores por defecto en crawl.ts) */
export interface CrawlSettings {
  /** separación mínima entre peticiones a una tienda, en segundos */
  delaySecs: number;
  /** reintentos por página */
  maxRetries: number;
  /** espera antes del primer reintento, en ms; se dobla en cada uno */
  backoffMs: number;
  /** tope de páginas por tienda y ejecución */
  maxPages: number;
  /** tiempo máximo de cada petición, en segundos */
  timeoutSecs: number;
}

export interface PageFailure {
  url: string;
  error: string;
}

/** Lo que recibe un adaptador web para rastrear una tienda, y donde va anotando cómo le ha ido */
export interface ScrapeContext {
  userAgent: string;
  /** robots.txt de la tienda, ya descargado con nuestro User-Agent */
  robots: RobotsTxtFile;
  /** delaySecs ya incluye el Crawl-delay de robots.txt y el crawlDelaySeconds de la tienda */
  settings: CrawlSettings;
  /**
   * Turno de peticiones a la tienda (settings.delaySecs entre una y otra). Los crawlers de crawl.ts ya
   * lo esperan; una descarga suelta (fetchText) tiene que pasarlo en sus opciones.
   */
  throttle: Throttle;
  /** páginas descargadas y procesadas sin error */
  pagesOk: number;
  /** páginas que fallaron tras los reintentos o que no se pidieron (robots.txt, tope de páginas…) */
  failures: PageFailure[];
  log(message: string): void;
}

/** Adaptador de la fuente "web" (uno por plataforma, ver adapters/index.ts) */
export interface StoreAdapter {
  /** URLs por las que empieza el rastreo; antes de empezar se comprueban contra robots.txt */
  startUrls(store: WebStoreConfig): string[];
  /** Rastrea la tienda y entrega los listados por lotes (normalmente, uno por página). */
  scrape(store: WebStoreConfig, ctx: ScrapeContext): AsyncIterable<NormalizedListing[]>;
}
