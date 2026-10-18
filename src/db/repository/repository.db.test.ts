/**
 * Integración contra una BD real con el catálogo de Scryfall importado.
 *   npm run test:db
 * Todo corre dentro de una transacción que se deshace al final: no deja datos.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MatchedListing, Repository } from '../../lib/data/types';
import { normalizeName } from '../../lib/normalize';
import { createDb, type Db } from '../client';
import { directDatabaseUrl, loadLocalEnv } from '../env';
import { createDbRepository } from './index';

// normalizeTitle es del emparejador; aquí basta con normalizar el título entero.
vi.mock('../../lib/matching', () => ({ normalizeTitle: (raw: string) => normalizeName(raw) }));

const enabled = import.meta.env.MODE === 'db';
const BOLT = '4457ed35-7c10-48c8-9776-456485fdf070';
const STORE = 'test-store-integration';

class Rollback extends Error {}

describe.runIf(enabled)('DbRepository (integración)', () => {
  let close: () => Promise<void>;
  let repo: Repository;
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
      .transaction(async (tx) => {
        repo = createDbRepository(tx as unknown as Db);
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

  describe('catálogo', () => {
    it('autocompleta en español y en inglés, con erratas y por prefijos de palabra', async () => {
      const [es] = await repo.autocomplete('relampago');
      expect(es).toMatchObject({ oracleId: BOLT, nameEn: 'Lightning Bolt', matchedName: 'Relámpago', lang: 'es' });

      const typo = await repo.autocomplete('lightnig bolt');
      expect(typo[0]?.oracleId).toBe(BOLT);

      const words = await repo.autocomplete('light bol');
      expect(words.map((s) => s.oracleId)).toContain(BOLT);
    });

    it('la búsqueda exacta prefiere el nombre completo a la cara de otra carta', async () => {
      expect(await repo.findByExactName('lightning bolt', 'en')).toEqual([{ oracleId: BOLT, name: 'Lightning Bolt' }]);
      expect(await repo.findByExactName('relampago', 'es')).toEqual([{ oracleId: BOLT, name: 'Lightning Bolt' }]);
    });

    it('resuelve ediciones por código y por nombre, y sus impresiones', async () => {
      expect(await repo.resolveSet('M10')).toBe('m10');
      expect(await repo.resolveSet('Magic 2010')).toBe('m10');
      expect(await repo.resolveSet('no existe')).toBeNull();
      const prints = await repo.findPrintings(BOLT, 'm10');
      expect(prints).toHaveLength(1);
      expect(prints[0]).toMatchObject({ collectorNumber: '146', finishes: ['nonfoil', 'foil'] });
    });

    it('busca por trigramas con umbral', async () => {
      const hits = await repo.findByTrigram('lightnig bolt', 0.5, 3);
      expect(hits[0]).toMatchObject({ oracleId: BOLT, lang: 'en' });
      expect(hits.every((h) => h.similarity >= 0.5)).toBe(true);
    });

    it('da los mismos resultados con el catálogo precargado en memoria', async () => {
      await repo.loadCatalog!();
      expect(await repo.findByExactName('lightning bolt', 'en')).toEqual([{ oracleId: BOLT, name: 'Lightning Bolt' }]);
      expect(await repo.resolveSet('magic 2010')).toBe('m10');
      expect((await repo.findPrintings(BOLT, 'm10'))[0]?.collectorNumber).toBe('146');
    });
  });

  describe('tiendas, scraping y ofertas', () => {
    const listing = (externalId: string, overrides: Partial<MatchedListing> = {}): MatchedListing => ({
      storeId: STORE,
      externalId,
      rawTitle: 'Lightning Bolt (M10) NM',
      url: `https://tienda.example/p/${externalId}`,
      priceCents: 200,
      currency: 'EUR',
      inStock: true,
      scrapedAt: new Date().toISOString(),
      match: { oracleId: BOLT, scryfallId: null, confidence: 0.95, method: 'exact_en' },
      ...overrides,
    });

    it('guarda listados, filtra ofertas y marca agotado lo que desaparece', async () => {
      await repo.upsertStores([
        { id: STORE, name: 'Tienda de prueba', city: 'hospitalet', address: 'C/ Prueba 1', website: 'https://tienda.example', platform: 'shopify' },
      ]);
      const [m10] = await repo.findPrintings(BOLT, 'm10');

      const run1 = await repo.startRun(STORE);
      await repo.saveListings(run1, [
        listing('nm-es', { priceCents: 250, condition: 'NM', language: 'es', match: { oracleId: BOLT, scryfallId: m10!.scryfallId, confidence: 1, method: 'exact_en' } }),
        listing('ex-foil', { priceCents: 900, condition: 'EX', finish: 'foil' }),
        listing('sin-estado', { priceCents: 150 }),
        listing('sobre', { rawTitle: 'Sobre de Foundations', match: null }),
      ]);
      await repo.finishRun(run1, { status: 'ok', stats: { found: 4, matched: 3, unmatched: 1 } });

      const all = await repo.getOffers(BOLT);
      const mine = all.filter((o) => o.store.id === STORE);
      expect(mine.map((o) => o.priceCents)).toEqual([150, 250, 900]);
      const nm = mine.find((o) => o.condition === 'NM')!;
      expect(nm.printing?.setCode).toBe('m10');
      expect(nm.referencePriceCents).toBe(m10 ? nm.printing!.priceEurCents : null);

      const nmOrBetter = (await repo.getOffers(BOLT, { minCondition: 'NM' })).filter((o) => o.store.id === STORE);
      expect(nmOrBetter.map((o) => o.condition)).toEqual(['NM']);
      const foil = (await repo.getOffers(BOLT, { finish: 'foil', cities: ['hospitalet'] })).filter((o) => o.store.id === STORE);
      expect(foil).toHaveLength(1);
      expect(await repo.getOffers(BOLT, { cities: ['barcelona'] }).then((o) => o.filter((x) => x.store.id === STORE))).toHaveLength(0);

      const unmatched = await repo.listUnmatched({ limit: 500 });
      expect(unmatched.items.find((u) => u.storeId === STORE)?.rawTitle).toBe('Sobre de Foundations');

      // Segunda pasada completa en la que ya no aparece la carta foil.
      const run2 = await repo.startRun(STORE);
      await repo.saveListings(run2, [
        listing('nm-es', { priceCents: 240, condition: 'NM', language: 'es' }),
        listing('sin-estado', { priceCents: 150 }),
      ]);
      await repo.finishRun(run2, { status: 'ok', stats: { found: 2, matched: 2, unmatched: 0 } });

      const after = (await repo.getOffers(BOLT)).filter((o) => o.store.id === STORE);
      expect(after.find((o) => o.finish === 'foil')?.inStock).toBe(false);
      expect((await repo.getOffers(BOLT, { inStockOnly: true })).filter((o) => o.store.id === STORE)).toHaveLength(2);

      const store = await repo.getStore(STORE);
      expect(store).toMatchObject({ city: 'hospitalet', lastStatus: 'ok', listingCount: 3, inStockCount: 2 });
      expect(store!.lastScrapedAt).not.toBeNull();
      expect((await repo.listLatestRuns()).find((r) => r.storeId === STORE)?.id).toBe(run2);

      const [summary] = await repo.searchCards('lightning bolt', 1);
      expect(summary).toMatchObject({ oracleId: BOLT, nameEs: 'Relámpago' });
      expect(summary!.minPriceCents).toBeLessThanOrEqual(150);

      const card = await repo.getCard(BOLT);
      expect(card?.printings.length).toBeGreaterThan(10);
      expect(await repo.getCard('no-es-un-uuid')).toBeNull();
    });

    it('una pasada parcial no marca nada como agotado', async () => {
      const run = await repo.startRun(STORE);
      await repo.saveListings(run, [listing('nm-es', { condition: 'NM' })]);
      await repo.finishRun(run, { status: 'partial', stats: { found: 1, matched: 1, unmatched: 0 } });
      const stillInStock = (await repo.getOffers(BOLT, { inStockOnly: true })).filter((o) => o.store.id === STORE);
      expect(stillInStock.map((o) => o.listingId)).toHaveLength(2);
    });
  });
});
