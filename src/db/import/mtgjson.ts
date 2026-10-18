/**
 * Importa de MTGJSON (https://mtgjson.com, licencia MIT) el producto sellado y los
 * nombres de edición en español y de Cardmarket. Va después de la importación de Scryfall.
 *
 *   npm run db:import:mtgjson              # solo si MTGJSON ha publicado datos nuevos
 *   npm run db:import:mtgjson -- --force
 */
import { gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { and, desc, eq, sql } from 'drizzle-orm';
import { createDb } from '../client';
import { directDatabaseUrl, loadLocalEnv } from '../env';
import { scryfallImports, sealedProducts, setAliases, sets } from '../schema';
import { excluded, inBatches } from '../sql';
import { mapSetList, type MtgjsonSet } from './mtgjson-map';

const BASE = 'https://mtgjson.com/api/v5';
const BULK_TYPE = 'mtgjson_setlist';

const log = (msg: string) => console.log(`[mtgjson] ${msg}`);

function headers(): Record<string, string> {
  const contact = process.env.SEARCH_MAGIC_CONTACT;
  return { 'User-Agent': contact ? `search-magic/0.1 (${contact})` : 'search-magic/0.1' };
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`MTGJSON ${path} respondió ${res.status} ${res.statusText}`);
  const body = Buffer.from(await res.arrayBuffer());
  // Sin Content-Encoding, fetch entrega el .gz tal cual.
  const text = body[0] === 0x1f && body[1] === 0x8b ? gunzipSync(body).toString('utf8') : body.toString('utf8');
  return JSON.parse(text) as T;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { force: { type: 'boolean', default: false } } });
  loadLocalEnv();
  const { db, pool } = createDb(directDatabaseUrl(), { max: 2 });
  try {
    const meta = await fetchJson<{ data: { date: string; version: string } }>('Meta.json');
    const publishedAt = new Date(meta.data.date);
    const [last] = await db
      .select()
      .from(scryfallImports)
      .where(and(eq(scryfallImports.bulkType, BULK_TYPE), eq(scryfallImports.status, 'ok')))
      .orderBy(desc(scryfallImports.startedAt))
      .limit(1);
    if (!values.force && last && last.scryfallUpdatedAt.getTime() === publishedAt.getTime()) {
      log(`sin cambios desde la última importación (${meta.data.version})`);
      return;
    }

    const [record] = await db
      .insert(scryfallImports)
      .values({ bulkType: BULK_TYPE, scryfallUpdatedAt: publishedAt })
      .returning({ id: scryfallImports.id });
    try {
      log(`descargando SetList (${meta.data.version})…`);
      const setList = await fetchJson<{ data: MtgjsonSet[] }>('SetList.json.gz');
      const known = new Map((await db.select({ code: sets.code, nameNorm: sets.nameNorm }).from(sets)).map((s) => [s.code, s.nameNorm]));
      if (known.size === 0) throw new Error('No hay sets en la BD: ejecuta antes npm run db:import:scryfall');
      const { sealed, aliases } = mapSetList(setList.data, known);

      await inBatches(sealed, 1000, (batch) =>
        db
          .insert(sealedProducts)
          .values(batch)
          .onConflictDoUpdate({
            target: sealedProducts.id,
            set: {
              ...excluded(sealedProducts, [
                'setCode',
                'setName',
                'name',
                'nameNorm',
                'category',
                'subtype',
                'cardCount',
                'releasedAt',
                'cardmarketId',
              ]),
              updatedAt: sql`now()`,
            },
          }),
      );
      log(`  producto sellado: ${sealed.length}`);

      // Los alias de MTGJSON se regeneran enteros; los manuales mandan y no se tocan.
      await db.transaction(async (tx) => {
        await tx.delete(setAliases).where(eq(setAliases.source, 'mtgjson'));
        await inBatches(aliases, 1000, (batch) => tx.insert(setAliases).values(batch).onConflictDoNothing());
      });
      log(`  alias de edición (español y Cardmarket): ${aliases.length}`);

      await db
        .update(scryfallImports)
        .set({ status: 'ok', rows: sealed.length, finishedAt: new Date() })
        .where(eq(scryfallImports.id, record!.id));
    } catch (err) {
      await db
        .update(scryfallImports)
        .set({ status: 'error', error: String((err as Error).stack ?? err), finishedAt: new Date() })
        .where(eq(scryfallImports.id, record!.id));
      throw err;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
