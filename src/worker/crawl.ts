import type { IncomingHttpHeaders } from "node:http";
import { Configuration, HttpCrawler, MemoryStorage, NonRetryableError, type HttpCrawlerOptions, type RobotsTxtFile } from "crawlee";
import { projectContact } from "@/lib/contact";
import type { NormalizedListing } from "@/lib/data/types";
import { normalizeEncoding } from "./encoding";
import { ROBOTS_AGENT } from "./robots";
import { errorMessage } from "./text";
import type { CrawlSettings, ScrapeContext } from "./types";

/**
 * Piezas comunes para rastrear con educación; todos los adaptadores pasan por aquí:
 *   - un crawler por tienda, con una sola petición a la vez y al menos `delaySecs` entre peticiones
 *     (el mayor de 1 s, el Crawl-delay de robots.txt y el crawlDelaySeconds de la tienda)
 *   - reintentos con espera exponencial (o la que pida Retry-After) y sin insistir en los 4xx
 *   - robots.txt: Crawlee comprueba cada petición con el que ya descargamos (robots.ts)
 *   - User-Agent identificativo y sin cabeceras de navegador inventadas
 *   - nada en disco: las colas y estadísticas de Crawlee viven en memoria (no se crea ./storage)
 *   - codificación de las respuestas configurable (webs antiguas en ISO-8859-1)
 */

export const DEFAULT_SETTINGS: CrawlSettings = {
  delaySecs: 1,
  maxRetries: 3,
  backoffMs: 2_000,
  maxPages: 2_000,
  timeoutSecs: 30,
};

/** Si robots.txt pide esperar más que esto entre peticiones, en la práctica pide que no lo rastreemos */
export const MAX_CRAWL_DELAY_SECS = 10;

/** Si Retry-After pide esperar más, no se reintenta: la página queda sin leer hasta la siguiente ejecución */
export const MAX_RETRY_WAIT_MS = 60_000;

/**
 * Separación entre peticiones a una tienda: el mayor del mínimo (`baseSecs`, 1 s por defecto), el
 * Crawl-delay de su robots.txt y el crawlDelaySeconds de stores.config.ts. Si robots.txt pide más de
 * MAX_CRAWL_DELAY_SECS, se devuelve el motivo para saltar la tienda.
 */
export function politeDelay(
  baseSecs: number,
  robotsDelaySecs?: number,
  storeDelaySecs?: number,
): { ok: true; delaySecs: number } | { ok: false; reason: string } {
  if (robotsDelaySecs !== undefined && robotsDelaySecs > MAX_CRAWL_DELAY_SECS) {
    return { ok: false, reason: `robots.txt pide ${robotsDelaySecs} s entre peticiones (Crawl-delay)` };
  }
  return { ok: true, delaySecs: Math.max(baseSecs, robotsDelaySecs ?? 0, storeDelaySecs ?? 0) };
}

/** "search-magic/0.1 (+contacto)"; el contacto es SEARCH_MAGIC_CONTACT o, si no está, la página del repositorio */
export function userAgent(contact = process.env.SEARCH_MAGIC_CONTACT): string {
  return `search-magic/0.1 (+${projectContact(contact)})`;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Separación mínima entre peticiones a una tienda, compartida por todos sus crawlers y descargas
 * sueltas. Crawlee ya espera con sameDomainDelaySecs, pero no en todos los casos (no con hosts que son
 * una IP, ni entre dos crawlers seguidos): esto lo garantiza.
 */
export class Throttle {
  private last = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(readonly intervalMs: number) {}

  /** Anota una petición hecha por otro camino (p. ej. robots.txt) */
  touch(): void {
    this.last = Date.now();
  }

  /** Espera a que toque y anota la petición que se va a hacer */
  wait(): Promise<void> {
    this.queue = this.queue.then(async () => {
      const due = this.last + this.intervalMs - Date.now();
      if (due > 0) await sleep(due);
      this.last = Date.now();
    });
    return this.queue;
  }
}

/** Raíz de la tienda sin barra final: "https://tienda.com" o, si la web vive en una carpeta, "https://tienda.com/es" */
export function baseUrl(website: string): string {
  const url = new URL(website);
  return url.origin + url.pathname.replace(/\/+$/, "");
}

/** Configuración de Crawlee sin disco y con almacenamiento propio, para que cada tienda empiece de cero */
export function memoryConfig(): Configuration {
  return new Configuration({
    persistStorage: false,
    purgeOnStart: false,
    storageClient: new MemoryStorage({ persistStorage: false, writeMetadata: false }),
  });
}

/**
 * Espera antes del reintento `attempt` (0, 1, 2…): base, 2×base, 4×base… o lo que pida Retry-After.
 * null si Retry-After pide más de MAX_RETRY_WAIT_MS: entonces no se reintenta.
 */
export function retryDelayMs(attempt: number, baseMs: number, retryAfter?: string): number | null {
  const seconds = Number(retryAfter);
  const asked = retryAfter ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now()) : 0;
  if (asked > MAX_RETRY_WAIT_MS) return null;
  return Math.min(MAX_RETRY_WAIT_MS, Math.max(baseMs * 2 ** attempt, asked || 0));
}

function retryAfterHeader(response: unknown): string | undefined {
  const headers = (response as { headers?: unknown } | undefined)?.headers;
  const value = headers && typeof headers === "object" ? (headers as Record<string, unknown>)["retry-after"] : undefined;
  return typeof value === "string" ? value : undefined;
}

const SKIP_REASONS: Record<string, string> = {
  robotsTxt: "robots.txt no lo permite",
  limit: "tope de páginas por tienda",
  enqueueLimit: "tope de páginas por tienda",
  redirect: "redirige fuera de la tienda",
};

/** Opciones de Crawlee comunes a todos los crawlers (HTTP y navegador) */
export function baseCrawlerOptions(ctx: ScrapeContext) {
  const { settings } = ctx;
  return {
    maxConcurrency: 1,
    // maxRequestsPerMinute es una ventana de un minuto; la separación entre peticiones la da sameDomainDelaySecs
    sameDomainDelaySecs: settings.delaySecs,
    maxRequestsPerMinute: Math.max(1, Math.floor(60 / settings.delaySecs)),
    maxRequestRetries: settings.maxRetries,
    maxRequestsPerCrawl: settings.maxPages,
    // sin sesiones: nada de rotar identidades ni de reintentar en bucle los 403/429
    useSessionPool: false,
    respectRobotsTxtFile: { userAgent: ROBOTS_AGENT },
    onSkippedRequest: ({ url, reason }: { url: string; reason: string }) => {
      ctx.failures.push({ url, error: `no se ha pedido: ${SKIP_REASONS[reason] ?? reason}` });
    },
    // antes de cada reintento; con una sola petición a la vez, la espera frena toda la tienda.
    // Si Retry-After pide más de un minuto, no se insiste: la página queda sin leer (ejecución parcial).
    errorHandler: async ({ request, response }: { request: { retryCount: number; noRetry: boolean }; response?: unknown }) => {
      const wait = retryDelayMs(request.retryCount, settings.backoffMs, retryAfterHeader(response));
      if (wait === null) request.noRetry = true;
      else await sleep(wait);
    },
    failedRequestHandler: ({ request }: { request: { url: string } }, error: Error) => {
      ctx.failures.push({ url: request.url, error: error.message });
    },
  };
}

type GotOptions = Parameters<NonNullable<HttpCrawlerOptions["preNavigationHooks"]>[number]>[1];

/**
 * Opciones de HttpCrawler y CheerioCrawler: las comunes, con nuestras cabeceras y verificando TLS.
 * `encoding` fuerza la codificación de las respuestas ("iso-8859-1"…), diga lo que diga el servidor.
 */
export function httpCrawlerOptions(ctx: ScrapeContext, accept: string, encoding?: string) {
  const forced = encoding ? normalizeEncoding(encoding) : null;
  if (encoding && !forced) throw new Error(`codificación desconocida: "${encoding}"`);
  return {
    ...baseCrawlerOptions(ctx),
    navigationTimeoutSecs: ctx.settings.timeoutSecs,
    ignoreSslErrors: false,
    ...(forced ? { forceResponseEncoding: forced } : {}),
    preNavigationHooks: [
      async (_context: unknown, gotOptions: GotOptions) => {
        await ctx.throttle.wait();
        // got-scraping se inventaría cabeceras de un navegador; nos identificamos como lo que somos
        gotOptions.useHeaderGenerator = false;
        gotOptions.headers = { ...gotOptions.headers, "user-agent": ctx.userAgent, accept, "accept-language": "es,en;q=0.5" };
      },
    ],
  };
}

/** Los 5xx ya los reintenta Crawlee. De los 4xx solo se reintentan 408 y 429: insistir no arregla un 404. */
export function checkStatus(status: number | undefined, url: string): void {
  if (status === undefined || status < 400) return;
  if (status === 408 || status === 429) throw new Error(`HTTP ${status} en ${url}`);
  throw new NonRetryableError(`HTTP ${status} en ${url}`);
}

/**
 * Crawlee volvería a pedir robots.txt, y con cabeceras de navegador: le damos el que ya hemos
 * descargado con nuestro User-Agent. Todas las peticiones de un crawler son de la misma tienda.
 */
export function shareRobots(crawler: object, robots: RobotsTxtFile): void {
  Object.assign(crawler, { getRobotsTxtFileForUrl: async () => robots });
}

/** Cola mínima para entregar como iterador asíncrono lo que van produciendo los handlers de Crawlee */
export class Channel<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private closed = false;
  private failure: unknown;
  private wake: (() => void) | undefined;

  push(item: T): void {
    this.items.push(item);
    this.notify();
  }

  close(error?: unknown): void {
    this.closed = true;
    this.failure = error;
    this.notify();
  }

  private notify(): void {
    this.wake?.();
    this.wake = undefined;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    for (;;) {
      if (this.items.length > 0) {
        yield this.items.shift()!;
      } else if (this.closed) {
        if (this.failure !== undefined) throw this.failure;
        return;
      } else {
        await new Promise<void>((resolve) => (this.wake = resolve));
      }
    }
  }
}

interface Runnable {
  run(requests: string[]): Promise<unknown>;
  stop(): void;
  getRequestQueue(): Promise<{ isFinished(): Promise<boolean>; fetchNextRequest(): Promise<{ url: string } | null> }>;
}

/**
 * Ejecuta el crawler y entrega los lotes según llegan. Si quien consume deja de leer (--limit, un
 * error al guardar…), para el crawler y espera a que acabe la petición en curso.
 */
export async function* drain<T>(crawler: Runnable, requests: string[], channel: Channel<T>, ctx: ScrapeContext): AsyncGenerator<T> {
  let finished = false;
  let stopped = false;
  const done = crawler
    .run(requests)
    .then(async () => {
      // Crawlee también termina "bien" ante Ctrl+C o al cancelar en CI: si queda cola, no se leyó todo
      // (y una ejecución "ok" marcaría sin stock lo que falta).
      const queue = await crawler.getRequestQueue();
      if (!stopped && !(await queue.isFinished())) {
        const pending = await queue.fetchNextRequest().catch(() => null);
        ctx.failures.push({ url: pending?.url ?? requests[0] ?? "", error: "el rastreo se interrumpió antes de pedirla" });
      }
      channel.close();
    })
    .catch((error: unknown) => channel.close(error))
    .finally(() => {
      finished = true;
    });
  try {
    yield* channel;
  } finally {
    if (!finished) {
      stopped = true;
      crawler.stop();
    }
    await done;
  }
}

export interface JsonPage {
  url: string;
  headers: IncomingHttpHeaders;
  data: unknown;
}

/**
 * Recorre una API JSON paginada (Shopify, WooCommerce). `onPage` devuelve los listados de cada página
 * y, si la hay, la URL de la siguiente.
 */
export async function* crawlJsonPages(
  ctx: ScrapeContext,
  firstPages: string[],
  onPage: (page: JsonPage) => { listings: NormalizedListing[]; next?: string | null },
): AsyncGenerator<NormalizedListing[]> {
  const channel = new Channel<NormalizedListing[]>();
  const crawler = new HttpCrawler(
    {
      ...httpCrawlerOptions(ctx, "application/json"),
      requestHandler: async ({ request, response, body, addRequests }) => {
        checkStatus(response.statusCode, request.url);
        let page: ReturnType<typeof onPage>;
        try {
          page = onPage({ url: request.url, headers: response.headers, data: JSON.parse(body.toString()) });
        } catch (error) {
          // una respuesta que no entendemos no va a cambiar por reintentarla
          throw new NonRetryableError(`respuesta inesperada de ${request.url} (${errorMessage(error)})`);
        }
        ctx.pagesOk++;
        if (page.listings.length > 0) channel.push(page.listings);
        if (page.next) await addRequests([page.next]);
      },
    },
    memoryConfig(),
  );
  shareRobots(crawler, ctx.robots);
  yield* drain(crawler, firstPages, channel, ctx);
}
