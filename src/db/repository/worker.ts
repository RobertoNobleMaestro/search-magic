import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { MatchedListing, ScrapeRunStats, ScrapeStatus, StoreInfo } from '../../lib/data/types';
import { normalizeTitle } from '../../lib/matching';
import type { Db } from '../client';
import { listings, matchOverrides, scrapeRuns, stores } from '../schema';
import { excluded, inBatches } from '../sql';

/** 23 columnas por fila: 500 filas quedan lejos del límite de 65.535 parámetros. */
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
            address: s.address,
            websiteUrl: s.website,
            platform: s.platform,
            enabled: true,
          })),
        )
        .onConflictDoUpdate({
          target: stores.id,
          set: { ...excluded(stores, ['name', 'city', 'address', 'websiteUrl', 'platform', 'enabled']), updatedAt: sql`now()` },
        });
    }
    const ids = configs.map((s) => s.id);
    await tx
      .update(stores)
      .set({ enabled: false, updatedAt: sql`now()` })
      .where(ids.length > 0 ? notInArray(stores.id, ids) : undefined);
  });
}

export async function startRun(db: Db, storeId: string): Promise<string> {
  const [run] = await db.insert(scrapeRuns).values({ storeId }).returning({ id: scrapeRuns.id });
  return String(run!.id);
}

export async function saveListings(db: Db, runId: string, items: MatchedListing[]): Promise<void> {
  const run = parseRunId(runId);
  if (items.length === 0) return;

  // Si un adaptador repite un producto en el mismo lote, gana la última aparición.
  const unique = [...new Map(items.map((i) => [`${i.storeId}|${i.externalId}`, i])).values()];
  const withTitles = unique.map((item) => ({ item, titleNorm: normalizeTitle(item.rawTitle) }));

  // Las correcciones "no es una carta" (sobres, fundas…) mandan sobre el emparejador.
  const storeIds = [...new Set(unique.map((i) => i.storeId))];
  const ignored = new Set(
    (
      await db
        .select({ storeId: matchOverrides.storeId, titleNorm: matchOverrides.titleNorm })
        .from(matchOverrides)
        .where(and(inArray(matchOverrides.storeId, storeIds), eq(matchOverrides.ignore, true)))
    ).map((o) => `${o.storeId}|${o.titleNorm}`),
  );

  const rows = withTitles.map(({ item, titleNorm }) => {
    const isIgnored = ignored.has(`${item.storeId}|${titleNorm}`);
    const match = isIgnored ? null : item.match;
    return {
      storeId: item.storeId,
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
      matchStatus: isIgnored ? ('ignored' as const) : match ? ('matched' as const) : ('unmatched' as const),
      matchMethod: match?.method ?? null,
      matchConfidence: match?.confidence ?? null,
      oracleId: match?.oracleId ?? null,
      scryfallId: match?.scryfallId ?? null,
      candidates: null,
      lastSeenAt: new Date(item.scrapedAt),
      lastRunId: run,
    };
  });

  await inBatches(rows, LISTING_BATCH, (batch) =>
    db
      .insert(listings)
      .values(batch)
      .onConflictDoUpdate({
        target: [listings.storeId, listings.externalId],
        set: excluded(listings, [
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
          'matchStatus',
          'matchMethod',
          'matchConfidence',
          'oracleId',
          'scryfallId',
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
  const run = parseRunId(runId);
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
      .where(eq(scrapeRuns.id, run))
      .returning({ storeId: scrapeRuns.storeId });
    if (!updated) throw new Error(`No existe la ejecución ${runId}`);

    // Solo con una pasada completa se sabe qué ha desaparecido de la web de la tienda.
    if (result.status === 'ok') {
      await tx
        .update(listings)
        .set({ inStock: false })
        .where(
          and(
            eq(listings.storeId, updated.storeId),
            eq(listings.inStock, true),
            sql`${listings.lastRunId} is distinct from ${run}`,
          ),
        );
      await tx.update(stores).set({ lastSuccessAt: new Date() }).where(eq(stores.id, updated.storeId));
    }
  });
}
