import { sql, type SQL } from 'drizzle-orm';
import {
  CONDITIONS,
  FINISHES,
  type CardSuggestion,
  type CardSummary,
  type Finish,
  type ListingKind,
  type ListingSource,
  type Offer,
  type OfferFilters,
  type OfferStore,
  type Platform,
  type Printing,
  type ScrapeRun,
  type SealedOffer,
  type SealedOfferFilters,
  type SealedSummary,
  type Store,
  type StoreDetail,
  type UnmatchedListing,
} from '../../lib/data/types';
import { normalizeName } from '../../lib/normalize';
import type { Db } from '../client';
import { textArray } from '../sql';
import { sealedCategoryHints, sealedQueryTokens } from './sealed-query';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Red de seguridad: algunas tiendas ponen precios de relleno (999.999 €) en lo agotado.
 * El worker ya descarta ≤ 0 y ≥ 100.000 €; aquí no se muestran aunque se cuelen.
 */
const sanePrice = sql`l.price_cents > 0 and l.price_cents < 10000000`;

const iso = (d: Date | string | null): string | null => (d == null ? null : new Date(d).toISOString());

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(Math.floor(n), min), max);
}

/** Filtros comunes a cartas y sellado: ciudad, zona, stock e idioma. */
function storeAndStockFilters(filters: SealedOfferFilters): SQL[] {
  const where: SQL[] = [];
  const cities = (filters.cities ?? []).filter(Boolean);
  if (cities.length > 0) where.push(sql`lower(s.city) = any(${textArray(cities.map((c) => c.toLowerCase()))})`);
  if (filters.localOnly) where.push(sql`s.is_local`);
  if (filters.inStockOnly) where.push(sql`l.in_stock`);
  const languages = (filters.languages ?? []).filter(Boolean);
  if (languages.length > 0) where.push(sql`l.language = any(${textArray(languages)})`);
  return where;
}

type OfferBaseColumns = {
  id: number;
  store_id: string;
  store_name: string;
  city: string;
  is_local: boolean;
  source: ListingSource;
  url: string;
  price_cents: number;
  in_stock: boolean;
  quantity: number | null;
  language: string | null;
  last_seen_at: Date;
  match_confidence: number | null;
};

const offerBaseSelect = sql`
  l.id, l.store_id, s.name as store_name, s.city, s.is_local, l.source, l.url, l.price_cents,
  l.in_stock, l.quantity, l.language, l.last_seen_at, l.match_confidence`;

function offerBase(r: OfferBaseColumns) {
  const store: OfferStore = { id: r.store_id, name: r.store_name, city: r.city, local: r.is_local };
  return {
    listingId: String(r.id),
    store,
    source: r.source,
    url: r.url,
    priceCents: r.price_cents,
    inStock: r.in_stock,
    quantity: r.quantity,
    language: r.language,
    scrapedAt: iso(r.last_seen_at)!,
    matchConfidence: r.match_confidence ?? 0,
  };
}

/**
 * Por carta o por sellado, en tiendas activas: precio mínimo y número de ofertas con stock, y
 * cuántas hay agotadas, para distinguir "agotada ahora mismo" de "ninguna tienda la tiene".
 */
const stockStats = (target: SQL) => sql`
  select (min(l.price_cents) filter (where l.in_stock))::int as min_price,
         (count(*) filter (where l.in_stock))::int as offer_count,
         (count(*) filter (where not l.in_stock))::int as sold_out_count
  from listings l join stores s on s.id = l.store_id
  where ${target} and l.match_status = 'matched' and s.enabled and ${sanePrice}`;

/**
 * Condiciones de búsqueda por nombre, con prioridad: 0 nombre exacto, 1 empieza por q,
 * 2 todas las palabras como prefijo ("light bo"), 3 parecido por trigramas (erratas).
 * normalizeName solo deja [a-z0-9 ], así que las palabras se pueden meter en LIKE y regex.
 */
function nameRanking(column: SQL, qn: string) {
  const allWordsPrefix = sql.join(
    qn.split(' ').map((w) => sql`${column} ~ ${`(^| )${w}`}`),
    sql` and `,
  );
  return {
    rank: sql`case
      when ${column} = ${qn} then 0
      when ${column} like ${`${qn}%`} then 1
      when ${allWordsPrefix} then 2
      else 3 end`,
    sim: sql`word_similarity(${qn}, ${column})`,
    where: sql`(${column} like ${`%${qn}%`} or (${allWordsPrefix}) or ${qn} <% ${column})`,
  };
}

// ───────── Cartas: búsqueda ─────────

/**
 * Orden: el nombre exacto primero; después, los nombres que contienen lo buscado (grupos 1-2
 * de nameRanking) y, al final, los parecidos por trigramas (grupo 3). Dentro de cada bloque,
 * primero lo que alguna tienda tiene en stock: el catálogo son ~35.000 cartas y casi ninguna
 * está en una tienda, así que "bolt" no debe dar antes "Bolt Bend", que nadie vende, que
 * "Twin Bolt", que sí. Un parecido con stock ("Bold Biochemist") nunca pasa por delante de un
 * nombre que sí contiene lo buscado. A igualdad, por grupo y por número de reimpresiones.
 */
async function rankedCandidates(db: Db, q: string, limit: number): Promise<CardSuggestion[]> {
  const qn = normalizeName(q);
  if (qn.length < 2) return [];
  const { rank, sim, where } = nameRanking(sql`cn.name_norm`, qn);
  const rows = await db.execute<{ oracle_id: string; name_en: string; matched_name: string; lang: 'en' | 'es' }>(sql`
    with matches as (
      select cn.oracle_id, cn.name, cn.lang, cn.is_face, ${rank} as rank, ${sim} as sim
      from card_names cn
      where ${where}
    ),
    best as (
      select distinct on (oracle_id) oracle_id, name, lang, rank, sim
      from matches
      order by oracle_id, rank, is_face, (lang = 'en') desc, sim desc
    )
    select b.oracle_id, c.name as name_en, b.name as matched_name, b.lang
    from best b join cards c on c.oracle_id = b.oracle_id
    cross join lateral (${stockStats(sql`l.oracle_id = b.oracle_id`)}) o
    order by (b.rank = 0) desc,
      (b.rank = 3) asc,
      (o.offer_count > 0) desc,
      b.rank,
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
    sold_out_count: number;
  }>(sql`
    select c.oracle_id, c.name, c.name_es, c.image_uri, o.min_price, o.offer_count, o.sold_out_count
    from cards c
    cross join lateral (${stockStats(sql`l.oracle_id = c.oracle_id`)}) o
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
        soldOutCount: r.sold_out_count,
      },
    ]),
  );
}

// ───────── Cartas: ficha y ofertas ─────────

type PrintingColumns = {
  scryfall_id: string;
  oracle_id: string;
  set_code: string;
  set_name: string;
  set_icon_url: string | null;
  collector_number: string;
  finishes: string[];
  image_uri: string | null;
  price_eur_cents: number | null;
  price_eur_foil_cents: number | null;
};

/** Necesita `p` (printings) y `st` (sets) en el FROM. */
const printingSelect = sql`
  p.scryfall_id, p.oracle_id, p.set_code, st.name as set_name, st.icon_svg_uri as set_icon_url,
  p.collector_number, p.finishes::text[] as finishes, p.image_uri, p.price_eur_cents, p.price_eur_foil_cents`;

function toPrinting(r: PrintingColumns): Printing {
  return {
    scryfallId: r.scryfall_id,
    oracleId: r.oracle_id,
    setCode: r.set_code,
    setName: r.set_name,
    setIconUrl: r.set_icon_url,
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
    select ${printingSelect}
    from printings p join sets st on st.code = p.set_code
    where p.oracle_id = ${oracleId}
    order by p.released_at desc nulls last, p.set_code, p.collector_number`);
  return { card, printings: rows.rows.map(toPrinting) };
}

export async function getOffers(db: Db, oracleId: string, filters: OfferFilters = {}): Promise<Offer[]> {
  if (!UUID.test(oracleId)) return [];
  const where: SQL[] = [
    sql`l.oracle_id = ${oracleId}`,
    sql`l.kind = 'single'`,
    sql`l.match_status = 'matched'`,
    sanePrice,
    ...storeAndStockFilters(filters),
  ];
  if (filters.finish && FINISHES.includes(filters.finish)) where.push(sql`l.finish = ${filters.finish}::finish`);
  // El enum de la BD va de peor a mejor: ">=" es "este estado o mejor". Los null quedan fuera.
  if (filters.minCondition && CONDITIONS.includes(filters.minCondition)) {
    where.push(sql`l.condition >= ${filters.minCondition}::card_condition`);
  }
  if (filters.setCode) where.push(sql`p.set_code = ${filters.setCode}`);

  const rows = await db.execute<
    OfferBaseColumns & Partial<PrintingColumns> & { condition: Offer['condition']; finish: Finish }
  >(sql`
    select ${offerBaseSelect}, l.condition, l.finish, ${printingSelect}
    from listings l
    join stores s on s.id = l.store_id and s.enabled
    left join printings p on p.scryfall_id = l.scryfall_id
    left join sets st on st.code = p.set_code
    where ${sql.join(where, sql` and `)}
    order by l.price_cents, l.id`);

  return rows.rows.map((r) => {
    const printing = r.scryfall_id ? toPrinting(r as PrintingColumns) : null;
    return {
      ...offerBase(r),
      printing,
      condition: r.condition,
      finish: r.finish,
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

// ───────── Sellado ─────────

type SealedColumns = {
  id: string;
  name: string;
  set_code: string;
  set_name: string;
  category: string | null;
  subtype: string | null;
  released_at: string | null;
  min_price: number | null;
  offer_count: number;
  sold_out_count: number;
  image_url: string | null;
  set_icon_url: string | null;
};

/** Necesita `sp` (sealed_products), `o` (stockStats), `sti` y `img` (sealedExtras) en el FROM. */
const sealedSummarySelect = sql`
  sp.id, sp.name, sp.set_code, sp.set_name, sp.category, sp.subtype, sp.released_at::text as released_at,
  o.min_price, o.offer_count, o.sold_out_count, img.image_url, sti.icon_svg_uri as set_icon_url`;

/**
 * Símbolo de la edición y foto de la mejor oferta: primero tiendas locales, luego con stock,
 * luego la vista más recientemente. MTGJSON no trae imágenes; las fotos salen de las tiendas.
 */
const sealedExtras = sql`
  left join sets sti on sti.code = sp.set_code
  left join lateral (
    select l.image_url
    from listings l join stores s on s.id = l.store_id
    where l.sealed_product_id = sp.id and l.match_status = 'matched' and l.image_url is not null
      and s.enabled and ${sanePrice}
    order by s.is_local desc, l.in_stock desc, l.last_seen_at desc
    limit 1
  ) img on true`;

function toSealedSummary(r: SealedColumns): SealedSummary {
  return {
    sealedProductId: r.id,
    name: r.name,
    setCode: r.set_code,
    setName: r.set_name,
    category: r.category,
    subtype: r.subtype,
    releaseDate: r.released_at,
    imageUrl: r.image_url,
    setIconUrl: r.set_icon_url,
    minPriceCents: r.min_price,
    offerCount: r.offer_count,
    soldOutCount: r.sold_out_count,
  };
}

/**
 * Busca en español o en inglés ("caja bloomburrow", "sobres de coleccionista duskmourn",
 * "Dominaria Unida"). Cada producto se busca en su nombre de MTGJSON, el nombre de la edición,
 * su código y sus alias (nombre en español y de Cardmarket). Las palabras se traducen con
 * sealedQueryTokens y todas deben casar como prefijo de alguna palabra. Si no casa nada,
 * entran los nombres parecidos por trigramas (erratas en inglés).
 * Orden: nombre exacto, todas las palabras, parecidos; dentro de cada grupo, la categoría que
 * pide la búsqueda ("caja" → booster_box), lo que tiene ofertas, las cajas de distribuidor
 * (case) al final y lo más reciente primero.
 */
export async function searchSealed(db: Db, q: string, limit = 24): Promise<SealedSummary[]> {
  const qn = normalizeName(q);
  const groups = sealedQueryTokens(q);
  if (qn.length < 2 || groups.length === 0) return [];
  const hints = sealedCategoryHints(groups);
  // Sin categoría preferida no hay término: Postgres rechaza constantes en ORDER BY ("false desc").
  const wantedCategory = hints.length > 0 ? sql`(sp.category = any(${textArray(hints)})) desc,` : sql``;
  // sealedQueryTokens solo devuelve [a-z0-9]: se pueden meter en una regex.
  const allTokens = sql.join(
    groups.map((alts) => sql`(${sql.join(alts.map((a) => sql`d.doc ~ ${`(^| )${a}`}`), sql` or `)})`),
    sql` and `,
  );
  const rows = await db.execute<SealedColumns>(sql`
    with aliases as (
      select set_code, string_agg(alias_norm, ' ') as names from set_aliases group by set_code
    ),
    docs as (
      select sp.*, concat_ws(' ', sp.name_norm, st.name_norm, sp.set_code, a.names) as doc
      from sealed_products sp
      left join sets st on st.code = sp.set_code
      left join aliases a on a.set_code = sp.set_code
    ),
    hits as (
      select d.*,
        case when d.name_norm = ${qn} then 0 when ${allTokens} then 1 else 2 end as rank,
        word_similarity(${qn}, d.name_norm) as sim
      from docs d
      where ${allTokens} or ${qn} <% d.name_norm
    )
    select ${sealedSummarySelect}
    from hits sp
    cross join lateral (${stockStats(sql`l.sealed_product_id = sp.id`)}) o
    ${sealedExtras}
    order by sp.rank,
      ${wantedCategory}
      case when sp.rank = 2 then sp.sim end desc nulls last,
      (o.offer_count > 0) desc,
      (coalesce(sp.category, '') like '%case') asc,
      sp.released_at desc nulls last,
      sp.name
    limit ${clamp(limit, 1, 100)}`);
  return rows.rows.map(toSealedSummary);
}

export async function getSealedProduct(db: Db, sealedProductId: string): Promise<SealedSummary | null> {
  if (!UUID.test(sealedProductId)) return null;
  const rows = await db.execute<SealedColumns>(sql`
    select ${sealedSummarySelect}
    from sealed_products sp
    cross join lateral (${stockStats(sql`l.sealed_product_id = sp.id`)}) o
    ${sealedExtras}
    where sp.id = ${sealedProductId}`);
  return rows.rows[0] ? toSealedSummary(rows.rows[0]) : null;
}

export async function getSealedOffers(
  db: Db,
  sealedProductId: string,
  filters: SealedOfferFilters = {},
): Promise<SealedOffer[]> {
  if (!UUID.test(sealedProductId)) return [];
  const where: SQL[] = [
    sql`l.sealed_product_id = ${sealedProductId}`,
    sql`l.kind = 'sealed'`,
    sql`l.match_status = 'matched'`,
    sanePrice,
    ...storeAndStockFilters(filters),
  ];
  const rows = await db.execute<OfferBaseColumns>(sql`
    select ${offerBaseSelect}
    from listings l
    join stores s on s.id = l.store_id and s.enabled
    where ${sql.join(where, sql` and `)}
    order by l.price_cents, l.id`);
  return rows.rows.map(offerBase);
}

// ───────── Tiendas ─────────

type StoreColumns = {
  id: string;
  name: string;
  city: string;
  province: string | null;
  is_local: boolean;
  address: string | null;
  website_url: string | null;
  platform: Platform | null;
  cardmarket_user: string | null;
  last_success_at: Date | null;
  last_status: Store['lastStatus'];
};

/**
 * lastScrapedAt = lo más reciente entre la última pasada ok de la web y la fecha del último
 * stock de Cardmarket (la del propio CSV, que el worker guarda como scrapedAt de sus listados,
 * no la hora a la que se importó). lastStatus = la ejecución terminada más reciente.
 */
const storeSelect = sql`
  select s.id, s.name, s.city, s.province, s.is_local, s.address, s.website_url, s.platform,
         s.cardmarket_user, r.status as last_status,
         greatest(
           (select max(w.finished_at) from scrape_runs w
             where w.store_id = s.id and w.source = 'web' and w.status = 'ok'),
           (select max(c.last_seen_at) from listings c
             where c.store_id = s.id and c.source = 'cardmarket_csv')
         ) as last_success_at
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
    province: r.province,
    local: r.is_local,
    address: r.address,
    website: r.website_url,
    platform: r.platform,
    cardmarketUser: r.cardmarket_user,
    lastScrapedAt: iso(r.last_success_at),
    lastStatus: r.last_status,
  };
}

/** Locales primero; la web las separa por `local`. */
export async function listStores(db: Db): Promise<Store[]> {
  const rows = await db.execute<StoreColumns>(sql`${storeSelect} where s.enabled order by s.is_local desc, s.city, s.name`);
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
  if (!r) return null;
  return {
    ...toStore(r),
    listingCount: r.listing_count,
    inStockCount: r.in_stock_count,
    latestRuns: await latestRuns(db, sql`where store_id = ${id}`),
  };
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
      kind: ListingKind;
      source: ListingSource;
      raw_title: string;
      url: string;
      price_cents: number;
      last_seen_at: Date;
      guess_oracle_id: string | null;
      guess_name: string | null;
      guess_sim: number | null;
    }>(sql`
      select u.id, u.store_id, u.kind, u.source, u.raw_title, u.url, u.price_cents, u.last_seen_at,
             g.oracle_id as guess_oracle_id, g.name as guess_name, g.sim as guess_sim
      from unmatched_listings u
      left join lateral (
        select cn.oracle_id, c.name, similarity(cn.name_norm, u.title_norm)::float8 as sim
        from card_names cn join cards c on c.oracle_id = cn.oracle_id
        where u.kind = 'single' and cn.name_norm % u.title_norm
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
      kind: r.kind,
      source: r.source,
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

/** Última ejecución de cada tienda y fuente. */
async function latestRuns(db: Db, where: SQL = sql``): Promise<ScrapeRun[]> {
  const rows = await db.execute<{
    id: number;
    store_id: string;
    source: ListingSource;
    started_at: Date;
    finished_at: Date | null;
    status: ScrapeRun['status'];
    found: number;
    matched: number;
    unmatched: number;
    error: string | null;
  }>(sql`
    select distinct on (store_id, source)
      id, store_id, source, started_at, finished_at, status, found, matched, unmatched, error
    from scrape_runs
    ${where}
    order by store_id, source, started_at desc, id desc`);
  return rows.rows.map((r) => ({
    id: String(r.id),
    storeId: r.store_id,
    source: r.source,
    startedAt: iso(r.started_at)!,
    finishedAt: iso(r.finished_at),
    status: r.status,
    found: r.found,
    matched: r.matched,
    unmatched: r.unmatched,
    error: r.error,
  }));
}

export function listLatestRuns(db: Db): Promise<ScrapeRun[]> {
  return latestRuns(db);
}
