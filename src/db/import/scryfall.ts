/**
 * Importa el catálogo de Scryfall (bulk data) a la BD.
 *
 *   npm run db:import:scryfall              # lo que haya cambiado
 *   npm run db:import:scryfall -- --force   # todo, aunque no haya cambios
 *   npm run db:import:scryfall -- --only=default   (o --only=es)
 *
 * - default_cards → sets, cartas, nombres en inglés, impresiones y precios EUR.
 * - all_cards     → nombres impresos en español (todas las traducciones distintas).
 *
 * Normas de Scryfall: User-Agent identificativo, Accept y bulk data en vez de
 * peticiones sueltas (https://scryfall.com/docs/api).
 */
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { parseArgs } from 'node:util';
import { and, desc, eq, sql } from 'drizzle-orm';
import { createDb, type Db } from '../client';
import { directDatabaseUrl, loadLocalEnv } from '../env';
import { cardNames, cards, printings, scryfallImports, sets } from '../schema';
import { excluded, inBatches as writeInBatches } from '../sql';
import { readBulkCards } from './bulk-reader';
import { DefaultCardsAccumulator, SpanishNamesAccumulator } from './scryfall-map';

const BULK_DIR = 'data/bulk';
const BATCH_SIZE = 1000;
/** all_cards pesa unos 2 GB y los nombres en español solo cambian cuando sale una edición. */
const SPANISH_MAX_AGE_DAYS = 7;

type BulkType = 'default_cards' | 'all_cards';
/** Scryfall publica hoy JSONL comprimido; `download_uri`/`size` son los campos del formato antiguo. */
type BulkEntry = {
  type: string;
  updated_at: string;
  jsonl_download_uri?: string;
  compressed_size?: number;
  download_uri?: string;
  size?: number;
};

const log = (msg: string) => console.log(`[scryfall] ${msg}`);

function scryfallHeaders(accept: string): Record<string, string> {
  const contact = process.env.SEARCH_MAGIC_CONTACT;
  return {
    'User-Agent': contact ? `search-magic/0.1 (${contact})` : 'search-magic/0.1',
    Accept: accept,
  };
}

async function fetchBulkIndex(): Promise<Map<string, BulkEntry>> {
  const res = await fetch('https://api.scryfall.com/bulk-data', { headers: scryfallHeaders('application/json') });
  if (!res.ok) throw new Error(`Scryfall /bulk-data respondió ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { data: BulkEntry[] };
  return new Map(body.data.map((entry) => [entry.type, entry]));
}

/**
 * Descarga a data/bulk/ tal cual la sirve Scryfall (comprimida), reutiliza el fichero
 * si ya está y borra las versiones anteriores.
 */
async function download(entry: BulkEntry): Promise<string> {
  const uri = entry.jsonl_download_uri ?? entry.download_uri;
  if (!uri) throw new Error(`Scryfall no da URL de descarga para ${entry.type}`);
  const ext = new URL(uri).pathname.match(/\.(jsonl|json)(\.gz)?$/)?.[0] ?? '.json';
  mkdirSync(BULK_DIR, { recursive: true });
  const stamp = entry.updated_at.replace(/\D/g, '').slice(0, 14);
  const file = join(BULK_DIR, `${entry.type}-${stamp}${ext}`);
  if (existsSync(file)) {
    log(`${entry.type}: reutilizo ${file}`);
  } else {
    const bytes = entry.compressed_size ?? entry.size;
    log(`${entry.type}: descargando ${bytes ? `${(bytes / 1e6).toFixed(0)} MB` : uri}…`);
    const res = await fetch(uri, { headers: scryfallHeaders('*/*') });
    if (!res.ok || !res.body) throw new Error(`Descarga de ${entry.type} falló: ${res.status} ${res.statusText}`);
    const partial = `${file}.part`;
    await pipeline(Readable.fromWeb(res.body as NodeReadableStream), createWriteStream(partial));
    renameSync(partial, file);
  }
  for (const name of readdirSync(BULK_DIR)) {
    const path = join(BULK_DIR, name);
    if (name.startsWith(`${entry.type}-`) && path !== file) rmSync(path, { force: true });
  }
  return file;
}

async function inBatches<T>(label: string, rows: T[], write: (batch: T[]) => Promise<unknown>): Promise<void> {
  await writeInBatches(rows, BATCH_SIZE, write);
  log(`  ${label}: ${rows.length}`);
}

async function lastOkImport(db: Db, type: BulkType) {
  const [row] = await db
    .select()
    .from(scryfallImports)
    .where(and(eq(scryfallImports.bulkType, type), eq(scryfallImports.status, 'ok')))
    .orderBy(desc(scryfallImports.startedAt))
    .limit(1);
  return row;
}

/** Deja constancia de la importación (running → ok | error) alrededor de `run`. */
async function tracked<T extends { rows: number }>(db: Db, entry: BulkEntry, run: () => Promise<T>): Promise<T> {
  const [record] = await db
    .insert(scryfallImports)
    .values({ bulkType: entry.type, scryfallUpdatedAt: new Date(entry.updated_at) })
    .returning({ id: scryfallImports.id });
  try {
    const result = await run();
    await db
      .update(scryfallImports)
      .set({ status: 'ok', rows: result.rows, finishedAt: new Date() })
      .where(eq(scryfallImports.id, record!.id));
    return result;
  } catch (err) {
    await db
      .update(scryfallImports)
      .set({ status: 'error', error: String((err as Error).stack ?? err), finishedAt: new Date() })
      .where(eq(scryfallImports.id, record!.id));
    throw err;
  }
}

async function importDefaultCards(db: Db, file: string): Promise<{ rows: number; newSets: number }> {
  const acc = new DefaultCardsAccumulator();
  let read = 0;
  for await (const card of readBulkCards(file)) {
    acc.add(card);
    if (++read % 25_000 === 0) log(`  leídas ${read}…`);
  }
  log(`  leídas ${read}, descartadas ${acc.skipped} (digitales, tokens, art series…)`);

  const known = new Set((await db.select({ code: sets.code }).from(sets)).map((r) => r.code));
  const newSets = [...acc.sets.keys()].filter((code) => !known.has(code)).length;

  await inBatches('sets', [...acc.sets.values()], (batch) =>
    db
      .insert(sets)
      .values(batch)
      .onConflictDoUpdate({ target: sets.code, set: excluded(sets, ['name', 'nameNorm', 'setType', 'releasedAt']) }),
  );
  await inBatches('cartas', acc.cardRows(), (batch) =>
    db
      .insert(cards)
      .values(batch)
      .onConflictDoUpdate({
        target: cards.oracleId,
        set: { ...excluded(cards, ['name', 'typeLine', 'manaCost', 'imageUri']), updatedAt: sql`now()` },
      }),
  );
  await inBatches('nombres en inglés', [...acc.names.values()], (batch) =>
    db.insert(cardNames).values(batch).onConflictDoNothing(),
  );
  await inBatches('impresiones', acc.printings, (batch) =>
    db
      .insert(printings)
      .values(batch)
      .onConflictDoUpdate({
        target: printings.scryfallId,
        set: {
          ...excluded(printings, [
            'oracleId',
            'setCode',
            'collectorNumber',
            'lang',
            'rarity',
            'finishes',
            'borderColor',
            'frameEffects',
            'promoTypes',
            'fullArt',
            'promo',
            'imageUri',
            'priceEurCents',
            'priceEurFoilCents',
            'releasedAt',
          ]),
          updatedAt: sql`now()`,
        },
      }),
  );
  return { rows: acc.printings.length, newSets };
}

async function importSpanishNames(db: Db, file: string): Promise<{ rows: number }> {
  const englishNames = new Map<string, Set<string>>();
  const enRows = await db
    .select({ oracleId: cardNames.oracleId, nameNorm: cardNames.nameNorm })
    .from(cardNames)
    .where(eq(cardNames.lang, 'en'));
  for (const { oracleId, nameNorm } of enRows) {
    let names = englishNames.get(oracleId);
    if (!names) englishNames.set(oracleId, (names = new Set()));
    names.add(nameNorm);
  }
  const acc = new SpanishNamesAccumulator(englishNames);
  let read = 0;
  // Prefiltro por texto: de ~2 GB solo se parsean las líneas de impresiones en español.
  for await (const card of readBulkCards(file, '"lang":"es"')) {
    acc.add(card);
    if (++read % 10_000 === 0) log(`  leídas ${read} impresiones en español…`);
  }
  if (acc.names.size === 0) {
    throw new Error('No se ha encontrado ningún nombre en español: ¿ha cambiado el formato de all_cards?');
  }

  await inBatches('nombres en español', [...acc.names.values()], (batch) =>
    db.insert(cardNames).values(batch).onConflictDoNothing(),
  );
  // Limpia los "es" que en realidad son el nombre inglés (de importaciones anteriores a este filtro).
  const cleaned = await db.execute(sql`
    delete from card_names es using card_names en
    where es.lang = 'es' and en.lang = 'en' and es.oracle_id = en.oracle_id and es.name_norm = en.name_norm`);
  if (cleaned.rowCount) log(`  nombres "es" que eran el inglés, borrados: ${cleaned.rowCount}`);
  // name_es se recalcula entero en una transacción: la web nunca ve el estado intermedio.
  await db.transaction(async (tx) => {
    await tx.execute(sql`update cards set name_es = null where name_es is not null`);
    await inBatches('cards.name_es', [...acc.preferred.entries()], (batch) =>
      tx.execute(sql`
        update cards set name_es = v.name_es
        from (values ${sql.join(
          batch.map(([oracleId, { nameEs }]) => sql`(${oracleId}::uuid, ${nameEs})`),
          sql`, `,
        )}) as v(oracle_id, name_es)
        where cards.oracle_id = v.oracle_id`),
    );
  });
  return { rows: acc.names.size };
}

const sameInstant = (a: Date, b: string) => a.getTime() === new Date(b).getTime();

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { force: { type: 'boolean', default: false }, only: { type: 'string' } },
  });
  const only = values.only;
  if (only !== undefined && only !== 'default' && only !== 'es') {
    throw new Error(`--only debe ser "default" o "es", no "${only}"`);
  }
  const force = values.force ?? false;

  loadLocalEnv();
  const { db, pool } = createDb(directDatabaseUrl(), { max: 2 });
  try {
    const index = await fetchBulkIndex();
    const defaultEntry = index.get('default_cards');
    const allEntry = index.get('all_cards');
    if (!defaultEntry || !allEntry) throw new Error('Scryfall no lista default_cards o all_cards en /bulk-data');

    let newSets = 0;
    if (only !== 'es') {
      const last = await lastOkImport(db, 'default_cards');
      if (!force && last && sameInstant(last.scryfallUpdatedAt, defaultEntry.updated_at)) {
        log('default_cards: sin cambios desde la última importación');
      } else {
        const file = await download(defaultEntry);
        const started = Date.now();
        ({ newSets } = await tracked(db, defaultEntry, () => importDefaultCards(db, file)));
        log(`default_cards: hecho en ${((Date.now() - started) / 1000).toFixed(0)} s (${newSets} sets nuevos)`);
      }
    }

    if (only !== 'default') {
      const last = await lastOkImport(db, 'all_cards');
      const ageDays = last ? (Date.now() - last.startedAt.getTime()) / 86_400_000 : Infinity;
      const due = force || only === 'es' || newSets > 0 || ageDays >= SPANISH_MAX_AGE_DAYS;
      if (!due) {
        log(`all_cards: se omite (última hace ${ageDays.toFixed(1)} días y no hay sets nuevos)`);
      } else if (!force && last && sameInstant(last.scryfallUpdatedAt, allEntry.updated_at)) {
        log('all_cards: sin cambios desde la última importación');
      } else {
        const file = await download(allEntry);
        const started = Date.now();
        await tracked(db, allEntry, () => importSpanishNames(db, file));
        log(`all_cards: hecho en ${((Date.now() - started) / 1000).toFixed(0)} s`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
