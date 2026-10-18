import { sql, type SQL } from 'drizzle-orm';
import {
  CONDITIONS,
  FINISHES,
  type CardSuggestion,
  type CardSummary,
  type City,
  type Finish,
  type Offer,
  type OfferFilters,
  type Printing,
  type ScrapeRun,
  type Store,
  type StoreDetail,
  type UnmatchedListing,
} from '../../lib/data/types';
import { normalizeName } from '../../lib/normalize';
import type { Db } from '../client';
import { textArray } from '../sql';

const CITIES: readonly City[] = ['barcelona', 'hospitalet'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const iso = (d: Date | string | null): string | null => (d == null ? null : new Date(d).toISOString());

// ───────── Búsqueda ─────────

/**
 * Cartas cuyo nombre (inglés o español, completo o de una cara) casa con `q`, por orden:
 * 0 nombre exacto, 1 empieza por q, 2 todas las palabras como prefijo ("light bo"),
 * 3 parecido por trigramas (erratas). Dentro de cada grupo, las más reimpresas primero.
 */
async function rankedCandidates(db: Db, q: string, limit: number): Promise<CardSuggestion[]> {
  const qn = normalizeName(q);
  if (qn.length < 2) return [];
  // normalizeName solo deja [a-z0-9 ], así que las palabras se pueden meter en LIKE y regex.
  const allWordsPrefix = sql.join(
    qn.split(' ').map((w) => sql`cn.name_norm ~ ${`(^| )${w}`}`),
    sql` and `,
  );
  const rows = await db.execute<{ oracle_id: string; name_en: string; matched_name: string; lang: 'en' | 'es' }>(sql`
    with matches as (
      select cn.oracle_id, cn.name, cn.lang, cn.is_face,
        case
          when cn.name_norm = ${qn} then 0
          when cn.name_norm like ${`${qn}%`} then 1
          when ${allWordsPrefix} then 2
          else 3
        end as rank,
        word_similarity(${qn}, cn.name_norm) as sim
      from card_names cn
      where cn.name_norm like ${`%${qn}%`} or (${allWordsPrefix}) or ${qn} <% cn.name_norm
    ),
    best as (
      select distinct on (oracle_id) oracle_id, name, lang, rank, sim
      from matches
      order by oracle_id, rank, is_face, (lang = 'en') desc, sim desc
    )
    select b.oracle_id, c.name as name_en, b.name as matched_name, b.lang
    from best b join cards c on c.oracle_id = b.oracle_id
    order by b.rank,
      case when b.rank = 3 then b.sim end desc nulls last,
      (select count(*) from printings p where p.oracle_id = b.oracle_id) desc,
      c.name
    limit ${limit}`);
  return rows.rows.map((r) => ({ oracleId: r.oracle_id, nameEn: r.name_en, matchedName: r.matched_name, lang: r.lang }));
}

export function autocomplete(db: Db, q: string, limit = 10): Promise<CardSuggestion[]> {
  return rankedCandidates(db, q, clamp(limit, 1, 50));
}

export async function searchCards(db: Db, q: string, limit = 24): Promise<CardSummary[]> {
  const found = await rankedCandidates(db, q, clamp(limit, 1, 100));
  const summaries = await cardSummaries(db, found.map((f) => f.oracleId));
  return found.map((f) => summaries.get(f.oracleId)).filter((s): s is CardSummary => !!s);
}

async function cardSummaries(db: Db, oracleIds: string[]): Promise<Map<string, CardSummary>> {
  if (oracleIds.length === 0) return new Map();
  const rows = await db.execute<{
    oracle_id: string;
    name: string;
    name_es: string | null;
    image_uri: string | null;
    min_price: number | null;
    offer_count: number;
  }>(sql`
    select c.oracle_id, c.name, c.name_es, c.image_uri, o.min_price, o.offer_count
    from cards c
    cross join lateral (
      select min(l.price_cents)::int as min_price, count(*)::int as offer_count
      from listings l join stores s on s.id = l.store_id
      where l.oracle_id = c.oracle_id and l.match_status = 'matched' and l.in_stock and s.enabled
    ) o
    where c.oracle_id = any(${textArray(oracleIds)}::uuid[])`);
  return new Map(
    rows.rows.map((r) => [
      r.oracle_id,
      {
        oracleId: r.oracle_id,
        nameEn: r.name,
        nameEs: r.name_es,
        imageUrl: r.image_uri,
        minPriceCents: r.min_price,
        offerCount: r.offer_count,
      },
    ]),
  );
}

// ───────── Carta y ofertas ─────────

type PrintingColumns = {
  scryfall_id: string;
  oracle_id: string;
  set_code: string;
  set_name: string;
  collector_number: string;
  finishes: string[];
  image_uri: string | null;
  price_eur_cents: number | null;
  price_eur_foil_cents: number | null;
};

function toPrinting(r: PrintingColumns): Printing {
  return {
    scryfallId: r.scryfall_id,
    oracleId: r.oracle_id,
    setCode: r.set_code,
    setName: r.set_name,
    collectorNumber: r.collector_number,
    finishes: r.finishes as Finish[],
    imageUrl: r.image_uri,
    priceEurCents: r.price_eur_cents,
    priceEurFoilCents: r.price_eur_foil_cents,
  };
}

export async function getCard(db: Db, oracleId: string): Promise<{ card: CardSummary; printings: Printing[] } | null> {
  if (!UUID.test(oracleId)) return null;
  const card = (await cardSummaries(db, [oracleId])).get(oracleId);
  if (!card) return null;
  const rows = await db.execute<PrintingColumns>(sql`
    select p.scryfall_id, p.oracle_id, p.set_code, st.name as set_name, p.collector_number,
           p.finishes::text[] as finishes, p.image_uri, p.price_eur_cents, p.price_eur_foil_cents
    from printings p join sets st on st.code = p.set_code
    where p.oracle_id = ${oracleId}
    order by p.released_at desc nulls last, p.set_code, p.collector_number`);
  return { card, printings: rows.rows.map(toPrinting) };
}

export async function getOffers(db: Db, oracleId: string, filters: OfferFilters = {}): Promise<Offer[]> {
  if (!UUID.test(oracleId)) return [];
  const where: SQL[] = [sql`l.oracle_id = ${oracleId}`, sql`l.match_status = 'matched'`];

  const cities = (filters.cities ?? []).filter((c) => CITIES.includes(c));
  if (cities.length > 0) where.push(sql`s.city = any(${textArray(cities)}::city[])`);
  if (filters.inStockOnly) where.push(sql`l.in_stock`);
  if (filters.finish && FINISHES.includes(filters.finish)) where.push(sql`l.finish = ${filters.finish}::finish`);
  const languages = (filters.languages ?? []).filter(Boolean);
  if (languages.length > 0) where.push(sql`l.language = any(${textArray(languages)})`);
  // El enum de la BD va de peor a mejor: ">=" es "este estado o mejor". Los null quedan fuera.
  if (filters.minCondition && CONDITIONS.includes(filters.minCondition)) {
    where.push(sql`l.condition >= ${filters.minCondition}::card_condition`);
  }
  if (filters.setCode) where.push(sql`p.set_code = ${filters.setCode}`);

  const rows = await db.execute<
    Partial<PrintingColumns> & {
      id: number;
      store_id: string;
      store_name: string;
      city: City;
      url: string;
      price_cents: number;
      in_stock: boolean;
      quantity: number | null;
      condition: Offer['condition'];
      language: string | null;
      finish: Finish;
      last_seen_at: Date;
      match_confidence: number | null;
    }
  >(sql`
    select l.id, l.store_id, s.name as store_name, s.city, l.url, l.price_cents, l.in_stock, l.quantity,
           l.condition, l.language, l.finish, l.last_seen_at, l.match_confidence,
           p.scryfall_id, p.oracle_id, p.set_code, st.name as set_name, p.collector_number,
           p.finishes::text[] as finishes, p.image_uri, p.price_eur_cents, p.price_eur_foil_cents
    from listings l
    join stores s on s.id = l.store_id and s.enabled
    left join printings p on p.scryfall_id = l.scryfall_id
    left join sets st on st.code = p.set_code
    where ${sql.join(where, sql` and `)}
    order by l.price_cents, l.id`);

  return rows.rows.map((r) => {
    const printing = r.scryfall_id ? toPrinting(r as PrintingColumns) : null;
    return {
      listingId: String(r.id),
      store: { id: r.store_id, name: r.store_name, city: r.city },
      printing,
      url: r.url,
      priceCents: r.price_cents,
      inStock: r.in_stock,
      quantity: r.quantity,
      condition: r.condition,
      language: r.language,
      finish: r.finish,
      scrapedAt: iso(r.last_seen_at)!,
      matchConfidence: r.match_confidence ?? 0,
      // Scryfall no da precio de Cardmarket fiable para etched.
      referencePriceCents:
        printing === null
          ? null
          : r.finish === 'nonfoil'
            ? printing.priceEurCents
            : r.finish === 'foil'
              ? printing.priceEurFoilCents
              : null,
    };
  });
}

// ───────── Tiendas ─────────

type StoreColumns = {
  id: string;
  name: string;
  city: City;
  address: string;
  website_url: string;
  platform: Store['platform'];
  last_success_at: Date | null;
  last_status: Store['lastStatus'];
};

const storeSelect = sql`
  select s.id, s.name, s.city, s.address, s.website_url, s.platform, s.last_success_at, r.status as last_status
  from stores s
  left join lateral (
    select status from scrape_runs r
    where r.store_id = s.id and r.status <> 'running'
    order by r.started_at desc, r.id desc limit 1
  ) r on true`;

function toStore(r: StoreColumns): Store {
  return {
    id: r.id,
    name: r.name,
    city: r.city,
    address: r.address,
    website: r.website_url,
    platform: r.platform,
    lastScrapedAt: iso(r.last_success_at),
    lastStatus: r.last_status,
  };
}

export async function listStores(db: Db): Promise<Store[]> {
  const rows = await db.execute<StoreColumns>(sql`${storeSelect} where s.enabled order by s.city, s.name`);
  return rows.rows.map(toStore);
}

export async function getStore(db: Db, id: string): Promise<StoreDetail | null> {
  const rows = await db.execute<StoreColumns & { listing_count: number; in_stock_count: number }>(sql`
    select st.*, c.listing_count, c.in_stock_count
    from (${storeSelect} where s.id = ${id} and s.enabled) st
    cross join lateral (
      select count(*)::int as listing_count, (count(*) filter (where l.in_stock))::int as in_stock_count
      from listings l where l.store_id = st.id and l.match_status = 'matched'
    ) c`);
  const r = rows.rows[0];
  return r ? { ...toStore(r), listingCount: r.listing_count, inStockCount: r.in_stock_count } : null;
}

// ───────── Panel interno ─────────

export async function listUnmatched(
  db: Db,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<{ items: UnmatchedListing[]; total: number }> {
  const [page, count] = await Promise.all([
    db.execute<{
      id: number;
      store_id: string;
      raw_title: string;
      url: string;
      price_cents: number;
      last_seen_at: Date;
      guess_oracle_id: string | null;
      guess_name: string | null;
      guess_sim: number | null;
    }>(sql`
      select u.id, u.store_id, u.raw_title, u.url, u.price_cents, u.last_seen_at,
             g.oracle_id as guess_oracle_id, g.name as guess_name, g.sim as guess_sim
      from unmatched_listings u
      left join lateral (
        select cn.oracle_id, c.name, similarity(cn.name_norm, u.title_norm)::float8 as sim
        from card_names cn join cards c on c.oracle_id = cn.oracle_id
        where cn.name_norm % u.title_norm
        order by sim desc limit 1
      ) g on true
      order by u.last_seen_at desc, u.id desc
      limit ${clamp(limit, 1, 500)} offset ${Math.max(0, Math.floor(offset))}`),
    db.execute<{ total: number }>(sql`select count(*)::int as total from unmatched_listings`),
  ]);
  return {
    total: count.rows[0]?.total ?? 0,
    items: page.rows.map((r) => ({
      listingId: String(r.id),
      storeId: r.store_id,
      rawTitle: r.raw_title,
      url: r.url,
      priceCents: r.price_cents,
      bestGuess:
        r.guess_oracle_id && r.guess_name
          ? { oracleId: r.guess_oracle_id, nameEn: r.guess_name, confidence: r.guess_sim ?? 0 }
          : null,
      scrapedAt: iso(r.last_seen_at)!,
    })),
  };
}

export async function listLatestRuns(db: Db): Promise<ScrapeRun[]> {
  const rows = await db.execute<{
    id: number;
    store_id: string;
    started_at: Date;
    finished_at: Date | null;
    status: ScrapeRun['status'];
    found: number;
    matched: number;
    unmatched: number;
    error: string | null;
  }>(sql`
    select distinct on (store_id) id, store_id, started_at, finished_at, status, found, matched, unmatched, error
    from scrape_runs
    order by store_id, started_at desc, id desc`);
  return rows.rows.map((r) => ({
    id: String(r.id),
    storeId: r.store_id,
    startedAt: iso(r.started_at)!,
    finishedAt: iso(r.finished_at),
    status: r.status,
    found: r.found,
    matched: r.matched,
    unmatched: r.unmatched,
    error: r.error,
  }));
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(Math.floor(n), min), max);
}
