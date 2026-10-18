import { eq, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

// ───────── Enums ─────────

export const storePlatform = pgEnum('store_platform', ['shopify', 'woocommerce', 'prestashop', 'html']);
/** De dónde sale un listado: la web de la tienda o el stock que exporta de Cardmarket. */
export const listingSource = pgEnum('listing_source', ['web', 'cardmarket_csv']);
export const listingKind = pgEnum('listing_kind', ['single', 'sealed']);
// Escala de Cardmarket de peor a mejor: el orden del enum permite filtrar con condition >= 'EX'.
export const cardCondition = pgEnum('card_condition', ['PO', 'PL', 'LP', 'GD', 'EX', 'NM', 'MT']);
export const finish = pgEnum('finish', ['nonfoil', 'foil', 'etched']);
export const matchStatus = pgEnum('match_status', ['matched', 'unmatched', 'ignored']);
export const matchMethod = pgEnum('match_method', ['override', 'exact_en', 'exact_es', 'trigram', 'cardmarket_id']);
export const runStatus = pgEnum('run_status', ['running', 'ok', 'partial', 'error', 'skipped']);

// ───────── Catálogo (Scryfall) ─────────

export const sets = pgTable(
  'sets',
  {
    code: text('code').primaryKey(), // 'dmu'
    name: text('name').notNull(), // 'Dominaria United'
    nameNorm: text('name_norm').notNull(),
    setType: text('set_type').notNull(),
    releasedAt: date('released_at'),
    iconSvgUri: text('icon_svg_uri'), // símbolo de la edición (Scryfall /sets)
  },
  (t) => [index('sets_name_norm_idx').on(t.nameNorm)],
);

/** Nombres alternativos de edición que usan las tiendas: 'dominaria unida' → dmu. */
export const setAliases = pgTable('set_aliases', {
  aliasNorm: text('alias_norm').primaryKey(),
  setCode: text('set_code')
    .notNull()
    .references(() => sets.code, { onDelete: 'cascade' }),
  // 'mtgjson' (nombre en español y nombre de Cardmarket, se regeneran) o 'manual' (no se tocan)
  source: text('source').notNull().default('manual'),
});

/** La carta "conceptual" (oracle): todas sus ediciones comparten oracle_id. */
export const cards = pgTable('cards', {
  oracleId: uuid('oracle_id').primaryKey(),
  name: text('name').notNull(), // 'Lightning Bolt'
  nameEs: text('name_es'), // traducción de la impresión en español más reciente
  typeLine: text('type_line'),
  manaCost: text('mana_cost'),
  imageUri: text('image_uri'), // imagen de una impresión "normal" para listados
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

/** Nombres buscables (inglés y español, nombre completo y cada cara). */
export const cardNames = pgTable(
  'card_names',
  {
    oracleId: uuid('oracle_id')
      .notNull()
      .references(() => cards.oracleId, { onDelete: 'cascade' }),
    lang: text('lang').notNull(), // 'en' | 'es'
    name: text('name').notNull(), // 'Rayo'
    nameNorm: text('name_norm').notNull(), // normalizeName(name)
    isFace: boolean('is_face').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.oracleId, t.lang, t.nameNorm] }),
    index('card_names_name_norm_idx').on(t.nameNorm),
    index('card_names_name_norm_trgm_idx').using('gin', t.nameNorm.op('gin_trgm_ops')),
  ],
);

/** Una fila por impresión de default_cards. El idioma de la copia vendida va en listings. */
export const printings = pgTable(
  'printings',
  {
    scryfallId: uuid('scryfall_id').primaryKey(),
    oracleId: uuid('oracle_id')
      .notNull()
      .references(() => cards.oracleId, { onDelete: 'cascade' }),
    setCode: text('set_code')
      .notNull()
      .references(() => sets.code),
    collectorNumber: text('collector_number').notNull(),
    lang: text('lang').notNull(),
    rarity: text('rarity').notNull(),
    finishes: finish('finishes').array().notNull(),
    borderColor: text('border_color'),
    frame: text('frame'), // '1993', '1997', '2003', '2015', 'future'
    frameEffects: text('frame_effects').array().notNull().default(sql`'{}'::text[]`),
    promoTypes: text('promo_types').array().notNull().default(sql`'{}'::text[]`),
    fullArt: boolean('full_art').notNull().default(false),
    promo: boolean('promo').notNull().default(false),
    imageUri: text('image_uri'),
    // Id de producto de Cardmarket (idProduct): empareja exacto un stock exportado de Cardmarket.
    cardmarketId: integer('cardmarket_id'),
    // Precio de Cardmarket que publica Scryfall (prices.eur / prices.eur_foil).
    priceEurCents: integer('price_eur_cents'),
    priceEurFoilCents: integer('price_eur_foil_cents'),
    releasedAt: date('released_at'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('printings_oracle_id_idx').on(t.oracleId),
    index('printings_set_number_idx').on(t.setCode, t.collectorNumber),
    index('printings_cardmarket_id_idx').on(t.cardmarketId),
  ],
);

/** Producto sellado (sobres, cajas, bundles, mazos…) según MTGJSON. */
export const sealedProducts = pgTable(
  'sealed_products',
  {
    id: uuid('id').primaryKey(), // uuid de MTGJSON
    setCode: text('set_code').notNull(), // código de Scryfall (minúsculas); puede no estar en `sets`
    setName: text('set_name').notNull(),
    name: text('name').notNull(), // 'Foundations Play Booster Box'
    nameNorm: text('name_norm').notNull(),
    category: text('category'), // booster_box, booster_pack, bundle, deck…
    subtype: text('subtype'), // play, collector, draft, commander…
    cardCount: integer('card_count'),
    releasedAt: date('released_at'),
    cardmarketId: integer('cardmarket_id'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('sealed_products_set_category_idx').on(t.setCode, t.category, t.subtype),
    index('sealed_products_cardmarket_id_idx').on(t.cardmarketId),
    index('sealed_products_name_norm_trgm_idx').using('gin', t.nameNorm.op('gin_trgm_ops')),
  ],
);

/** Registro de importaciones de bulk data, para no repetir una descarga sin cambios. */
export const scryfallImports = pgTable(
  'scryfall_imports',
  {
    id: serial('id').primaryKey(),
    bulkType: text('bulk_type').notNull(), // 'default_cards' | 'all_cards' | 'mtgjson_setlist'
    scryfallUpdatedAt: timestamptz('scryfall_updated_at').notNull(),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
    status: text('status').notNull().default('running'), // 'running' | 'ok' | 'error'
    rows: integer('rows'),
    error: text('error'),
  },
  (t) => [index('scryfall_imports_type_started_idx').on(t.bulkType, t.startedAt.desc())],
);

// ───────── Tiendas ─────────

/** Sincronizada desde stores.config.ts: el fichero es la fuente de verdad. */
export const stores = pgTable('stores', {
  id: text('id').primaryKey(), // slug
  name: text('name').notNull(),
  city: text('city').notNull(), // nombre para mostrar: 'Barcelona', "L'Hospitalet de Llobregat", 'Madrid'…
  province: text('province'),
  // Tienda física en Barcelona o L'Hospitalet; el resto son tiendas online de otras zonas.
  isLocal: boolean('is_local').notNull().default(true),
  address: text('address'), // null en tiendas solo online
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  websiteUrl: text('website_url'), // null si la tienda solo nos manda su stock de Cardmarket
  platform: storePlatform('platform'), // null = sin web rastreable
  cardmarketUser: text('cardmarket_user'), // perfil de vendedor: enlaces a las ofertas del CSV
  enabled: boolean('enabled').notNull().default(true),
  scrapingAllowed: boolean('scraping_allowed'), // null = robots.txt/términos sin revisar
  robotsCheckedAt: timestamptz('robots_checked_at'),
  lastSuccessAt: timestamptz('last_success_at'), // "actualizado hace X" en la web
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const scrapeRuns = pgTable(
  'scrape_runs',
  {
    id: serial('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    source: listingSource('source').notNull().default('web'),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    finishedAt: timestamptz('finished_at'),
    status: runStatus('status').notNull().default('running'),
    requests: integer('requests').notNull().default(0),
    found: integer('found').notNull().default(0),
    matched: integer('matched').notNull().default(0),
    unmatched: integer('unmatched').notNull().default(0),
    error: text('error'),
  },
  (t) => [index('scrape_runs_store_started_idx').on(t.storeId, t.startedAt.desc())],
);

export type MatchCandidate = { oracleId: string; nameEn: string; confidence: number };

export const listings = pgTable(
  'listings',
  {
    id: serial('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    source: listingSource('source').notNull().default('web'),
    kind: listingKind('kind').notNull().default('single'),
    externalId: text('external_id').notNull(), // id de variante Shopify/Woo, idArticle de Cardmarket o hash de la URL
    rawTitle: text('raw_title').notNull(),
    titleNorm: text('title_norm').notNull(),
    url: text('url').notNull(),
    priceCents: integer('price_cents').notNull(),
    currency: char('currency', { length: 3 }).notNull().default('EUR'),
    inStock: boolean('in_stock').notNull(),
    quantity: integer('quantity'),
    // Atributos extraídos del título o de la variante
    condition: cardCondition('condition'), // null = la tienda no lo indica
    language: text('language'), // códigos de Scryfall: 'es', 'en', 'ja'…
    finish: finish('finish').notNull().default('nonfoil'),
    setHint: text('set_hint'),
    cardmarketId: integer('cardmarket_id'), // idProduct del stock de Cardmarket: emparejamiento exacto
    collectorNumber: text('collector_number'), // cuando la tienda lo da en un campo estructurado
    imageUrl: text('image_url'), // foto del producto en la web de la tienda (https)
    // Emparejamiento con Scryfall
    matchStatus: matchStatus('match_status').notNull().default('unmatched'),
    matchMethod: matchMethod('match_method'),
    matchConfidence: real('match_confidence'),
    oracleId: uuid('oracle_id').references(() => cards.oracleId, { onDelete: 'set null' }),
    scryfallId: uuid('scryfall_id').references(() => printings.scryfallId, { onDelete: 'set null' }), // null = edición sin identificar
    sealedProductId: uuid('sealed_product_id').references(() => sealedProducts.id, { onDelete: 'set null' }),
    candidates: jsonb('candidates').$type<MatchCandidate[]>(), // sugerencias para el panel
    // Ciclo de vida
    firstSeenAt: timestamptz('first_seen_at').notNull().defaultNow(),
    lastSeenAt: timestamptz('last_seen_at').notNull(),
    lastRunId: integer('last_run_id').references(() => scrapeRuns.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('listings_store_source_external_idx').on(t.storeId, t.source, t.externalId),
    index('listings_oracle_matched_idx').on(t.oracleId).where(sql`match_status = 'matched'`),
    index('listings_sealed_matched_idx').on(t.sealedProductId).where(sql`match_status = 'matched'`),
    index('listings_store_status_idx').on(t.storeId, t.matchStatus),
    check('listings_price_nonnegative', sql`price_cents >= 0`),
    check('listings_confidence_range', sql`match_confidence is null or match_confidence between 0 and 1`),
    check(
      'listings_matched_has_target',
      sql`match_status <> 'matched'
        or (kind = 'single' and oracle_id is not null)
        or (kind = 'sealed' and sealed_product_id is not null)`,
    ),
  ],
);

/** Correcciones manuales del panel. Sobreviven a cada scraping porque van por título, no por id. */
export const matchOverrides = pgTable(
  'match_overrides',
  {
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    titleNorm: text('title_norm').notNull(),
    oracleId: uuid('oracle_id').references(() => cards.oracleId, { onDelete: 'cascade' }),
    scryfallId: uuid('scryfall_id').references(() => printings.scryfallId, { onDelete: 'set null' }),
    sealedProductId: uuid('sealed_product_id').references(() => sealedProducts.id, { onDelete: 'cascade' }),
    ignore: boolean('ignore').notNull().default(false), // no es ni carta ni sellado de Magic: fundas, otros juegos…
    note: text('note'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.titleNorm] }),
    check('match_overrides_has_target', sql`ignore or oracle_id is not null or sealed_product_id is not null`),
  ],
);

/** Listados pendientes de revisión: no se muestran en los resultados. */
export const unmatchedListings = pgView('unmatched_listings').as((qb) =>
  qb
    .select({
      id: listings.id,
      storeId: listings.storeId,
      source: listings.source,
      kind: listings.kind,
      rawTitle: listings.rawTitle,
      titleNorm: listings.titleNorm,
      url: listings.url,
      priceCents: listings.priceCents,
      inStock: listings.inStock,
      setHint: listings.setHint,
      candidates: listings.candidates,
      firstSeenAt: listings.firstSeenAt,
      lastSeenAt: listings.lastSeenAt,
      lastRunId: listings.lastRunId,
    })
    .from(listings)
    .where(eq(listings.matchStatus, 'unmatched')),
);
