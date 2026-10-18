import type {
  AnyMatchResult,
  CatalogLookup,
  ListingKind,
  ListingSource,
  MatchedListing,
  NormalizedListing,
  Repository,
  ScrapeRun,
  ScrapeRunStats,
  ScrapeStatus,
} from "@/lib/data/types";
import { enrichListing, matchListing } from "@/lib/matching";
import { adapterFor } from "./adapters";
import { loadCardmarketCsv, parseCardmarketCsv } from "./adapters/cardmarket-csv";
import { DEFAULT_SETTINGS, politeDelay, Throttle, userAgent } from "./crawl";
import { isPlausiblePrice } from "./price";
import { fetchRobots, ROBOTS_AGENT } from "./robots";
import { hasWeb } from "./sources";
import { errorMessage } from "./text";
import type { CrawlSettings, ScrapeContext, StoreConfig } from "./types";

/**
 * Una ejecución de una tienda y una fuente, de principio a fin:
 *   startRun(tienda, fuente) → listados por lotes → enrichListing → matchListing → saveListings → finishRun
 *
 * Fuentes:
 *   web             robots.txt → adaptador de su plataforma (Shopify, WooCommerce, HTML)
 *   cardmarket_csv  CSV de stock de Cardmarket (fichero, --file o enlace publicado)
 *
 * Estado de la ejecución:
 *   ok       todo bien: la BD marca sin stock los listados de esa tienda y fuente que ya no aparecen
 *   partial  fallaron páginas, se paró en --limit o se interrumpió (Ctrl+C, --max-minutes, cancelar en
 *            CI): se guarda lo leído, pero no se marca nada sin stock
 *   error    la fuente falló o no devolvió ningún listado
 *   skipped  robots.txt no deja rastrearla (o pide un Crawl-delay excesivo), o el CSV no ha cambiado
 *            desde la última importación
 */

/** Emparejamientos a la vez: con el catálogo en memoria casi todo es local, pero el trigram va a la BD */
const MATCH_CONCURRENCY = 8;
/** Filas del CSV por lote de saveListings */
const CSV_BATCH_SIZE = 500;
/** Listados que se guardan para la tabla de la ejecución en seco */
const SAMPLE_SIZE = 10;
/** Un CSV más antiguo que esto se importa, pero se avisa en la ejecución */
const STALE_CSV_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StoreResult {
  storeId: string;
  source: ListingSource;
  status: ScrapeStatus;
  stats: ScrapeRunStats;
  /** web: páginas leídas y fallidas; CSV: 1/0 si se ha leído el fichero */
  pages: { ok: number; failed: number };
  /** motivo del error, del salto o del parcial; en las correctas, avisos */
  message?: string;
  /** primeros listados, para la tabla de --dry-run */
  sample: MatchedListing[];
  durationMs: number;
}

export interface ScrapeOptions {
  repo: Repository;
  /** por defecto "web" */
  source?: ListingSource;
  /** cardmarket_csv: importar este fichero en lugar del configurado (--file) */
  csvFile?: string;
  /** sin escribir nada en la BD */
  dryRun?: boolean;
  /** como mucho tantos listados (para probar una tienda); si se llega, la ejecución queda "partial" */
  limit?: number;
  /**
   * Al abortarse (Ctrl+C, --max-minutes, cancelar en CI) se deja de leer en cuanto se puede y la
   * ejecución se cierra como "partial" antes de salir, sin esperar a que el crawler termine.
   */
  signal?: AbortSignal;
  settings?: Partial<CrawlSettings>;
  log?: (message: string) => void;
  // inyectables en los tests
  match?: (listing: NormalizedListing, catalog: CatalogLookup) => Promise<AnyMatchResult | null>;
  enrich?: (listing: NormalizedListing) => NormalizedListing;
}

type Outcome = { status: ScrapeStatus; message?: string };

async function mapLimit<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

/**
 * Entrega los lotes de `source` hasta que se aborte `signal`. Al abortarse no espera al lote en curso
 * (puede tardar una petición entera más el Crawl-delay): para el origen sin esperarlo y termina ya.
 */
async function* untilAborted<T>(source: AsyncIterable<T> | Iterable<T>, signal?: AbortSignal): AsyncGenerator<T> {
  const iterator = Symbol.asyncIterator in source ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();
  const aborted = new Promise<"aborted">((resolve) => {
    if (signal?.aborted) resolve("aborted");
    else signal?.addEventListener("abort", () => resolve("aborted"), { once: true });
  });
  let stopped = false;
  try {
    for (;;) {
      const next = await Promise.race([iterator.next(), aborted]);
      if (next === "aborted") {
        stopped = true;
        return;
      }
      if (next.done) return;
      yield next.value;
    }
  } finally {
    // Sin abortar (p. ej. --limit) se espera a que el crawler se pare; abortando, no.
    const closing = Promise.resolve(iterator.return?.()).catch(() => undefined);
    if (!stopped) await closing;
  }
}

/** webKind de la tienda: todo lo que se rastrea de su web es de ese tipo (salvo que el adaptador diga otra cosa) */
async function* withKind(batches: AsyncIterable<NormalizedListing[]>, kind: ListingKind | undefined): AsyncGenerator<NormalizedListing[]> {
  if (!kind) return yield* batches;
  for await (const batch of batches) yield batch.map((listing) => (listing.kind ? listing : { ...listing, kind }));
}

const abortReason =(signal: AbortSignal) => (typeof signal.reason === "string" ? signal.reason : "interrumpida");

export async function scrapeStore(store: StoreConfig, options: ScrapeOptions): Promise<StoreResult> {
  const { repo, source = "web", dryRun = false, limit, log = console.log, match = matchListing, enrich = enrichListing } = options;
  const settings: CrawlSettings = { ...DEFAULT_SETTINGS, ...options.settings };
  const started = Date.now();
  const stats: ScrapeRunStats = { found: 0, matched: 0, unmatched: 0 };
  const pages = { ok: 0, failed: 0 };
  const sample: MatchedListing[] = [];
  const storeLog = (message: string) => log(`${store.id} [${source}]: ${message}`);
  let matchErrors = 0;
  let firstMatchError = "";
  let implausible = 0;

  /** Un error del emparejador no tumba la tienda: el listado se guarda sin emparejar. */
  const toMatched = async (raw: NormalizedListing): Promise<MatchedListing> => {
    let listing = raw;
    try {
      listing = enrich(raw);
      return { ...listing, match: await match(listing, repo) };
    } catch (error) {
      matchErrors++;
      firstMatchError ||= errorMessage(error);
      return { ...listing, match: null };
    }
  };

  /** Empareja y guarda los lotes; devuelve true si se ha parado en --limit. */
  const consume = async (batches: AsyncIterable<NormalizedListing[]> | Iterable<NormalizedListing[]>, runId: string | null) => {
    const seen = new Set<string>();
    for await (const batch of untilAborted(batches, options.signal)) {
      // una misma ficha puede salir en dos páginas o en dos colecciones: cuenta una vez
      const fresh = batch.filter((listing) => !seen.has(listing.externalId) && seen.add(listing.externalId));
      // 0 € o precios de relleno (999.999 € en lo agotado): no son ofertas
      const plausible = fresh.filter((listing) => isPlausiblePrice(listing.priceCents));
      implausible += fresh.length - plausible.length;
      const room = limit === undefined ? plausible.length : Math.max(0, limit - stats.found);
      const items = await mapLimit(plausible.slice(0, room), MATCH_CONCURRENCY, toMatched);
      if (items.length > 0) {
        if (runId) await repo.saveListings(runId, items);
        stats.found += items.length;
        stats.matched += items.filter((item) => item.match).length;
        stats.unmatched = stats.found - stats.matched;
        sample.push(...items.slice(0, SAMPLE_SIZE - sample.length));
        storeLog(`${stats.found} listados (${stats.matched} emparejados)`);
      }
      if (limit !== undefined && stats.found >= limit) return true;
    }
    return false;
  };

  /** Estado final a partir de lo leído, los fallos, el límite y si se ha interrumpido */
  const conclude = (notes: string[], failed: boolean, limited: boolean): Outcome => {
    if (limited) notes.push(`parada en --limit ${limit}`);
    if (options.signal?.aborted) {
      notes.unshift(`${abortReason(options.signal)}: no se ha leído todo`);
      failed = true;
    }
    if (matchErrors > 0) notes.push(`${matchErrors} listado(s) sin emparejar por un fallo del emparejador: ${firstMatchError}`);
    if (implausible > 0) notes.push(`${implausible} listado(s) descartados por un precio de 0 € o de relleno`);
    let status: ScrapeStatus = "ok";
    if (stats.found === 0) {
      status = "error";
      if (!failed) notes.unshift("no ha salido ningún listado");
    } else if (failed || limited) {
      status = "partial";
    }
    return { status, message: notes.length > 0 ? notes.join("; ").slice(0, 1000) : undefined };
  };

  const crawlWeb = async (runId: string | null): Promise<Outcome> => {
    if (!hasWeb(store)) return { status: "skipped", message: "no tiene web rastreable (website y platform)" };
    const adapter = adapterFor(store.platform);
    const agent = userAgent();
    const robots = await fetchRobots(store.website, agent, settings.timeoutSecs * 1000);
    if (!robots.ok) return { status: "error", message: robots.error };
    const blocked = adapter.startUrls(store).find((url) => !robots.robots.isAllowed(url, ROBOTS_AGENT));
    if (blocked) return { status: "skipped", message: `robots.txt no permite rastrear ${blocked}` };
    const delay = politeDelay(settings.delaySecs, robots.crawlDelaySecs, store.crawlDelaySeconds);
    if (!delay.ok) return { status: "skipped", message: delay.reason };

    const throttle = new Throttle(delay.delaySecs * 1000);
    // la petición de robots.txt también cuenta para el ritmo
    throttle.touch();
    const ctx: ScrapeContext = {
      userAgent: agent,
      robots: robots.robots,
      settings: { ...settings, delaySecs: delay.delaySecs },
      throttle,
      pagesOk: 0,
      failures: [],
      log: storeLog,
    };

    let limited = false;
    try {
      limited = await consume(withKind(adapter.scrape(store, ctx), store.webKind), runId);
    } finally {
      pages.ok = ctx.pagesOk;
      pages.failed = ctx.failures.length;
    }
    const notes: string[] = [];
    const [firstFailure] = ctx.failures;
    if (firstFailure) {
      notes.push(`${ctx.failures.length} página(s) sin leer; la primera, ${firstFailure.url}: ${firstFailure.error}`);
    } else if (stats.found === 0) {
      notes.push("¿filtros o selectores mal puestos?");
    }
    return conclude(notes, Boolean(firstFailure), limited);
  };

  const importCsv = async (runId: string | null, previous: ScrapeRun | undefined): Promise<Outcome> => {
    if (!store.cardmarketUser) return { status: "error", message: "falta cardmarketUser: sin él no hay enlace a sus ofertas" };
    const csv = await loadCardmarketCsv(store, {
      file: options.csvFile,
      userAgent: userAgent(),
      timeoutMs: settings.timeoutSecs * 1000,
      backoffMs: settings.backoffMs,
    });
    pages.ok = 1;
    // El mismo CSV de la última importación no se vuelve a importar: daría por recién actualizado un
    // stock que la tienda no ha tocado. (Con --file se importa siempre: lo ha pedido alguien a mano.)
    if (!options.csvFile && csv.modifiedAt && previous && Date.parse(previous.startedAt) > Date.parse(csv.modifiedAt)) {
      return { status: "skipped", message: `el CSV no ha cambiado desde la última importación (es del ${csv.modifiedAt.slice(0, 10)})` };
    }
    // La fecha del CSV y no la de hoy: la web enseña lo antiguos que son los datos
    const parsed = parseCardmarketCsv(csv.text, {
      storeId: store.id,
      cardmarketUser: store.cardmarketUser,
      scrapedAt: csv.modifiedAt ?? new Date().toISOString(),
      columns: store.cardmarketCsv?.columns,
    });
    storeLog(`${csv.origin}: ${parsed.listings.length} filas válidas; columnas ${JSON.stringify(parsed.columns)}`);
    const limited = await consume(chunks(parsed.listings, CSV_BATCH_SIZE), runId);

    // Las filas descartadas no hacen la ejecución parcial: el CSV es el stock completo de la tienda.
    const notes: string[] = [];
    const ageDays = csv.modifiedAt ? Math.floor((Date.now() - Date.parse(csv.modifiedAt)) / DAY_MS) : 0;
    if (ageDays > STALE_CSV_DAYS) notes.push(`el CSV es del ${csv.modifiedAt!.slice(0, 10)} (hace ${ageDays} días): pedir uno nuevo a la tienda`);
    if (parsed.skipped.length > 0) {
      const reasons = new Map<string, number>();
      for (const { reason } of parsed.skipped) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      const summary = [...reasons].map(([reason, count]) => `${count} ${reason}`).join(", ");
      notes.push(`${parsed.skipped.length} fila(s) descartadas (${summary}); la primera, fila ${parsed.skipped[0]!.row}`);
    }
    return conclude(notes, false, limited);
  };

  // La última importación del CSV, antes de abrir la nueva (que pasaría a ser la última)
  const previous = source === "cardmarket_csv" && !dryRun ? await lastCompletedRun(repo, store.id, source) : undefined;
  const runId = dryRun ? null : await repo.startRun(store.id, source);
  let outcome: Outcome;
  try {
    outcome = source === "web" ? await crawlWeb(runId) : await importCsv(runId, previous);
  } catch (error) {
    outcome = { status: "error", message: errorMessage(error).slice(0, 1000) };
  }
  if (runId) {
    await repo.finishRun(runId, { status: outcome.status, stats, ...(outcome.message ? { error: outcome.message } : {}) });
  }
  return { storeId: store.id, source, ...outcome, stats, pages, sample, durationMs: Date.now() - started };
}

/** Última ejecución "ok" o "skipped" de esa tienda y fuente; si no se puede saber, undefined */
async function lastCompletedRun(repo: Repository, storeId: string, source: ListingSource): Promise<ScrapeRun | undefined> {
  try {
    const runs = (await repo.listLatestRuns?.()) ?? [];
    return runs.find((run) => run.storeId === storeId && run.source === source && (run.status === "ok" || run.status === "skipped"));
  } catch {
    return undefined;
  }
}
