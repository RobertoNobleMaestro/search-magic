import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type {
  ListingSource,
  MatchedListing,
  ScrapeRunStats,
  ScrapeStatus,
  StoreInfo,
} from '../../lib/data/types';
import { normalizeTitle } from '../../lib/matching';
import type { Db } from '../client';
import { listings, matchOverrides, scrapeRuns, stores } from '../schema';
import { excluded, inBatches } from '../sql';

/** Unas 28 columnas por fila: 500 filas quedan lejos del límite de 65.535 parámetros. */
const LISTING_BATCH = 500;

function parseRunId(runId: string): number {
  const id = Number(runId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`runId no válido: "${runId}"`);
  return id;
}

/** stores.config.ts es la fuente de verdad: las tiendas que ya no están se desactivan. */
export async function upsertStores(db: Db, configs: StoreInfo[]): Promise<void> {
  await db.transaction(async (tx) => {
    if (configs.length > 0) {
      await tx
        .insert(stores)
        .values(
          configs.map((s) => ({
            id: s.id,
            name: s.name,
            city: s.city,
            province: s.province,
            isLocal: s.local,
            address: s.address,
            websiteUrl: s.website,
            platform: s.platform,
            cardmarketUser: s.cardmarketUser,
            enabled: true,
          })),
        )
        .onConflictDoUpdate({
          target: stores.id,
          set: {
            ...excluded(stores, [
              'name',
              'city',
              'province',
              'isLocal',
              'address',
              'websiteUrl',
              'platform',
              'cardmarketUser',
              'enabled',
            ]),
            updatedAt: sql`now()`,
          },
        });
    }
    const ids = configs.map((s) => s.id);
    await tx
      .update(stores)
      .set({ enabled: false, updatedAt: sql`now()` })
      .where(ids.length > 0 ? notInArray(stores.id, ids) : undefined);
  });
}

export async function startRun(db: Db, storeId: string, source: ListingSource = 'web'): Promise<string> {
  const [run] = await db.insert(scrapeRuns).values({ storeId, source }).returning({ id: scrapeRuns.id });
  return String(run!.id);
}

export async function saveListings(db: Db, runId: string, items: MatchedListing[]): Promise<void> {
  const id = parseRunId(runId);
  if (items.length === 0) return;
  const [run] = await db
    .select({ storeId: scrapeRuns.storeId, source: scrapeRuns.source })
    .from(scrapeRuns)
    .where(eq(scrapeRuns.id, id));
  if (!run) throw new Error(`No existe la ejecución ${runId}`);
  const foreign = items.find((i) => i.storeId !== run.storeId);
  if (foreign) throw new Error(`La ejecución ${runId} es de "${run.storeId}", no de "${foreign.storeId}"`);

  // Si un adaptador repite un producto en el mismo lote, gana la última aparición.
  const unique = [...new Map(items.map((i) => [i.externalId, i])).values()];
  const withTitles = unique.map((item) => ({ item, titleNorm: normalizeTitle(item.rawTitle) }));

  // Las correcciones "no es de Magic" (fundas, otros juegos…) mandan sobre el emparejador.
  const ignored = new Set(
    (
      await db
        .select({ titleNorm: matchOverrides.titleNorm })
        .from(matchOverrides)
        .where(
          and(
            eq(matchOverrides.storeId, run.storeId),
            eq(matchOverrides.ignore, true),
            inArray(
              matchOverrides.titleNorm,
              withTitles.map((w) => w.titleNorm),
            ),
          ),
        )
    ).map((o) => o.titleNorm),
  );

  const rows = withTitles.map(({ item, titleNorm }) => {
    const isIgnored = ignored.has(titleNorm);
    const match = isIgnored ? null : item.match;
    const sealed = match?.kind === 'sealed' ? match : null;
    const single = match && match.kind !== 'sealed' ? match : null;
    return {
      storeId: run.storeId,
      source: run.source,
      kind: match ? (sealed ? ('sealed' as const) : ('single' as const)) : (item.kind ?? 'single'),
      externalId: item.externalId,
      rawTitle: item.rawTitle,
      titleNorm,
      url: item.url,
      priceCents: item.priceCents,
      currency: item.currency,
      inStock: item.inStock,
      quantity: item.quantity ?? null,
      condition: item.condition ?? null,
      language: item.language ?? null,
      finish: item.finish ?? 'nonfoil',
      setHint: item.setHint ?? null,
      cardmarketId: item.cardmarketId ?? null,
      collectorNumber: item.collectorNumber ?? null,
      matchStatus: isIgnored ? ('ignored' as const) : match ? ('matched' as const) : ('unmatched' as const),
      matchMethod: match?.method ?? null,
      matchConfidence: match?.confidence ?? null,
      oracleId: single?.oracleId ?? null,
      scryfallId: single?.scryfallId ?? null,
      sealedProductId: sealed?.sealedProductId ?? null,
      candidates: null,
      lastSeenAt: new Date(item.scrapedAt),
      lastRunId: id,
    };
  });

  await inBatches(rows, LISTING_BATCH, (batch) =>
    db
      .insert(listings)
      .values(batch)
      .onConflictDoUpdate({
        target: [listings.storeId, listings.source, listings.externalId],
        set: excluded(listings, [
          'kind',
          'rawTitle',
          'titleNorm',
          'url',
          'priceCents',
          'currency',
          'inStock',
          'quantity',
          'condition',
          'language',
          'finish',
          'setHint',
          'cardmarketId',
          'collectorNumber',
          'matchStatus',
          'matchMethod',
          'matchConfidence',
          'oracleId',
          'scryfallId',
          'sealedProductId',
          'candidates',
          'lastSeenAt',
          'lastRunId',
        ]),
      }),
  );
}

export async function finishRun(
  db: Db,
  runId: string,
  result: { status: ScrapeStatus; stats: ScrapeRunStats; error?: string },
): Promise<void> {
  const id = parseRunId(runId);
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(scrapeRuns)
      .set({
        status: result.status,
        finishedAt: new Date(),
        found: result.stats.found,
        matched: result.stats.matched,
        unmatched: result.stats.unmatched,
        error: result.error ?? null,
      })
      .where(eq(scrapeRuns.id, id))
      .returning({ storeId: scrapeRuns.storeId, source: scrapeRuns.source });
    if (!updated) throw new Error(`No existe la ejecución ${runId}`);

    // Solo una pasada completa dice qué ha desaparecido, y solo de su propia fuente.
    if (result.status === 'ok') {
      await tx
        .update(listings)
        .set({ inStock: false })
        .where(
          and(
            eq(listings.storeId, updated.storeId),
            eq(listings.source, updated.source),
            eq(listings.inStock, true),
            sql`${listings.lastRunId} is distinct from ${id}`,
          ),
        );
      await tx.update(stores).set({ lastSuccessAt: new Date() }).where(eq(stores.id, updated.storeId));
    }
  });
}
