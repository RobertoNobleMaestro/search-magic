import { and, eq, sql, type SQL } from 'drizzle-orm';
import type {
  AnyMatchResult,
  CatalogLookup,
  Finish,
  PrintingCandidate,
  SealedCandidate,
} from '../../lib/data/types';
import { normalizeName } from '../../lib/normalize';
import type { Db } from '../client';
import { matchOverrides, printings, sealedProducts, setAliases, sets } from '../schema';

type ExactHit = { oracleId: string; name: string; isFace: boolean };
type PrintingRef = { oracleId: string; scryfallId: string; collectorNumber: string };

type CatalogCache = {
  /** `${lang}|${nameNorm}` */
  exact: Map<string, ExactHit[]>;
  /** código, nombre normalizado o alias → código */
  sets: Map<string, string>;
  /** `${oracleId}|${setCode}` */
  printings: Map<string, PrintingCandidate[]>;
  /** idProduct de Cardmarket → impresión */
  printingByCardmarket: Map<number, PrintingRef>;
  sealedByCardmarket: Map<number, SealedCandidate>;
  sealedBySet: Map<string, SealedCandidate[]>;
  /** `${storeId}|${titleNorm}` */
  overrides: Map<string, AnyMatchResult | 'ignore'>;
};

/**
 * "Lightning Bolt" es el nombre completo de una carta y también una cara de
 * "Emeritus of Conflict // Lightning Bolt": si hay coincidencias de nombre completo,
 * las de cara no cuentan.
 */
export function preferFullNames(hits: ExactHit[]): Array<{ oracleId: string; name: string }> {
  const full = hits.filter((h) => !h.isFace);
  const seen = new Set<string>();
  return (full.length > 0 ? full : hits)
    .filter((h) => !seen.has(h.oracleId) && !!seen.add(h.oracleId))
    .map(({ oracleId, name }) => ({ oracleId, name }));
}

/**
 * Unas 370 ids de Cardmarket se repiten entre la impresión normal y su variante con ★ o †
 * (foil de la época, errata). Gana el número de colección sin símbolos y, a igualdad, el más corto.
 */
export function preferPlainCollectorNumber<T extends { collectorNumber: string }>(a: T, b: T): T {
  const plain = (n: string) => /^[0-9a-z-]+$/i.test(n);
  if (plain(a.collectorNumber) !== plain(b.collectorNumber)) return plain(a.collectorNumber) ? a : b;
  return b.collectorNumber.length < a.collectorNumber.length ? b : a;
}

const key = (...parts: string[]) => parts.join('|');

type PrintingRow = {
  oracleId: string;
  setCode: string;
  cardmarketId: number | null;
  scryfallId: string;
  collectorNumber: string;
  finishes: Finish[];
  borderColor: string | null;
  frame: string | null;
  frameEffects: string[];
  promoTypes: string[];
  fullArt: boolean;
  promo: boolean;
};

function toCandidate(row: PrintingRow): PrintingCandidate {
  return {
    scryfallId: row.scryfallId,
    collectorNumber: row.collectorNumber,
    finishes: row.finishes,
    borderColor: row.borderColor ?? '',
    frameEffects: row.frameEffects,
    promoTypes: row.promoTypes,
    fullArt: row.fullArt,
    promo: row.promo,
    ...(row.frame ? { frame: row.frame } : {}),
  };
}

const sealedColumns = {
  sealedProductId: sealedProducts.id,
  setCode: sealedProducts.setCode,
  name: sealedProducts.name,
  category: sealedProducts.category,
  subtype: sealedProducts.subtype,
};

function overrideResult(o: typeof matchOverrides.$inferSelect): AnyMatchResult | 'ignore' {
  if (o.ignore) return 'ignore';
  if (o.sealedProductId) return { kind: 'sealed', sealedProductId: o.sealedProductId, confidence: 1, method: 'override' };
  if (o.oracleId) return { kind: 'single', oracleId: o.oracleId, scryfallId: o.scryfallId, confidence: 1, method: 'override' };
  return 'ignore';
}

/**
 * Búsquedas de catálogo para el emparejador. Sin `loadCatalog()` cada llamada va a la BD;
 * con él, todo menos los trigramas se resuelve en memoria (unas decenas de MB).
 */
export class DbCatalogLookup implements CatalogLookup {
  private cache: CatalogCache | null = null;

  constructor(private readonly db: () => Db) {}

  async loadCatalog(): Promise<void> {
    const db = this.db();
    const [names, setRows, aliasRows, printingRows, sealedRows, overrideRows] = await Promise.all([
      db.execute<{ oracle_id: string; lang: string; name_norm: string; is_face: boolean; name: string }>(sql`
        select cn.oracle_id, cn.lang, cn.name_norm, cn.is_face, c.name
        from card_names cn join cards c on c.oracle_id = cn.oracle_id`),
      db.select({ code: sets.code, nameNorm: sets.nameNorm }).from(sets),
      db.select().from(setAliases),
      this.selectPrintings(),
      db.select({ ...sealedColumns, cardmarketId: sealedProducts.cardmarketId }).from(sealedProducts),
      db.select().from(matchOverrides),
    ]);

    const cache: CatalogCache = {
      exact: new Map(),
      sets: new Map(),
      printings: new Map(),
      printingByCardmarket: new Map(),
      sealedByCardmarket: new Map(),
      sealedBySet: new Map(),
      overrides: new Map(),
    };
    const push = <K, V>(map: Map<K, V[]>, k: K, v: V) => {
      const list = map.get(k);
      if (list) list.push(v);
      else map.set(k, [v]);
    };

    for (const r of names.rows) {
      push(cache.exact, key(r.lang, r.name_norm), { oracleId: r.oracle_id, name: r.name, isFace: r.is_face });
    }
    // Precedencia: alias > código > nombre (los posteriores sobrescriben).
    for (const s of setRows) cache.sets.set(s.nameNorm, s.code);
    for (const s of setRows) cache.sets.set(s.code, s.code);
    for (const a of aliasRows) cache.sets.set(a.aliasNorm, a.setCode);
    for (const p of printingRows) {
      push(cache.printings, key(p.oracleId, p.setCode), toCandidate(p));
      if (p.cardmarketId != null) {
        const ref = { oracleId: p.oracleId, scryfallId: p.scryfallId, collectorNumber: p.collectorNumber };
        const current = cache.printingByCardmarket.get(p.cardmarketId);
        cache.printingByCardmarket.set(p.cardmarketId, current ? preferPlainCollectorNumber(current, ref) : ref);
      }
    }
    for (const { cardmarketId, ...candidate } of sealedRows) {
      push(cache.sealedBySet, candidate.setCode, candidate);
      if (cardmarketId != null) cache.sealedByCardmarket.set(cardmarketId, candidate);
    }
    for (const o of overrideRows) cache.overrides.set(key(o.storeId, o.titleNorm), overrideResult(o));
    this.cache = cache;
  }

  // ───────── Cartas ─────────

  async findByExactName(nameNorm: string, lang: 'en' | 'es'): Promise<Array<{ oracleId: string; name: string }>> {
    if (this.cache) return preferFullNames(this.cache.exact.get(key(lang, nameNorm)) ?? []);
    const rows = await this.db().execute<{ oracle_id: string; name: string; is_face: boolean }>(sql`
      select cn.oracle_id, c.name, cn.is_face
      from card_names cn join cards c on c.oracle_id = cn.oracle_id
      where cn.name_norm = ${nameNorm} and cn.lang = ${lang}`);
    return preferFullNames(rows.rows.map((r) => ({ oracleId: r.oracle_id, name: r.name, isFace: r.is_face })));
  }

  async findByTrigram(
    nameNorm: string,
    minSimilarity: number,
    limit: number,
  ): Promise<Array<{ oracleId: string; name: string; lang: 'en' | 'es'; similarity: number }>> {
    return this.withSimilarityThreshold(minSimilarity, async (tx) => {
      const rows = await tx.execute<{ oracle_id: string; name: string; lang: 'en' | 'es'; sim: number }>(sql`
        select oracle_id, name, lang, sim from (
          select distinct on (cn.oracle_id) cn.oracle_id, c.name, cn.lang,
                 similarity(cn.name_norm, ${nameNorm})::float8 as sim
          from card_names cn join cards c on c.oracle_id = cn.oracle_id
          where cn.name_norm % ${nameNorm}
          order by cn.oracle_id, sim desc, cn.is_face
        ) best
        order by sim desc
        limit ${Math.max(1, Math.floor(limit))}`);
      return rows.rows.map((r) => ({ oracleId: r.oracle_id, name: r.name, lang: r.lang, similarity: r.sim }));
    });
  }

  async resolveSet(hint: string): Promise<string | null> {
    const norm = normalizeName(hint);
    if (!norm) return null;
    if (this.cache) return this.cache.sets.get(norm) ?? null;
    const rows = await this.db().execute<{ code: string }>(sql`
      select code from (
        select set_code as code, 1 as prio from set_aliases where alias_norm = ${norm}
        union all select code, 2 from sets where code = ${norm}
        union all select code, 3 from sets where name_norm = ${norm}
      ) found order by prio limit 1`);
    return rows.rows[0]?.code ?? null;
  }

  async findPrintings(oracleId: string, setCode: string): Promise<PrintingCandidate[]> {
    if (this.cache) return this.cache.printings.get(key(oracleId, setCode)) ?? [];
    const rows = await this.selectPrintings(and(eq(printings.oracleId, oracleId), eq(printings.setCode, setCode)));
    return rows.map(toCandidate);
  }

  async findPrintingByCardmarketId(cardmarketId: number): Promise<{ oracleId: string; scryfallId: string } | null> {
    const pick = (ref: PrintingRef | undefined) => (ref ? { oracleId: ref.oracleId, scryfallId: ref.scryfallId } : null);
    if (this.cache) return pick(this.cache.printingByCardmarket.get(cardmarketId));
    const rows = await this.selectPrintings(eq(printings.cardmarketId, cardmarketId));
    return pick(rows.reduce<PrintingRef | undefined>((best, r) => (best ? preferPlainCollectorNumber(best, r) : r), undefined));
  }

  // ───────── Sellado ─────────

  async findSealedByCardmarketId(cardmarketId: number): Promise<SealedCandidate | null> {
    if (this.cache) return this.cache.sealedByCardmarket.get(cardmarketId) ?? null;
    const [row] = await this.db()
      .select(sealedColumns)
      .from(sealedProducts)
      .where(eq(sealedProducts.cardmarketId, cardmarketId))
      .limit(1);
    return row ?? null;
  }

  async findSealedProducts(setCode: string, opts: { category?: string; subtype?: string } = {}): Promise<SealedCandidate[]> {
    const matches = (c: SealedCandidate) =>
      (!opts.category || c.category === opts.category) && (!opts.subtype || c.subtype === opts.subtype);
    if (this.cache) return (this.cache.sealedBySet.get(setCode) ?? []).filter(matches);
    const rows = await this.db().select(sealedColumns).from(sealedProducts).where(eq(sealedProducts.setCode, setCode));
    return rows.filter(matches);
  }

  async findSealedByTrigram(
    nameNorm: string,
    minSimilarity: number,
    limit: number,
  ): Promise<Array<SealedCandidate & { similarity: number }>> {
    return this.withSimilarityThreshold(minSimilarity, async (tx) => {
      const rows = await tx.execute<{
        id: string;
        set_code: string;
        name: string;
        category: string | null;
        subtype: string | null;
        sim: number;
      }>(sql`
        select id, set_code, name, category, subtype, similarity(name_norm, ${nameNorm})::float8 as sim
        from sealed_products
        where name_norm % ${nameNorm}
        order by sim desc, released_at desc nulls last
        limit ${Math.max(1, Math.floor(limit))}`);
      return rows.rows.map((r) => ({
        sealedProductId: r.id,
        setCode: r.set_code,
        name: r.name,
        category: r.category,
        subtype: r.subtype,
        similarity: r.sim,
      }));
    });
  }

  // ───────── Correcciones manuales ─────────

  async getOverride(storeId: string, titleNorm: string): Promise<AnyMatchResult | null> {
    if (this.cache) {
      const hit = this.cache.overrides.get(key(storeId, titleNorm));
      return hit && hit !== 'ignore' ? hit : null;
    }
    const [row] = await this.db()
      .select()
      .from(matchOverrides)
      .where(and(eq(matchOverrides.storeId, storeId), eq(matchOverrides.titleNorm, titleNorm)));
    const result = row ? overrideResult(row) : null;
    return result && result !== 'ignore' ? result : null;
  }

  // ───────── Utilidades ─────────

  /**
   * El umbral del operador % es de sesión; set_config(..., true) lo limita a la transacción,
   * que es lo que conserva PgBouncer en modo transacción.
   */
  private withSimilarityThreshold<T>(minSimilarity: number, run: (tx: Db) => Promise<T>): Promise<T> {
    const threshold = Math.min(Math.max(minSimilarity, 0), 1);
    return this.db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('pg_trgm.similarity_threshold', ${String(threshold)}, true)`);
      return run(tx as unknown as Db);
    });
  }

  private selectPrintings(where?: SQL): Promise<PrintingRow[]> {
    const query = this.db()
      .select({
        oracleId: printings.oracleId,
        setCode: printings.setCode,
        cardmarketId: printings.cardmarketId,
        scryfallId: printings.scryfallId,
        collectorNumber: printings.collectorNumber,
        finishes: printings.finishes,
        borderColor: printings.borderColor,
        frame: printings.frame,
        frameEffects: printings.frameEffects,
        promoTypes: printings.promoTypes,
        fullArt: printings.fullArt,
        promo: printings.promo,
      })
      .from(printings);
    return where ? query.where(where) : query;
  }
}
