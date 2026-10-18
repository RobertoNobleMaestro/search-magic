import { and, eq, sql } from 'drizzle-orm';
import type { CatalogLookup, MatchResult, PrintingCandidate } from '../../lib/data/types';
import { normalizeName } from '../../lib/normalize';
import type { Db } from '../client';
import { matchOverrides, printings, setAliases, sets } from '../schema';

type ExactHit = { oracleId: string; name: string; isFace: boolean };

type CatalogCache = {
  /** `${lang}|${nameNorm}` */
  exact: Map<string, ExactHit[]>;
  /** código, nombre normalizado o alias → código */
  sets: Map<string, string>;
  /** `${oracleId}|${setCode}` */
  printings: Map<string, PrintingCandidate[]>;
  /** `${storeId}|${titleNorm}` */
  overrides: Map<string, MatchResult | 'ignore'>;
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

const key = (...parts: string[]) => parts.join('|');

type PrintingRow = PrintingCandidate & { oracleId: string; setCode: string };

function toCandidate({ oracleId: _o, setCode: _s, ...row }: PrintingRow): PrintingCandidate {
  return { ...row, borderColor: row.borderColor ?? '' };
}

/**
 * Búsquedas de catálogo para el emparejador. Sin `loadCatalog()` cada llamada va a la BD;
 * con él, todo menos el trigram se resuelve en memoria (unos pocos MB).
 */
export class DbCatalogLookup implements CatalogLookup {
  private cache: CatalogCache | null = null;

  constructor(private readonly db: () => Db) {}

  async loadCatalog(): Promise<void> {
    const db = this.db();
    const [names, setRows, aliasRows, printingRows, overrideRows] = await Promise.all([
      db.execute<{ oracle_id: string; lang: string; name_norm: string; is_face: boolean; name: string }>(sql`
        select cn.oracle_id, cn.lang, cn.name_norm, cn.is_face, c.name
        from card_names cn join cards c on c.oracle_id = cn.oracle_id`),
      db.select({ code: sets.code, nameNorm: sets.nameNorm }).from(sets),
      db.select().from(setAliases),
      this.selectPrintings(),
      db.select().from(matchOverrides),
    ]);

    const cache: CatalogCache = { exact: new Map(), sets: new Map(), printings: new Map(), overrides: new Map() };
    for (const r of names.rows) {
      const k = key(r.lang, r.name_norm);
      const hit = { oracleId: r.oracle_id, name: r.name, isFace: r.is_face };
      const list = cache.exact.get(k);
      if (list) list.push(hit);
      else cache.exact.set(k, [hit]);
    }
    // Precedencia: alias > código > nombre (los posteriores sobrescriben).
    for (const s of setRows) cache.sets.set(s.nameNorm, s.code);
    for (const s of setRows) cache.sets.set(s.code, s.code);
    for (const a of aliasRows) cache.sets.set(a.aliasNorm, a.setCode);
    for (const p of printingRows) {
      const k = key(p.oracleId, p.setCode);
      const list = cache.printings.get(k);
      if (list) list.push(toCandidate(p));
      else cache.printings.set(k, [toCandidate(p)]);
    }
    for (const o of overrideRows) {
      cache.overrides.set(
        key(o.storeId, o.titleNorm),
        o.ignore || !o.oracleId
          ? 'ignore'
          : { oracleId: o.oracleId, scryfallId: o.scryfallId, confidence: 1, method: 'override' },
      );
    }
    this.cache = cache;
  }

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
    const threshold = Math.min(Math.max(minSimilarity, 0), 1);
    // El umbral del operador % es de sesión; set_config(..., true) lo limita a la transacción,
    // que es lo que conserva PgBouncer en modo transacción.
    return this.db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('pg_trgm.similarity_threshold', ${String(threshold)}, true)`);
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
    const rows = await this.selectPrintings(oracleId, setCode);
    return rows.map(toCandidate);
  }

  async getOverride(storeId: string, titleNorm: string): Promise<MatchResult | null> {
    if (this.cache) {
      const hit = this.cache.overrides.get(key(storeId, titleNorm));
      return hit && hit !== 'ignore' ? hit : null;
    }
    const [row] = await this.db()
      .select()
      .from(matchOverrides)
      .where(and(eq(matchOverrides.storeId, storeId), eq(matchOverrides.titleNorm, titleNorm)));
    if (!row || row.ignore || !row.oracleId) return null;
    return { oracleId: row.oracleId, scryfallId: row.scryfallId, confidence: 1, method: 'override' };
  }

  private selectPrintings(oracleId?: string, setCode?: string): Promise<PrintingRow[]> {
    const query = this.db()
      .select({
        oracleId: printings.oracleId,
        setCode: printings.setCode,
        scryfallId: printings.scryfallId,
        collectorNumber: printings.collectorNumber,
        finishes: printings.finishes,
        borderColor: printings.borderColor,
        frameEffects: printings.frameEffects,
        promoTypes: printings.promoTypes,
        fullArt: printings.fullArt,
        promo: printings.promo,
      })
      .from(printings);
    const rows =
      oracleId && setCode
        ? query.where(and(eq(printings.oracleId, oracleId), eq(printings.setCode, setCode)))
        : query;
    return rows as Promise<PrintingRow[]>;
  }
}
