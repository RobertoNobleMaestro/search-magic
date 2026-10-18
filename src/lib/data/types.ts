/**
 * Contrato de datos de search-magic.
 *
 * La web y el worker solo hablan con la base de datos a través de `Repository`.
 * Hay dos implementaciones, que se eligen con DATA_SOURCE (ver ./index.ts):
 *   - mock.ts        datos de ejemplo en memoria, para desarrollar sin base de datos
 *   - repository.ts  Neon/PostgreSQL (lo mantiene la parte de base de datos, src/db/)
 *
 * Convenciones: precios en céntimos de euro enteros, fechas en ISO 8601 (UTC) e
 * idiomas con los códigos de Scryfall ("en", "es", "ja"…).
 */

export type City = "barcelona" | "hospitalet";

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

export type MatchMethod = "override" | "exact_en" | "exact_es" | "trigram";

export interface MatchResult {
  oracleId: string;
  /** null cuando se identifica la carta pero no la impresión concreta */
  scryfallId: string | null;
  /** 0..1 */
  confidence: number;
  method: MatchMethod;
}

// ---------------------------------------------------------------------------
// Catálogo
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
}

// ---------------------------------------------------------------------------
// Tiendas
// ---------------------------------------------------------------------------

/** Datos de una tienda que vienen de stores.config.ts */
export interface StoreInfo {
  /** slug estable, p. ej. "cofre-mana-sants" */
  id: string;
  name: string;
  city: City;
  address: string;
  website: string;
  platform: Platform;
}

export interface Store extends StoreInfo {
  /** finished_at de la última ejecución "ok" */
  lastScrapedAt: string | null;
  lastStatus: ScrapeStatus | null;
}

export interface StoreDetail extends Store {
  listingCount: number;
  inStockCount: number;
}

// ---------------------------------------------------------------------------
// Ofertas
// ---------------------------------------------------------------------------

export interface Offer {
  listingId: string;
  store: Pick<Store, "id" | "name" | "city">;
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
  inStockOnly?: boolean;
  finish?: Finish;
  languages?: Lang[];
  /** este estado o mejor; con este filtro se excluyen los listados de estado desconocido */
  minCondition?: Condition;
  setCode?: string;
}

// ---------------------------------------------------------------------------
// Panel interno
// ---------------------------------------------------------------------------

export interface UnmatchedListing {
  listingId: string;
  storeId: string;
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
  startedAt: string;
  finishedAt: string | null;
  status: "running" | ScrapeStatus;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

/** Listado tal como lo devuelve un adaptador de tienda, antes de emparejar */
export interface NormalizedListing {
  storeId: string;
  /** id estable dentro de la tienda (id de variante Shopify, id de producto Woo, URL…) */
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
  scrapedAt: string;
}

export interface MatchedListing extends NormalizedListing {
  /** null = sin emparejar (aparece en la vista unmatched_listings) */
  match: MatchResult | null;
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Búsquedas de catálogo que necesita el emparejador */
export interface CatalogLookup {
  /** Precarga en memoria nombres exactos y ediciones antes de emparejar un lote grande. */
  loadCatalog?(): Promise<void>;
  findByExactName(nameNorm: string, lang: "en" | "es"): Promise<Array<{ oracleId: string; name: string }>>;
  findByTrigram(
    nameNorm: string,
    minSimilarity: number,
    limit: number,
  ): Promise<Array<{ oracleId: string; name: string; lang: "en" | "es"; similarity: number }>>;
  /** Código de edición a partir del texto de la tienda ("M11", "Magic 2011"…), o null */
  resolveSet(hint: string): Promise<string | null>;
  findPrintings(oracleId: string, setCode: string): Promise<PrintingCandidate[]>;
  /** Corrección manual; titleNorm = normalizeTitle(rawTitle) de src/lib/matching */
  getOverride(storeId: string, titleNorm: string): Promise<MatchResult | null>;
}

export interface Repository extends CatalogLookup {
  // Web
  autocomplete(q: string, limit?: number): Promise<CardSuggestion[]>;
  searchCards(q: string, limit?: number): Promise<CardSummary[]>;
  getCard(oracleId: string): Promise<{ card: CardSummary; printings: Printing[] } | null>;
  /** Ordenadas por precio ascendente */
  getOffers(oracleId: string, filters?: OfferFilters): Promise<Offer[]>;
  listStores(): Promise<Store[]>;
  getStore(id: string): Promise<StoreDetail | null>;

  // Panel interno
  listUnmatched(opts?: { limit?: number; offset?: number }): Promise<{ items: UnmatchedListing[]; total: number }>;
  /** Última ejecución de cada tienda */
  listLatestRuns(): Promise<ScrapeRun[]>;

  // Worker
  upsertStores(stores: StoreInfo[]): Promise<void>;
  startRun(storeId: string): Promise<string>;
  /** Se puede llamar varias veces por ejecución (por lotes). Upsert por store_id + external_id. */
  saveListings(runId: string, items: MatchedListing[]): Promise<void>;
  /** Si status = "ok", marca sin stock los listados de la tienda que no han aparecido en esta ejecución. */
  finishRun(
    runId: string,
    result: { status: ScrapeStatus; stats: ScrapeRunStats; error?: string },
  ): Promise<void>;
}
