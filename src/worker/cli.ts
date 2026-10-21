/**
 * Línea de órdenes del worker (el punto de entrada es run.ts): elige las tiendas y sus fuentes,
 * sincroniza la tabla stores, ejecuta cada tienda × fuente una detrás de otra e imprime el resumen.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { log as crawleeLog, LogLevel } from "crawlee";
import { loadLocalEnv } from "@/db/env";
import { DEFAULT_CONTACT } from "@/lib/contact";
import { getRepository } from "@/lib/data";
import { LISTING_SOURCES, type ListingSource, type MatchedListing, type StoreInfo } from "@/lib/data/types";
import { parseStoreConfigs } from "./config";
import { scrapeStore, type StoreResult } from "./scrape";
import { storeSources } from "./sources";
import { STORES } from "./stores.config";
import { errorMessage } from "./text";
import type { StoreConfig } from "./types";

/** En seco, como mucho tantos listados por web si no se pasa --limit: probar no es rastrear la tienda entera */
export const DRY_RUN_LIMIT = 50;

const USAGE = `Uso: npm run worker -- [opciones]
  --store <id>        solo esa tienda (con --dry-run, aunque esté desactivada)
  --slow              las tiendas lentas (slow: true), que no entran en las ejecuciones normales
  --source <fuente>   solo web o cardmarket_csv
  --file <csv>        importa ese CSV de Cardmarket para la tienda de --store
  --dry-run           sin escribir en la BD; sin --store ni --all no rastrea nada (solo enseña el plan)
  --all               con --dry-run, rastrear de verdad todas las tiendas elegidas
  --limit <n>         como mucho n listados por ejecución (en seco, ${DRY_RUN_LIMIT} por defecto en las webs)
  --max-minutes <n>   a los n minutos cierra la ejecución en curso como parcial y no empieza más`;

const NO_STORES = `No hay ninguna tienda activada en src/worker/stores.config.ts: no hay nada que rastrear.
Para añadir una:
  1. Copia el ejemplo que se le parezca (Shopify, WooCommerce, PrestaShop, HTML o solo Cardmarket) con los datos reales.
  2. Pruébala sin escribir en la BD:  npm run worker -- --store <id> --dry-run
  3. Si los listados salen bien, pon enabled: true.`;

const say = (message: string) => console.log(`[worker] ${message}`);

export function toStoreInfo(store: StoreConfig): StoreInfo {
  const { id, name, city, province, local, address, website, platform, cardmarketUser } = store;
  return { id, name, city, province, local, address, website, platform, cardmarketUser };
}

interface Job {
  store: StoreConfig;
  source: ListingSource;
}

const failedResult = (job: Job, message: string, durationMs: number): StoreResult => ({
  storeId: job.store.id,
  source: job.source,
  status: "error",
  stats: { found: 0, matched: 0, unmatched: 0 },
  pages: { ok: 0, failed: 0 },
  message,
  sample: [],
  durationMs,
});

/** Devuelve el código de salida: 1 si los argumentos no valen o si fallan todas las ejecuciones. */
export async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        store: { type: "string" },
        source: { type: "string" },
        file: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        all: { type: "boolean", default: false },
        slow: { type: "boolean", default: false },
        limit: { type: "string" },
        "max-minutes": { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    }).values;
  } catch (error) {
    console.error(`Argumentos no válidos: ${errorMessage(error)}\n${USAGE}`);
    return 1;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const dryRun = args["dry-run"];
  const limit = args.limit === undefined ? undefined : Number(args.limit);
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
    console.error(`--limit tiene que ser un número entero positivo.\n${USAGE}`);
    return 1;
  }
  const maxMinutes = args["max-minutes"] === undefined ? undefined : Number(args["max-minutes"]);
  if (maxMinutes !== undefined && !(Number.isFinite(maxMinutes) && maxMinutes > 0)) {
    console.error(`--max-minutes tiene que ser un número positivo.
${USAGE}`);
    return 1;
  }
  const source = args.source as ListingSource | undefined;
  if (source !== undefined && !LISTING_SOURCES.includes(source)) {
    console.error(`--source tiene que ser ${LISTING_SOURCES.join(" o ")}.\n${USAGE}`);
    return 1;
  }
  const file = args.file === undefined ? undefined : resolve(args.file);
  if (file !== undefined) {
    if (args.store === undefined || source === "web") {
      console.error(`--file importa el CSV de Cardmarket de una tienda: hace falta --store <id> (y no vale con --source web).\n${USAGE}`);
      return 1;
    }
    if (!existsSync(file)) {
      console.error(`No existe el fichero ${file}`);
      return 1;
    }
  }

  // Antes de getRepository: DATA_SOURCE, DATABASE_URL y SEARCH_MAGIC_CONTACT pueden venir de .env.local
  loadLocalEnv();
  // Crawlee cuenta mucho por defecto; quedan sus avisos (reintentos, robots.txt) y errores.
  if (!process.env.CRAWLEE_LOG_LEVEL) crawleeLog.setLevel(LogLevel.WARNING);
  const stores = parseStoreConfigs(STORES);
  const enabled = stores.filter((s) => s.enabled);

  // Sin --store, las normales o, con --slow, las lentas
  let selected = enabled.filter((s) => Boolean(s.slow) === args.slow);
  if (args.store !== undefined) {
    const store = stores.find((s) => s.id === args.store);
    if (!store) {
      console.error(`No hay ninguna tienda "${args.store}" en stores.config.ts. Hay: ${stores.map((s) => s.id).join(", ")}`);
      return 1;
    }
    if (!store.enabled && !dryRun) {
      say(`${store.id}: skipped, está desactivada (enabled: false). Para probarla sin guardar nada, añade --dry-run.`);
      return 0;
    }
    if (file && !store.cardmarketUser) {
      console.error(`${store.id} no tiene cardmarketUser: sin él, los listados del CSV no tendrían enlace a sus ofertas.`);
      return 1;
    }
    selected = [store];
  }
  if (selected.length === 0) {
    say(enabled.length === 0 ? NO_STORES : args.slow ? "Ninguna tienda activada es lenta (slow): nada que hacer." : NO_STORES);
    return 0;
  }

  const jobs: Job[] = selected.flatMap((store) => {
    const sources: ListingSource[] = file ? ["cardmarket_csv"] : storeSources(store);
    return sources.filter((s) => source === undefined || s === source).map((s) => ({ store, source: s }));
  });
  const jobLimit = (job: Job) => limit ?? (dryRun && job.source === "web" ? DRY_RUN_LIMIT : undefined);

  // Una ejecución en seco "a secas" no sale a internet: probar el worker no debe cargar las webs de
  // todas las tiendas para tirar lo leído. Para eso, --store <id> (o --all, a sabiendas).
  if (dryRun && args.store === undefined && !args.all) {
    say(
      `Ejecución en seco sin --store: no se contacta con ninguna tienda. Configuración válida (${stores.length} tiendas, ` +
        `${enabled.length} activadas).`,
    );
    say(jobs.length > 0 ? `Se rastrearían: ${jobs.map((j) => `${j.store.id} [${j.source}]`).join(", ")}` : "No hay ninguna fuente que rastrear.");
    const slow = enabled.filter((s) => s.slow && !args.slow);
    if (slow.length > 0) say(`Aparte, con --slow (job semanal): ${slow.map((s) => s.id).join(", ")}`);
    say(`Para probar una tienda:  npm run worker -- --store <id> --dry-run   (como mucho ${DRY_RUN_LIMIT} listados por web)`);
    say("Para todas a la vez:     npm run worker -- --dry-run --all");
    return 0;
  }

  // El User-Agent siempre lleva un contacto: SEARCH_MAGIC_CONTACT o, si no está, la página del repositorio
  const contactsStores = jobs.some((j) => j.source === "web" || (!file && j.store.cardmarketCsv?.url));
  if (contactsStores && !process.env.SEARCH_MAGIC_CONTACT?.trim()) {
    say(`Sin SEARCH_MAGIC_CONTACT: el User-Agent lleva como contacto ${DEFAULT_CONTACT}`);
  }
  const repo = await getRepository();
  // Siempre todas las activadas, también con --store o --source: las que no se pasan, la BD las desactiva.
  if (!dryRun && enabled.length > 0) await repo.upsertStores(enabled.map(toStoreInfo));

  if (jobs.length === 0) {
    say(
      `Nada que hacer: ninguna tienda elegida tiene ${source ? `la fuente ${source}` : "fuentes"} ` +
        "(web: website y platform; cardmarket_csv: cardmarketUser y data/cardmarket/<id>.csv o cardmarketCsv.url).",
    );
    return 0;
  }
  await repo.loadCatalog?.();

  say(`${dryRun ? "Ejecución en seco (no se escribe en la BD). " : ""}Fuentes: ${jobs.map((j) => `${j.store.id} [${j.source}]`).join(", ")}`);
  // Ctrl+C, cancelar el workflow (SIGINT y luego SIGTERM) o --max-minutes: la ejecución en curso deja de
  // leer y se cierra como parcial enseguida (sin esperar al crawler), y no se empiezan más.
  const controller = new AbortController();
  const stop = (reason: string) => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
    say(`${reason}: se cierra la ejecución en curso como parcial y no se empiezan más.`);
  };
  const onSignal = () => stop("interrumpida");
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const timer = maxMinutes === undefined ? undefined : setTimeout(() => stop(`--max-minutes ${maxMinutes} agotado`), maxMinutes * 60_000);
  timer?.unref();
  const results: StoreResult[] = [];
  for (const [i, job] of jobs.entries()) {
    if (controller.signal.aborted) {
      say(`Sin empezar: ${jobs.slice(i).map((j) => `${j.store.id} [${j.source}]`).join(", ")}`);
      break;
    }
    const { store } = job;
    const label = `${store.id} [${job.source}]`;
    say(`${label}${job.source === "web" ? ` (${store.platform})` : ""}: empezando`);
    const started = Date.now();
    let result: StoreResult;
    try {
      result = await scrapeStore(store, {
        repo,
        source: job.source,
        csvFile: file,
        dryRun,
        limit: jobLimit(job),
        signal: controller.signal,
        log: say,
      });
    } catch (error) {
      // p. ej. la BD no responde al abrir o cerrar la ejecución; las demás siguen
      result = failedResult(job, errorMessage(error), Date.now() - started);
    }
    results.push(result);
    say(`${label}: ${result.status}${result.message ? ` (${result.message})` : ""}`);
    if (dryRun && result.sample.length > 0) printSample(result.sample);
  }
  clearTimeout(timer);
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  printSummary(results);
  return results.length > 0 && results.every((r) => r.status === "error") ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

function table(rows: string[][], rightAligned: number[] = []): string {
  const widths = rows[0]!.map((_, col) => Math.max(...rows.map((row) => row[col]!.length)));
  return rows
    .map((row) => row.map((cell, col) => (rightAligned.includes(col) ? cell.padStart(widths[col]!) : cell.padEnd(widths[col]!))).join("  "))
    .map((line) => `  ${line.trimEnd()}`)
    .join("\n");
}

const euros = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function printSample(sample: MatchedListing[]): void {
  const rows = sample.map((l) => [
    cut(l.rawTitle, 48),
    euros(l.priceCents),
    l.inStock ? (l.quantity !== undefined ? String(l.quantity) : "sí") : "no",
    l.condition ?? "—",
    l.language ?? "—",
    l.finish ?? "—",
    cut(l.setHint ?? "—", 16),
    l.cardmarketId !== undefined ? String(l.cardmarketId) : "—",
    l.imageUrl ? "sí" : "—",
    l.match ? `${l.match.kind === "sealed" ? "sellado " : ""}${l.match.method} ${l.match.confidence.toFixed(2)}` : "sin emparejar",
  ]);
  console.log(
    table([["título", "precio", "stock", "estado", "idioma", "acabado", "edición", "idProduct", "foto", "emparejado"], ...rows], [1]),
  );
}

function printSummary(results: StoreResult[]): void {
  const rows = results.map((r) => [
    r.storeId,
    r.source,
    r.status,
    String(r.stats.found),
    String(r.stats.matched),
    String(r.stats.unmatched),
    `${r.pages.ok}/${r.pages.failed}`,
    `${Math.round(r.durationMs / 1000)} s`,
  ]);
  say("Resumen");
  console.log(
    table([["tienda", "fuente", "estado", "listados", "emparejados", "sin emparejar", "páginas ok/fallo", "tiempo"], ...rows], [3, 4, 5, 7]),
  );
}
