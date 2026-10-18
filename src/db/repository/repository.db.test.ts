/**
 * Integración contra una BD real con Scryfall y MTGJSON importados (npm run db:import).
 *   npm run test:db
 * Todo corre dentro de una transacción que se deshace al final: no deja datos.
 */
import { inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MatchedListing, Repository, StoreInfo } from '../../lib/data/types';
import { normalizeName } from '../../lib/normalize';
import { createDb, type Db } from '../client';
import { directDatabaseUrl, loadLocalEnv } from '../env';
import { matchOverrides, scrapeRuns } from '../schema';
import { createDbRepository } from './index';

// normalizeTitle es del emparejador; aquí basta con normalizar el título entero.
vi.mock('../../lib/matching', () => ({ normalizeTitle: (raw: string) => normalizeName(raw) }));
// Cada consulta a Neon cuesta una ida y vuelta (~110 ms desde España): los tests largos pasan de 5 s.
vi.setConfig({ testTimeout: 60_000 });

const enabled = import.meta.env.MODE === 'db';
const BOLT = '4457ed35-7c10-48c8-9776-456485fdf070';
const BOLT_M10_CARDMARKET = 21192;
const FDN_PLAY_BOX_CARDMARKET = 781940;
const LOCAL = 'test-local-store';
const ONLINE = 'test-online-store';

class Rollback extends Error {}

describe.runIf(enabled)('DbRepository (integración)', () => {
  let close: () => Promise<void>;
  let repo: Repository;
  let tx: Db;
  let release: () => void;
  let done: Promise<void>;

  beforeAll(async () => {
    loadLocalEnv();
    const conn = createDb(directDatabaseUrl(), { max: 1 });
    close = () => conn.pool.end();
    // Abre una transacción que vive durante todos los tests y se deshace en afterAll.
    let ready!: () => void;
    const opened = new Promise<void>((r) => (ready = r));
    done = conn.db
      .transaction(async (t) => {
        tx = t as unknown as Db;
        repo = createDbRepository(tx);
        ready();
        await new Promise<void>((r) => (release = r));
        throw new Rollback();
      })
      .catch((err) => {
        if (!(err instanceof Rollback)) throw err;
      });
    await opened;
  });

  afterAll(async () => {
    release?.();
    await done;
    await close?.();
  });

  describe('catálogo de cartas', () => {
    it('autocompleta en español y en inglés, con erratas y por prefijos de palabra', async () => {
      const [es] = await repo.autocomplete('relampago');
      expect(es).toMatchObject({ oracleId: BOLT, nameEn: 'Lightning Bolt', matchedName: 'Relámpago', lang: 'es' });
      expect((await repo.autocomplete('lightnig bolt'))[0]?.oracleId).toBe(BOLT);
      expect((await repo.autocomplete('light bol')).map((s) => s.oracleId)).toContain(BOLT);
    });

    it('la búsqueda exacta prefiere el nombre completo a la cara de otra carta', async () => {
      expect(await repo.findByExactName('lightning bolt', 'en')).toEqual([{ oracleId: BOLT, name: 'Lightning Bolt' }]);
      expect(await repo.findByExactName('relampago', 'es')).toEqual([{ oracleId: BOLT, name: 'Lightning Bolt' }]);
    });

    it('resuelve ediciones por código, nombre inglés y nombre español de MTGJSON', async () => {
      expect(await repo.resolveSet('M10')).toBe('m10');
      expect(await repo.resolveSet('Magic 2010')).toBe('m10');
      expect(await repo.resolveSet('Dominaria Unida')).toBe('dmu');
      expect(await repo.resolveSet('no existe')).toBeNull();
    });

    it('da las impresiones de una edición con su marco', async () => {
      const prints = await repo.findPrintings(BOLT, 'm10');
      expect(prints).toHaveLength(1);
      expect(prints[0]).toMatchObject({ collectorNumber: '146', finishes: ['nonfoil', 'foil'], frame: '2003' });
    });

    it('empareja por id de Cardmarket y prefiere la impresión sin ★ cuando el id se repite', async () => {
      const [m10] = await repo.findPrintings(BOLT, 'm10');
      expect(await repo.findPrintingByCardmarketId(BOLT_M10_CARDMARKET)).toEqual({ oracleId: BOLT, scryfallId: m10!.scryfallId });
      expect(await repo.findPrintingByCardmarketId(999_999_999)).toBeNull();

      const [duress] = await repo.findByExactName('duress', 'en');
      const plain = (await repo.findPrintings(duress!.oracleId, '7ed')).find((p) => p.collectorNumber === '131');
      expect((await repo.findPrintingByCardmarketId(2893))?.scryfallId).toBe(plain!.scryfallId);
    });

    it('busca por trigramas con umbral', async () => {
      const hits = await repo.findByTrigram('lightnig bolt', 0.5, 3);
      expect(hits[0]).toMatchObject({ oracleId: BOLT, lang: 'en' });
      expect(hits.every((h) => h.similarity >= 0.5)).toBe(true);
    });
  });

  describe('catálogo de sellado', () => {
    it('encuentra producto sellado por id de Cardmarket, por edición y por trigramas', async () => {
      const box = await repo.findSealedByCardmarketId(FDN_PLAY_BOX_CARDMARKET);
      expect(box).toMatchObject({ setCode: 'fdn', name: 'Foundations Play Booster Box', category: 'booster_box', subtype: 'play' });

      const boxes = await repo.findSealedProducts('fdn', { category: 'booster_box' });
      expect(boxes.map((b) => b.subtype).sort()).toEqual(['collector', 'play']);
      expect((await repo.findSealedProducts('fdn', { category: 'booster_box', subtype: 'play' }))[0]?.sealedProductId).toBe(box!.sealedProductId);

      const [best] = await repo.findSealedByTrigram('foundations play booster box', 0.5, 3);
      expect(best).toMatchObject({ sealedProductId: box!.sealedProductId, similarity: 1 });
    });

    it('busca sellado en español, por alias de edición y con erratas', async () => {
      const first = async (q: string) => (await repo.searchSealed(q, 1))[0]?.name;
      expect(await first('caja de sobres de juego bloomburrow')).toBe('Bloomburrow Play Booster Box');
      expect(await first('Dominaria Unida caja')).toMatch(/^Dominaria United .*Booster Box$/);
      expect(await first('sobre de coleccionista duskmourn')).toBe('Duskmourn House of Horror Collector Booster Pack');
      expect(await first('kit de presentación foundations')).toBe('Foundations Prerelease Pack');
      expect(await first('mazo commander duskmourn')).toMatch(/^Duskmourn House of Horror Commander Deck/);
      expect(await first('pirexia bundle')).toBe('Phyrexia All Will Be One Bundle');
      expect(await first('foundatons play boster box')).toBe('Foundations Play Booster Box');
      expect(await repo.searchSealed('de la', 5)).toEqual([]);
      // Sin categoría en la búsqueda (no hay término de categoría en el ORDER BY).
      expect((await repo.searchSealed('bloomburrow', 5)).every((s) => s.setCode === 'blb' || /bloomburrow/i.test(s.name))).toBe(true);
      expect(await repo.searchSealed('pidus guardian', 5)).toBeInstanceOf(Array);
    });

    it('da los mismos resultados con el catálogo precargado en memoria', async () => {
      const [m10] = await repo.findPrintings(BOLT, 'm10');
      await repo.loadCatalog!();
      expect(await repo.findByExactName('lightning bolt', 'en')).toEqual([{ oracleId: BOLT, name: 'Lightning Bolt' }]);
      expect(await repo.resolveSet('dominaria unida')).toBe('dmu');
      expect((await repo.findPrintings(BOLT, 'm10'))[0]).toMatchObject({ collectorNumber: '146', frame: '2003' });
      expect(await repo.findPrintingByCardmarketId(BOLT_M10_CARDMARKET)).toEqual({ oracleId: BOLT, scryfallId: m10!.scryfallId });
      expect((await repo.findSealedByCardmarketId(FDN_PLAY_BOX_CARDMARKET))?.name).toBe('Foundations Play Booster Box');
      expect(await repo.findSealedProducts('fdn', { category: 'booster_box' })).toHaveLength(2);
    });
  });

  describe('tiendas, fuentes y ofertas', () => {
    const stores: StoreInfo[] = [
      {
        id: LOCAL,
        name: 'Tienda local de prueba',
        city: "L'Hospitalet de Llobregat",
        province: 'Barcelona',
        local: true,
        address: 'C/ Prueba 1',
        website: 'https://local.example',
        platform: 'shopify',
        cardmarketUser: 'TiendaPrueba',
      },
      {
        id: ONLINE,
        name: 'Tienda online de prueba',
        city: 'Madrid',
        province: 'Madrid',
        local: false,
        address: null,
        website: 'https://online.example',
        platform: 'woocommerce',
        cardmarketUser: null,
      },
    ];

    const listing = (externalId: string, overrides: Partial<MatchedListing> = {}): MatchedListing => ({
      storeId: LOCAL,
      externalId,
      rawTitle: 'Lightning Bolt (M10) NM',
      url: `https://local.example/p/${externalId}`,
      priceCents: 200,
      currency: 'EUR',
      inStock: true,
      scrapedAt: new Date().toISOString(),
      match: { kind: 'single', oracleId: BOLT, scryfallId: null, confidence: 0.95, method: 'exact_en' },
      ...overrides,
    });

    it('guarda cartas y sellado de varias fuentes sin mezclarlas', async () => {
      await repo.upsertStores(stores);
      const [m10] = await repo.findPrintings(BOLT, 'm10');
      const box = (await repo.findSealedByCardmarketId(FDN_PLAY_BOX_CARDMARKET))!;

      const web = await repo.startRun(LOCAL);
      await repo.saveListings(web, [
        listing('nm-es', {
          priceCents: 250,
          condition: 'NM',
          language: 'es',
          collectorNumber: '146',
          match: { kind: 'single', oracleId: BOLT, scryfallId: m10!.scryfallId, confidence: 1, method: 'exact_en' },
        }),
        listing('ex-foil', { priceCents: 900, condition: 'EX', finish: 'foil' }),
        listing('caja-fdn', {
          rawTitle: 'Caja de sobres de juego Foundations (ES)',
          priceCents: 13995,
          language: 'es',
          kind: 'sealed',
          match: { kind: 'sealed', sealedProductId: box.sealedProductId, confidence: 0.9, method: 'trigram' },
        }),
        listing('fundas', { rawTitle: 'Fundas Dragon Shield Matte (100)', kind: 'sealed', match: null }),
      ]);
      await repo.finishRun(web, { status: 'ok', stats: { found: 4, matched: 3, unmatched: 1 } });

      // El stock de Cardmarket de la misma tienda reutiliza un externalId de la web: no debe chocar.
      const csv = await repo.startRun(LOCAL, 'cardmarket_csv');
      await repo.saveListings(csv, [
        listing('nm-es', {
          priceCents: 150,
          cardmarketId: BOLT_M10_CARDMARKET,
          url: 'https://www.cardmarket.com/en/Magic/Users/TiendaPrueba',
          match: { kind: 'single', oracleId: BOLT, scryfallId: m10!.scryfallId, confidence: 1, method: 'cardmarket_id' },
        }),
      ]);
      await repo.finishRun(csv, { status: 'ok', stats: { found: 1, matched: 1, unmatched: 0 } });

      const online = await repo.startRun(ONLINE);
      await repo.saveListings(online, [listing('o-1', { storeId: ONLINE, priceCents: 120, url: 'https://online.example/o-1' })]);
      await repo.finishRun(online, { status: 'ok', stats: { found: 1, matched: 1, unmatched: 0 } });

      const offers = (await repo.getOffers(BOLT)).filter((o) => [LOCAL, ONLINE].includes(o.store.id));
      expect(offers.map((o) => [o.store.id, o.source, o.priceCents])).toEqual([
        [ONLINE, 'web', 120],
        [LOCAL, 'cardmarket_csv', 150],
        [LOCAL, 'web', 250],
        [LOCAL, 'web', 900],
      ]);
      expect(offers[0]!.store).toEqual({ id: ONLINE, name: 'Tienda online de prueba', city: 'Madrid', local: false });
      const nm = offers.find((o) => o.condition === 'NM')!;
      expect(nm.printing?.setCode).toBe('m10');
      expect(nm.referencePriceCents).toBe(nm.printing!.priceEurCents);

      const mine = async (filters: Parameters<Repository['getOffers']>[1]) =>
        (await repo.getOffers(BOLT, filters)).filter((o) => [LOCAL, ONLINE].includes(o.store.id));
      expect((await mine({ localOnly: true })).every((o) => o.store.local)).toBe(true);
      expect(await mine({ cities: ["l'hospitalet de llobregat"] })).toHaveLength(3);
      expect((await mine({ minCondition: 'NM' })).map((o) => o.condition)).toEqual(['NM']);
      expect(await mine({ finish: 'foil' })).toHaveLength(1);

      const sealed = await repo.getSealedOffers(box.sealedProductId);
      expect(sealed.filter((o) => o.store.id === LOCAL)).toMatchObject([{ priceCents: 13995, language: 'es', source: 'web' }]);
      const [summary] = await repo.searchSealed('foundations play booster box', 1);
      expect(summary).toMatchObject({ sealedProductId: box.sealedProductId, setName: 'Foundations', category: 'booster_box' });
      expect(summary!.offerCount).toBeGreaterThanOrEqual(1);
      expect((await repo.getSealedProduct(box.sealedProductId))?.minPriceCents).toBeLessThanOrEqual(13995);

      const unmatched = (await repo.listUnmatched({ limit: 500 })).items.find((u) => u.storeId === LOCAL);
      expect(unmatched).toMatchObject({ rawTitle: 'Fundas Dragon Shield Matte (100)', kind: 'sealed', source: 'web', bestGuess: null });

      // Segunda pasada completa de la web en la que ya no aparece la foil: el CSV no se toca.
      const web2 = await repo.startRun(LOCAL);
      await repo.saveListings(web2, [listing('nm-es', { priceCents: 240, condition: 'NM' })]);
      await repo.finishRun(web2, { status: 'ok', stats: { found: 1, matched: 1, unmatched: 0 } });
      const after = (await repo.getOffers(BOLT, { inStockOnly: true })).filter((o) => o.store.id === LOCAL);
      expect(after.map((o) => [o.source, o.priceCents])).toEqual([
        ['cardmarket_csv', 150],
        ['web', 240],
      ]);
      expect((await repo.getSealedOffers(box.sealedProductId, { inStockOnly: true })).filter((o) => o.store.id === LOCAL)).toHaveLength(0);

      const detail = await repo.getStore(LOCAL);
      expect(detail).toMatchObject({ local: true, city: "L'Hospitalet de Llobregat", cardmarketUser: 'TiendaPrueba', lastStatus: 'ok' });
      expect(detail!.latestRuns.map((r) => [r.source, r.id]).sort()).toEqual([
        ['cardmarket_csv', csv],
        ['web', web2],
      ]);
      const listed = (await repo.listStores()).filter((s) => [LOCAL, ONLINE].includes(s.id));
      expect(listed.map((s) => s.id)).toEqual([LOCAL, ONLINE]);
      expect((await repo.listLatestRuns()).filter((r) => r.storeId === LOCAL)).toHaveLength(2);
    });

    it('aplica las correcciones manuales de carta, sellado e "ignorar"', async () => {
      const box = (await repo.findSealedByCardmarketId(FDN_PLAY_BOX_CARDMARKET))!;
      await tx.insert(matchOverrides).values([
        { storeId: LOCAL, titleNorm: 'caja fdn rara', sealedProductId: box.sealedProductId },
        { storeId: LOCAL, titleNorm: 'rayito', oracleId: BOLT },
        { storeId: LOCAL, titleNorm: 'tapete', ignore: true },
      ]);
      // `repo` tiene el catálogo precargado de antes; uno nuevo lee las correcciones de la BD…
      const fresh = createDbRepository(tx);
      expect(await fresh.getOverride(LOCAL, 'rayito')).toMatchObject({ kind: 'single', oracleId: BOLT });
      // …y recargar el catálogo las incorpora a la caché.
      await repo.loadCatalog!();
      expect(await repo.getOverride(LOCAL, 'caja fdn rara')).toEqual({
        kind: 'sealed',
        sealedProductId: box.sealedProductId,
        confidence: 1,
        method: 'override',
      });
      expect(await repo.getOverride(LOCAL, 'rayito')).toMatchObject({ kind: 'single', oracleId: BOLT, method: 'override' });
      expect(await repo.getOverride(LOCAL, 'tapete')).toBeNull();

      const run = await repo.startRun(LOCAL);
      await repo.saveListings(run, [listing('tapete-1', { rawTitle: 'Tapete' })]);
      await repo.finishRun(run, { status: 'partial', stats: { found: 1, matched: 0, unmatched: 0 } });
      expect((await repo.getOffers(BOLT)).find((o) => o.listingId && o.url.endsWith('tapete-1'))).toBeUndefined();
      expect((await repo.listUnmatched({ limit: 500 })).items.find((u) => u.rawTitle === 'Tapete')).toBeUndefined();
    });

    it('una pasada parcial no marca nada como agotado', async () => {
      const before = (await repo.getOffers(BOLT, { inStockOnly: true })).filter((o) => o.store.id === LOCAL).length;
      const run = await repo.startRun(LOCAL);
      await repo.saveListings(run, [listing('nm-es', { condition: 'NM' })]);
      await repo.finishRun(run, { status: 'partial', stats: { found: 1, matched: 1, unmatched: 0 } });
      expect((await repo.getOffers(BOLT, { inStockOnly: true })).filter((o) => o.store.id === LOCAL)).toHaveLength(before);
    });

    it('no muestra precios de relleno aunque se cuelen', async () => {
      const run = await repo.startRun(ONLINE);
      await repo.saveListings(run, [
        listing('relleno', { storeId: ONLINE, priceCents: 99_999_900, url: 'https://online.example/relleno' }),
        listing('gratis', { storeId: ONLINE, priceCents: 0, url: 'https://online.example/gratis' }),
      ]);
      await repo.finishRun(run, { status: 'partial', stats: { found: 2, matched: 2, unmatched: 0 } });
      const urls = (await repo.getOffers(BOLT)).map((o) => o.url);
      expect(urls).not.toContain('https://online.example/relleno');
      expect(urls).not.toContain('https://online.example/gratis');
      expect((await repo.searchCards('lightning bolt', 1))[0]!.minPriceCents).toBeGreaterThan(0);
    });

    it('cierra como error las ejecuciones que se quedaron en curso más de 6 h', async () => {
      const [stale] = await tx
        .insert(scrapeRuns)
        .values({ storeId: ONLINE, source: 'web', startedAt: sql`now() - interval '7 hours'` })
        .returning({ id: scrapeRuns.id });
      const [recent] = await tx
        .insert(scrapeRuns)
        .values({ storeId: ONLINE, source: 'web', startedAt: sql`now() - interval '1 hour'` })
        .returning({ id: scrapeRuns.id });
      await repo.startRun(ONLINE);
      const rows = await tx
        .select({ id: scrapeRuns.id, status: scrapeRuns.status, error: scrapeRuns.error })
        .from(scrapeRuns)
        .where(inArray(scrapeRuns.id, [stale!.id, recent!.id]));
      expect(rows.find((r) => r.id === stale!.id)).toMatchObject({ status: 'error', error: expect.stringMatching(/Interrumpida/) });
      expect(rows.find((r) => r.id === recent!.id)?.status).toBe('running');
    });

    it('una tienda solo con CSV toma como fecha de actualización la del propio stock', async () => {
      const CSV_ONLY = 'test-csv-only-store';
      await repo.upsertStores([
        ...stores,
        { ...stores[0]!, id: CSV_ONLY, name: 'Solo CSV', website: null, platform: null, cardmarketUser: 'SoloCsv' },
      ]);
      const run = await repo.startRun(CSV_ONLY, 'cardmarket_csv');
      await repo.saveListings(run, [listing('cm-1', { storeId: CSV_ONLY, scrapedAt: '2026-10-10T08:00:00.000Z' })]);
      await repo.finishRun(run, { status: 'ok', stats: { found: 1, matched: 1, unmatched: 0 } });
      expect((await repo.getStore(CSV_ONLY))?.lastScrapedAt).toBe('2026-10-10T08:00:00.000Z');
    });

    it('rechaza listados de otra tienda en una ejecución', async () => {
      const run = await repo.startRun(LOCAL);
      await expect(repo.saveListings(run, [listing('x', { storeId: ONLINE })])).rejects.toThrow(/es de "test-local-store"/);
    });

    it('la búsqueda de cartas suma las ofertas de todas las fuentes', async () => {
      const [summary] = await repo.searchCards('lightning bolt', 1);
      expect(summary).toMatchObject({ oracleId: BOLT, nameEs: 'Relámpago' });
      expect(summary!.minPriceCents).toBeLessThanOrEqual(150);
      expect((await repo.getCard(BOLT))?.printings.length).toBeGreaterThan(10);
      expect(await repo.getCard('no-es-un-uuid')).toBeNull();
      expect(await repo.getSealedProduct('no-es-un-uuid')).toBeNull();
    });
  });
});
