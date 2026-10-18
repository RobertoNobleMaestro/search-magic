/**
 * Contrato de datos de search-magic.
 *
 * La web y el worker solo hablan con la base de datos a través de `Repository`.
 * Hay dos implementaciones, que se eligen con DATA_SOURCE (ver ./index.ts):
 *   - mock.ts        datos de ejemplo en memoria, para desarrollar sin base de datos
 *   - repository.ts  Neon/PostgreSQL (lo mantiene la parte de base de datos, src/db/)
 *
 * Qué se compara:
 *   - cartas sueltas ("single"): catálogo de Scryfall (oracleId = carta, scryfallId = impresión)
 *   - producto sellado ("sealed"): catálogo de MTGJSON (sobres, cajas, mazos…)
 * De dónde salen las ofertas ("source"):
 *   - "web": la web de la tienda (scraping responsable)
 *   - "cardmarket_csv": el stock que la tienda exporta desde Cardmarket y nos comparte
 *
 * Convenciones: precios en céntimos de euro enteros, fechas en ISO 8601 (UTC) e
 * idiomas con los códigos de Scryfall ("en", "es", "ja"…).
 */

/** Nombre de la ciudad tal como se muestra: "Barcelona", "L'Hospitalet de Llobregat", "Madrid"… */
export type City = string;

/** Escala de Cardmarket, de mejor a peor. El orden se usa en el filtro de estado mínimo. */
export const CONDITIONS = ["MT", "NM", "EX", "GD", "LP", "PL", "PO"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const FINISHES = ["nonfoil", "foil", "etched"] as const;
/** En un listado, ausente = "nonfoil". */
export type Finish = (typeof FINISHES)[number];

/** Código de idioma de Scryfall: en, es, fr, de, it, pt, ja, ko, ru, zhs, zht… */
export type Lang = string;

export type Platform = "shopify" | "woocommerce" | "prestashop" | "html";

/** "partial": fallaron algunas páginas; no se marcan como agotados los listados que faltan. */
export type ScrapeStatus = "ok" | "partial" | "error" | "skipped";

/** De dónde sale un listado */
export const LISTING_SOURCES = ["web", "cardmarket_csv"] as const;
export type ListingSource = (typeof LISTING_SOURCES)[number];

export type ListingKind = "single" | "sealed";

export type MatchMethod = "override" | "cardmarket_id" | "exact_en" | "exact_es" | "trigram";

/** Emparejamiento con una carta suelta */
export interface MatchResult {
  kind?: "single";
  oracleId: string;
  /** null cuando se identifica la carta pero no la impresión concreta */
  scryfallId: string | null;
  /** 0..1 */
  confidence: number;
  method: MatchMethod;
}

/** Emparejamiento con un producto sellado */
export interface SealedMatchResult {
  kind: "sealed";
  sealedProductId: string;
  /** 0..1 */
  confidence: number;
  method: MatchMethod;
}

export type AnyMatchResult = MatchResult | SealedMatchResult;

// ---------------------------------------------------------------------------
// Catálogo de cartas
// ---------------------------------------------------------------------------

export interface CardSuggestion {
  oracleId: string;
  nameEn: string;
  /** nombre que ha coincidido con la búsqueda (puede ser el español: "Relámpago") */
  matchedName: string;
  lang: "en" | "es";
}

export interface CardSummary {
  oracleId: string;
  nameEn: string;
  /** nombre en español de la impresión más reciente, si existe */
  nameEs: string | null;
  imageUrl: string | null;
  /** precio más bajo entre las ofertas con stock; null si ninguna tienda la tiene */
  minPriceCents: number | null;
  /** número de ofertas con stock */
  offerCount: number;
}

export interface Printing {
  scryfallId: string;
  oracleId: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  finishes: Finish[];
  imageUrl: string | null;
  /** Cardmarket vía Scryfall (prices.eur) */
  priceEurCents: number | null;
  /** Cardmarket vía Scryfall (prices.eur_foil) */
  priceEurFoilCents: number | null;
}

/** Candidato para elegir la impresión concreta dentro de una edición (borderless, showcase…) */
export interface PrintingCandidate {
  scryfallId: string;
  collectorNumber: string;
  finishes: Finish[];
  borderColor: string;
  frameEffects: string[];
  promoTypes: string[];
  fullArt: boolean;
  promo: boolean;
  /** marco de Scryfall ("1993", "1997", "2003", "2015", "future"); opcional hasta que la BD lo importe */
  frame?: string;
}

// ---------------------------------------------------------------------------
// Catálogo de producto sellado (MTGJSON)
// ---------------------------------------------------------------------------

/**
 * category/subtype son los de MTGJSON, p. ej. booster_pack/draft, booster_box/play,
 * bundle/default, deck/commander. null si MTGJSON no los da.
 */
export interface SealedCandidate {
  sealedProductId: string;
  setCode: string;
  name: string;
  category: string | null;
  subtype: string | null;
}

export interface SealedSummary {
  sealedProductId: string;
  name: string;
  setCode: string;
  setName: string;
  category: string | null;
  subtype: string | null;
  releaseDate: string | null;
  /** de momento siempre null: MTGJSON no trae imágenes */
  imageUrl: string | null;
  minPriceCents: number | null;
  offerCount: number;
}

// ---------------------------------------------------------------------------
// Tiendas
// ---------------------------------------------------------------------------

/** Datos de una tienda que vienen de stores.config.ts */
export interface StoreInfo {
  /** slug estable, p. ej. "cofre-mana-gracia" */
  id: string;
  name: string;
  city: City;
  province: string | null;
  /** tienda física en Barcelona o L'Hospitalet, el foco de search-magic */
  local: boolean;
  /** null en tiendas solo online */
  address: string | null;
  website: string | null;
  /** plataforma de la web; null si no tiene web rastreable */
  platform: Platform | null;
  /** usuario de Cardmarket: enlace a su perfil y a las ofertas de su CSV */
  cardmarketUser: string | null;
}

export interface Store extends StoreInfo {
  /** finished_at de la última ejecución "ok" de cualquier fuente */
  lastScrapedAt: string | null;
  /** estado de la ejecución más reciente */
  lastStatus: ScrapeStatus | null;
}

export interface StoreDetail extends Store {
  listingCount: number;
  inStockCount: number;
  /** última ejecución de cada fuente */
  latestRuns: ScrapeRun[];
}

// ---------------------------------------------------------------------------
// Ofertas
// ---------------------------------------------------------------------------

export type OfferStore = Pick<Store, "id" | "name" | "city" | "local">;

export interface Offer {
  listingId: string;
  store: OfferStore;
  source: ListingSource;
  /** null si no se ha identificado la impresión */
  printing: Printing | null;
  url: string;
  priceCents: number;
  inStock: boolean;
  quantity: number | null;
  /** null = estado desconocido */
  condition: Condition | null;
  language: Lang | null;
  finish: Finish;
  scrapedAt: string;
  matchConfidence: number;
  /** nonfoil → prices.eur, foil → prices.eur_foil, etched → null */
  referencePriceCents: number | null;
}

export interface OfferFilters {
  cities?: City[];
  /** solo tiendas físicas de Barcelona y L'Hospitalet */
  localOnly?: boolean;
  inStockOnly?: boolean;
  finish?: Finish;
  languages?: Lang[];
  /** este estado o mejor; con este filtro se excluyen los listados de estado desconocido */
  minCondition?: Condition;
  setCode?: string;
}

export interface SealedOffer {
  listingId: string;
  store: OfferStore;
  source: ListingSource;
  url: string;
  priceCents: number;
  inStock: boolean;
  quantity: number | null;
  language: Lang | null;
  scrapedAt: string;
  matchConfidence: number;
}

export interface SealedOfferFilters {
  cities?: City[];
  localOnly?: boolean;
  inStockOnly?: boolean;
  languages?: Lang[];
}

// ---------------------------------------------------------------------------
// Panel interno
// ---------------------------------------------------------------------------

export interface UnmatchedListing {
  listingId: string;
  storeId: string;
  kind: ListingKind;
  source: ListingSource;
  rawTitle: string;
  url: string;
  priceCents: number;
  bestGuess: { oracleId: string; nameEn: string; confidence: number } | null;
  scrapedAt: string;
}

export interface ScrapeRunStats {
  found: number;
  matched: number;
  unmatched: number;
}

export interface ScrapeRun extends ScrapeRunStats {
  id: string;
  storeId: string;
  source: ListingSource;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | ScrapeStatus;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

/** Listado tal como lo devuelve un adaptador, antes de emparejar */
export interface NormalizedListing {
  storeId: string;
  /** id estable dentro de la tienda y la fuente (id de variante Shopify, idArticle de Cardmarket, URL…) */
  externalId: string;
  rawTitle: string;
  url: string;
  priceCents: number;
  currency: "EUR";
  inStock: boolean;
  quantity?: number;
  condition?: Condition;
  language?: Lang;
  /** ausente = "nonfoil" */
  finish?: Finish;
  /** edición tal como la escribe la tienda ("M11", "Magic 2011"…); se guarda en listings.set_hint */
  setHint?: string;
  /** número de colección cuando la tienda lo da en un campo estructurado (SKU, variante, JSON-LD) */
  collectorNumber?: string;
  /** pista del adaptador; ausente = lo decide el emparejador (por defecto "single") */
  kind?: ListingKind;
  /** idProduct de Cardmarket (CSV de stock): emparejado exacto, sin heurística */
  cardmarketId?: number;
  scrapedAt: string;
}

export interface MatchedListing extends NormalizedListing {
  /** null = sin emparejar (aparece en la vista unmatched_listings) */
  match: AnyMatchResult | null;
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Búsquedas de catálogo que necesita el emparejador. loadCatalog precarga todo salvo los trigramas. */
export interface CatalogLookup {
  /** Precarga en memoria nombres exactos, ediciones, ids de Cardmarket y sellado antes de un lote grande. */
  loadCatalog?(): Promise<void>;

  // Cartas
  findByExactName(nameNorm: string, lang: "en" | "es"): Promise<Array<{ oracleId: string; name: string }>>;
  findByTrigram(
    nameNorm: string,
    minSimilarity: number,
    limit: number,
  ): Promise<Array<{ oracleId: string; name: string; lang: "en" | "es"; similarity: number }>>;
  /** Código de edición a partir del texto de la tienda ("M11", "Magic 2011", "Dominaria Unida"…), o null */
  resolveSet(hint: string): Promise<string | null>;
  findPrintings(oracleId: string, setCode: string): Promise<PrintingCandidate[]>;
  findPrintingByCardmarketId(cardmarketId: number): Promise<{ oracleId: string; scryfallId: string } | null>;

  // Sellado
  findSealedByCardmarketId(cardmarketId: number): Promise<SealedCandidate | null>;
  findSealedProducts(setCode: string, opts?: { category?: string; subtype?: string }): Promise<SealedCandidate[]>;
  findSealedByTrigram(
    nameNorm: string,
    minSimilarity: number,
    limit: number,
  ): Promise<Array<SealedCandidate & { similarity: number }>>;

  /** Corrección manual; titleNorm = normalizeTitle(rawTitle) de src/lib/matching */
  getOverride(storeId: string, titleNorm: string): Promise<AnyMatchResult | null>;
}

export interface Repository extends CatalogLookup {
  // Web: cartas
  autocomplete(q: string, limit?: number): Promise<CardSuggestion[]>;
  searchCards(q: string, limit?: number): Promise<CardSummary[]>;
  getCard(oracleId: string): Promise<{ card: CardSummary; printings: Printing[] } | null>;
  /** Ordenadas por precio ascendente */
  getOffers(oracleId: string, filters?: OfferFilters): Promise<Offer[]>;

  // Web: sellado
  searchSealed(q: string, limit?: number): Promise<SealedSummary[]>;
  getSealedProduct(sealedProductId: string): Promise<SealedSummary | null>;
  /** Ordenadas por precio ascendente */
  getSealedOffers(sealedProductId: string, filters?: SealedOfferFilters): Promise<SealedOffer[]>;

  // Web: tiendas
  listStores(): Promise<Store[]>;
  getStore(id: string): Promise<StoreDetail | null>;

  // Panel interno
  listUnmatched(opts?: { limit?: number; offset?: number }): Promise<{ items: UnmatchedListing[]; total: number }>;
  /** Última ejecución de cada tienda y fuente */
  listLatestRuns(): Promise<ScrapeRun[]>;

  // Worker
  /** La configuración manda: las tiendas que no se pasen quedan desactivadas. */
  upsertStores(stores: StoreInfo[]): Promise<void>;
  startRun(storeId: string, source?: ListingSource): Promise<string>;
  /** Se puede llamar varias veces por ejecución (por lotes). Upsert por store_id + source + external_id. */
  saveListings(runId: string, items: MatchedListing[]): Promise<void>;
  /** Si status = "ok", marca sin stock los listados de esa tienda y esa fuente que no han aparecido. */
  finishRun(
    runId: string,
    result: { status: ScrapeStatus; stats: ScrapeRunStats; error?: string },
  ): Promise<void>;
}
