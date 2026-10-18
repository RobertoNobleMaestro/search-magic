import cardFixtureRaw from "./fixtures/scryfall-sample.json";
import sealedFixtureRaw from "./fixtures/sealed-sample.json";
import { normalizeName } from "@/lib/normalize";
import { trigramSimilarity } from "@/lib/trigram";
import {
  CONDITIONS,
  FINISHES,
  type CardSuggestion,
  type CardSummary,
  type Condition,
  type Finish,
  type Lang,
  type ListingSource,
  type MatchedListing,
  type Offer,
  type OfferFilters,
  type OfferStore,
  type Printing,
  type PrintingCandidate,
  type Repository,
  type ScrapeRun,
  type ScrapeRunStats,
  type ScrapeStatus,
  type SealedCandidate,
  type SealedOffer,
  type SealedOfferFilters,
  type SealedSummary,
  type Store,
  type StoreDetail,
  type StoreInfo,
  type UnmatchedListing,
} from "./types";

/**
 * Datos de ejemplo en memoria (DATA_SOURCE=mock).
 *
 * Las cartas, impresiones y precios de referencia son reales (muestra de Scryfall en
 * fixtures/scryfall-sample.json), igual que el producto sellado (muestra de MTGJSON en
 * fixtures/sealed-sample.json). Las tiendas, sus direcciones y sus ofertas son INVENTADAS y
 * se generan de forma determinista para que la web se vea igual en cada arranque.
 *
 * Imitan la situación real: las tiendas físicas de Barcelona y L'Hospitalet venden sellado en
 * su web y las cartas sueltas por Cardmarket (stock compartido en CSV); las tiendas online del
 * resto de España venden sueltas y sellado en su web.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface FixturePrinting {
  scryfallId: string;
  cardmarketId?: number | null;
  setCode: string;
  setName: string;
  collectorNumber: string;
  releasedAt: string;
  finishes: string[];
  imageUrl: string | null;
  priceEurCents: number | null;
  priceEurFoilCents: number | null;
  borderColor: string;
  frameEffects: string[];
  promoTypes: string[];
  fullArt: boolean;
  promo: boolean;
}

interface FixtureCard {
  oracleId: string;
  nameEn: string;
  nameEs: string | null;
  namesEs?: string[];
  printings: FixturePrinting[];
}

interface CardFixture {
  sets: Array<{ code: string; name: string; releasedAt: string }>;
  cards: FixtureCard[];
}

interface SealedFixture {
  sets: Array<{ code: string; name: string; nameEs: string | null; releaseDate: string | null; cardmarketName: string | null }>;
  products: Array<{
    sealedProductId: string;
    setCode: string;
    name: string;
    category: string | null;
    subtype: string | null;
    releaseDate: string | null;
    cardmarketId: number | null;
  }>;
}

interface CatalogCard {
  oracleId: string;
  nameEn: string;
  /** de la impresión más reciente a la más antigua */
  namesEs: string[];
  /** de la más reciente a la más antigua */
  printings: Printing[];
  raw: FixturePrinting[];
}

interface NameEntry {
  oracleId: string;
  name: string;
  norm: string;
  lang: "en" | "es";
}

const cardFixture = cardFixtureRaw as unknown as CardFixture;
const sealedFixture = sealedFixtureRaw as unknown as SealedFixture;

function toFinishes(values: string[]): Finish[] {
  return values.filter((v): v is Finish => (FINISHES as readonly string[]).includes(v));
}

const CARDS: CatalogCard[] = cardFixture.cards.map((c) => {
  const raw = [...c.printings].sort((a, b) => b.releasedAt.localeCompare(a.releasedAt));
  return {
    oracleId: c.oracleId,
    nameEn: c.nameEn,
    namesEs: c.namesEs ?? (c.nameEs ? [c.nameEs] : []),
    raw,
    printings: raw.map((p) => ({
      scryfallId: p.scryfallId,
      oracleId: c.oracleId,
      setCode: p.setCode,
      setName: p.setName,
      collectorNumber: p.collectorNumber,
      finishes: toFinishes(p.finishes),
      imageUrl: p.imageUrl,
      priceEurCents: p.priceEurCents,
      priceEurFoilCents: p.priceEurFoilCents,
    })),
  };
});

const CARD_BY_ID = new Map(CARDS.map((c) => [c.oracleId, c]));

const PRINTING_BY_CARDMARKET_ID = new Map<number, { oracleId: string; scryfallId: string }>();
for (const card of CARDS) {
  for (const p of card.raw) {
    if (p.cardmarketId != null) PRINTING_BY_CARDMARKET_ID.set(p.cardmarketId, { oracleId: card.oracleId, scryfallId: p.scryfallId });
  }
}

/** En cartas de varias caras las tiendas suelen escribir solo la primera cara. */
function withFrontFace(names: string[]): string[] {
  const out = [...names];
  for (const n of names) if (n.includes(" // ")) out.push(n.split(" // ")[0] ?? n);
  return out;
}

const NAMES: NameEntry[] = CARDS.flatMap((c) => [
  ...withFrontFace([c.nameEn]).map((name) => ({ oracleId: c.oracleId, name, norm: normalizeName(name), lang: "en" as const })),
  ...withFrontFace(c.namesEs).map((name) => ({ oracleId: c.oracleId, name, norm: normalizeName(name), lang: "es" as const })),
]);

/** Ediciones de ambos catálogos con todos sus nombres conocidos (código, inglés, español, Cardmarket) */
const SET_ALIASES = new Map<string, string>();
for (const s of cardFixture.sets) {
  SET_ALIASES.set(s.code.toLowerCase(), s.code);
  SET_ALIASES.set(normalizeName(s.name), s.code);
}
for (const s of sealedFixture.sets) {
  for (const alias of [s.code, s.name, s.nameEs, s.cardmarketName]) if (alias) SET_ALIASES.set(normalizeName(alias), s.code);
}

const SEALED_SET_BY_CODE = new Map(sealedFixture.sets.map((s) => [s.code, s]));

interface CatalogSealed extends SealedCandidate {
  norm: string;
  releaseDate: string | null;
  cardmarketId: number | null;
  /** nombre del producto + nombres de la edición, para la búsqueda */
  searchText: string;
}

const SEALED: CatalogSealed[] = sealedFixture.products.map((p) => {
  const set = SEALED_SET_BY_CODE.get(p.setCode);
  return {
    sealedProductId: p.sealedProductId,
    setCode: p.setCode,
    name: p.name,
    category: p.category,
    subtype: p.subtype,
    releaseDate: p.releaseDate,
    cardmarketId: p.cardmarketId,
    norm: normalizeName(p.name),
    searchText: normalizeName([p.name, set?.name, set?.nameEs].filter(Boolean).join(" ")),
  };
});

const SEALED_BY_ID = new Map(SEALED.map((p) => [p.sealedProductId, p]));

// ---------------------------------------------------------------------------
// Aleatoriedad determinista
// ---------------------------------------------------------------------------

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 sembrado con un texto */
function seeded(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weighted<T>(rand: () => number, options: ReadonlyArray<readonly [T, number]>): T {
  const total = options.reduce((sum, [, w]) => sum + w, 0);
  let x = rand() * total;
  for (const [value, w] of options) {
    x -= w;
    if (x <= 0) return value;
  }
  return options[options.length - 1]![0];
}

// ---------------------------------------------------------------------------
// Tiendas inventadas
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
const NOW = Date.now();
const hoursAgo = (h: number) => new Date(NOW - h * HOUR).toISOString();

const STORES: StoreInfo[] = [
  {
    id: "cofre-mana-gracia",
    name: "El Cofre del Maná",
    city: "Barcelona",
    province: "Barcelona",
    local: true,
    address: "Carrer de Verdi, 42, 08012 Barcelona",
    website: "https://cofre-mana.example.com",
    platform: "shopify",
    cardmarketUser: "CofreDelMana",
  },
  {
    id: "bazar-arcano-eixample",
    name: "Bazar Arcano",
    city: "Barcelona",
    province: "Barcelona",
    local: true,
    address: "Carrer del Consell de Cent, 215, 08011 Barcelona",
    website: "https://bazar-arcano.example.com",
    platform: "woocommerce",
    cardmarketUser: "BazarArcano",
  },
  {
    id: "tierras-basicas-sants",
    name: "Tierras Básicas",
    city: "Barcelona",
    province: "Barcelona",
    local: true,
    address: "Carrer de Sants, 118, 08028 Barcelona",
    website: "https://tierras-basicas.example.com",
    platform: "prestashop",
    cardmarketUser: null,
  },
  {
    id: "mesa-duelo-poblenou",
    name: "La Mesa del Duelo",
    city: "Barcelona",
    province: "Barcelona",
    local: true,
    address: "Rambla del Poblenou, 77, 08005 Barcelona",
    website: "https://mesa-duelo.example.com",
    platform: "html",
    cardmarketUser: "MesaDelDuelo",
  },
  {
    id: "dados-dragones-lh",
    name: "Dados y Dragones",
    city: "L'Hospitalet de Llobregat",
    province: "Barcelona",
    local: true,
    address: "Rambla de la Marina, 150, 08907 L'Hospitalet de Llobregat",
    website: "https://dados-dragones.example.com",
    platform: "shopify",
    cardmarketUser: "DadosYDragones",
  },
  {
    id: "rincon-draft-collblanc",
    name: "Rincón del Draft",
    city: "L'Hospitalet de Llobregat",
    province: "Barcelona",
    local: true,
    address: "Carrer de Collblanc, 63, 08904 L'Hospitalet de Llobregat",
    website: null,
    platform: null,
    cardmarketUser: "RinconDelDraft",
  },
  {
    id: "arcano-cards-madrid",
    name: "Arcano Cards",
    city: "Madrid",
    province: "Madrid",
    local: false,
    address: null,
    website: "https://arcano-cards.example.com",
    platform: "shopify",
    cardmarketUser: null,
  },
  {
    id: "duelistas-turia-valencia",
    name: "Duelistas del Turia",
    city: "Valencia",
    province: "Valencia",
    local: false,
    address: null,
    website: "https://duelistas-turia.example.com",
    platform: "woocommerce",
    cardmarketUser: null,
  },
  {
    id: "cartas-del-sur-sevilla",
    name: "Cartas del Sur",
    city: "Sevilla",
    province: "Sevilla",
    local: false,
    address: null,
    website: "https://cartas-del-sur.example.com",
    platform: "prestashop",
    cardmarketUser: null,
  },
];

const STORE_BY_ID = new Map(STORES.map((s) => [s.id, s]));

/** De dónde salen las cartas sueltas de cada tienda (null = no vende sueltas) */
function singlesSource(store: StoreInfo): ListingSource | null {
  if (store.local) return store.cardmarketUser ? "cardmarket_csv" : null;
  return store.website ? "web" : null;
}

/** Las tiendas con web venden sellado en ella */
function sealedSource(store: StoreInfo): ListingSource | null {
  return store.website ? "web" : null;
}

function storeSources(store: StoreInfo): ListingSource[] {
  return [...new Set([sealedSource(store), singlesSource(store)].filter((s): s is ListingSource => s != null))];
}

interface RunPlan {
  status: ScrapeStatus;
  hoursAgo: number;
  lastOkHoursAgo: number | null;
  error?: string;
}

/** Última ejecución de cada tienda y fuente, y cuándo fue la última correcta */
const RUN_PLAN: Record<string, RunPlan> = {
  "cofre-mana-gracia:web": { status: "ok", hoursAgo: 2, lastOkHoursAgo: 2 },
  "cofre-mana-gracia:cardmarket_csv": { status: "ok", hoursAgo: 10, lastOkHoursAgo: 10 },
  "bazar-arcano-eixample:web": { status: "ok", hoursAgo: 5, lastOkHoursAgo: 5 },
  "bazar-arcano-eixample:cardmarket_csv": { status: "ok", hoursAgo: 30, lastOkHoursAgo: 30 },
  "tierras-basicas-sants:web": { status: "partial", hoursAgo: 3, lastOkHoursAgo: 15, error: "3 páginas de 42 devolvieron 503" },
  "mesa-duelo-poblenou:web": { status: "ok", hoursAgo: 8, lastOkHoursAgo: 8 },
  "mesa-duelo-poblenou:cardmarket_csv": { status: "ok", hoursAgo: 6, lastOkHoursAgo: 6 },
  "dados-dragones-lh:web": { status: "error", hoursAgo: 1, lastOkHoursAgo: 31, error: "Timeout al descargar /products.json (3 reintentos)" },
  "dados-dragones-lh:cardmarket_csv": { status: "ok", hoursAgo: 4, lastOkHoursAgo: 4 },
  "rincon-draft-collblanc:cardmarket_csv": { status: "ok", hoursAgo: 26, lastOkHoursAgo: 26 },
  "arcano-cards-madrid:web": { status: "ok", hoursAgo: 3, lastOkHoursAgo: 3 },
  "duelistas-turia-valencia:web": { status: "ok", hoursAgo: 7, lastOkHoursAgo: 7 },
  "cartas-del-sur-sevilla:web": { status: "ok", hoursAgo: 9, lastOkHoursAgo: 9 },
};

const DEFAULT_PLAN: RunPlan = { status: "ok", hoursAgo: 6, lastOkHoursAgo: 6 };
const planFor = (storeId: string, source: ListingSource) => RUN_PLAN[`${storeId}:${source}`] ?? DEFAULT_PLAN;

/** Enlace a las cartas sueltas de la tienda en Cardmarket (el CSV real permite filtrar por ?idExpansion=) */
function cardmarketOffersUrl(user: string): string {
  return `https://www.cardmarket.com/es/Magic/Users/${encodeURIComponent(user)}/Offers/Singles`;
}

function slugify(text: string): string {
  return normalizeName(text).replace(/ /g, "-");
}

// ---------------------------------------------------------------------------
// Ofertas inventadas: cartas sueltas
// ---------------------------------------------------------------------------

interface MockListing {
  listingId: string;
  storeId: string;
  source: ListingSource;
  oracleId: string;
  printing: Printing | null;
  url: string;
  priceCents: number;
  inStock: boolean;
  quantity: number | null;
  condition: Condition | null;
  language: Lang | null;
  finish: Finish;
  scrapedAt: string;
  matchConfidence: number;
}

const CONDITION_WEIGHTS: ReadonlyArray<readonly [Condition | null, number]> = [
  ["MT", 3],
  ["NM", 45],
  ["EX", 22],
  ["GD", 12],
  ["LP", 8],
  ["PL", 4],
  ["PO", 1],
  [null, 5],
];
const CONDITION_FACTOR: Record<Condition, number> = { MT: 1.1, NM: 1, EX: 0.92, GD: 0.85, LP: 0.75, PL: 0.6, PO: 0.4 };
const LANGUAGE_WEIGHTS: ReadonlyArray<readonly [Lang | null, number]> = [
  ["es", 44],
  ["en", 42],
  ["it", 3],
  ["fr", 3],
  ["de", 2],
  ["ja", 2],
  [null, 4],
];

function referencePrice(printing: Printing | null, finish: Finish): number | null {
  if (!printing) return null;
  if (finish === "nonfoil") return printing.priceEurCents;
  if (finish === "foil") return printing.priceEurFoilCents;
  return null;
}

function typicalPrice(card: CatalogCard): number {
  const prices = card.printings
    .map((p) => p.priceEurCents)
    .filter((p): p is number => p != null)
    .sort((a, b) => a - b);
  return prices[Math.floor(prices.length / 2)] ?? 300;
}

function generateListings(): MockListing[] {
  const out: MockListing[] = [];
  for (const card of CARDS) {
    for (const store of STORES) {
      const source = singlesSource(store);
      if (!source) continue;
      const rand = seeded(`${store.id}:${card.oracleId}`);
      if (rand() > 0.6) continue;
      const fromCsv = source === "cardmarket_csv";
      const copies = 1 + Math.floor(rand() * 3);
      const scrapedAt = hoursAgo(planFor(store.id, source).lastOkHoursAgo ?? 24);
      for (let i = 0; i < copies; i++) {
        // El CSV de Cardmarket siempre identifica la impresión (idProduct); la web no siempre
        const printing =
          fromCsv || rand() > 0.05 ? (card.printings[Math.floor(rand() * Math.min(5, card.printings.length))] ?? null) : null;
        const options: Finish[] = printing && printing.finishes.length > 0 ? printing.finishes : ["nonfoil"];
        const finish: Finish =
          options.includes("nonfoil") && (options.length === 1 || rand() >= 0.25)
            ? "nonfoil"
            : (options.find((f) => f !== "nonfoil") ?? "nonfoil");
        // En Cardmarket el estado y el idioma siempre vienen informados
        const condition = fromCsv ? (weighted(rand, CONDITION_WEIGHTS) ?? "NM") : weighted(rand, CONDITION_WEIGHTS);
        const language = fromCsv ? (weighted(rand, LANGUAGE_WEIGHTS) ?? "en") : weighted(rand, LANGUAGE_WEIGHTS);
        const base = referencePrice(printing, finish) ?? typicalPrice(card) * (finish === "nonfoil" ? 1 : 1.8);
        const raw = base * (0.82 + rand() * 0.5) * (condition ? CONDITION_FACTOR[condition] : 0.9);
        const priceCents = Math.max(10, Math.round(raw / 5) * 5);
        const inStock = fromCsv ? true : rand() > 0.15;
        out.push({
          listingId: `${store.id}-${source}-${card.oracleId.slice(0, 8)}-${i}`,
          storeId: store.id,
          source,
          oracleId: card.oracleId,
          printing,
          url:
            fromCsv && store.cardmarketUser
              ? cardmarketOffersUrl(store.cardmarketUser)
              : `${store.website}/products/${slugify(card.nameEn)}-${printing?.setCode ?? "sin-edicion"}-${i + 1}`,
          priceCents,
          inStock,
          quantity: inStock ? (!fromCsv && rand() < 0.1 ? null : 1 + Math.floor(rand() * 5)) : 0,
          condition,
          language,
          finish,
          scrapedAt,
          matchConfidence: fromCsv ? 1 : printing ? (rand() < 0.8 ? 1 : 0.92) : 0.85,
        });
      }
    }
  }
  return out;
}

const LISTINGS = generateListings();

// ---------------------------------------------------------------------------
// Ofertas inventadas: producto sellado
// ---------------------------------------------------------------------------

interface MockSealedListing {
  listingId: string;
  storeId: string;
  source: ListingSource;
  sealedProductId: string;
  url: string;
  priceCents: number;
  inStock: boolean;
  quantity: number | null;
  language: Lang | null;
  scrapedAt: string;
  matchConfidence: number;
}

/** Precio orientativo por tipo de producto (MTGJSON no trae precios) */
const SEALED_BASE_PRICE: Record<string, number> = {
  "booster_pack/play": 550,
  "booster_pack/draft": 450,
  "booster_pack/set": 500,
  "booster_pack/collector": 2800,
  "booster_pack/jumpstart": 600,
  "booster_box/play": 15500,
  "booster_box/draft": 13000,
  "booster_box/set": 14000,
  "booster_box/collector": 32000,
  "booster_box/jumpstart": 14000,
  "bundle/default": 5200,
  "bundle/fat_pack": 4500,
  "bundle/gift_bundle": 7000,
  "deck/commander": 4800,
  "limited_aid_tool/prerelease_kit": 3200,
  "multiple_decks/two_player_starter": 1900,
  "deck/starter_deck": 1500,
};

/** Productos que vende una tienda normal: nada de cajas de distribuidor, canjes de MTGO ni promos */
const SELLABLE = SEALED.filter((p) => SEALED_BASE_PRICE[`${p.category}/${p.subtype}`] != null);

function generateSealedListings(): MockSealedListing[] {
  const out: MockSealedListing[] = [];
  for (const product of SELLABLE) {
    for (const store of STORES) {
      const source = sealedSource(store);
      if (!source) continue;
      const rand = seeded(`sealed:${store.id}:${product.sealedProductId}`);
      if (rand() > 0.45) continue;
      const languages: Lang[] = rand() < 0.35 ? ["es", "en"] : [rand() < 0.6 ? "es" : "en"];
      const base = SEALED_BASE_PRICE[`${product.category}/${product.subtype}`] ?? 3000;
      const scrapedAt = hoursAgo(planFor(store.id, source).lastOkHoursAgo ?? 24);
      languages.forEach((language, i) => {
        const inStock = rand() > 0.2;
        out.push({
          listingId: `${store.id}-sealed-${product.sealedProductId.slice(0, 8)}-${language}`,
          storeId: store.id,
          source,
          sealedProductId: product.sealedProductId,
          url: `${store.website}/products/${slugify(product.name)}-${language}-${i + 1}`,
          priceCents: Math.round((base * (0.9 + rand() * 0.25) * (language === "es" ? 1.03 : 1)) / 5) * 5,
          inStock,
          quantity: inStock ? (rand() < 0.3 ? null : 1 + Math.floor(rand() * 8)) : 0,
          language,
          scrapedAt,
          matchConfidence: rand() < 0.7 ? 1 : 0.9,
        });
      });
    }
  }
  return out;
}

const SEALED_LISTINGS = generateSealedListings();

// ---------------------------------------------------------------------------
// Sin emparejar y ejecuciones
// ---------------------------------------------------------------------------

function cardIdByName(nameEn: string): string | null {
  return CARDS.find((c) => c.nameEn === nameEn)?.oracleId ?? null;
}

function guess(nameEn: string, confidence: number): UnmatchedListing["bestGuess"] {
  const oracleId = cardIdByName(nameEn);
  return oracleId ? { oracleId, nameEn, confidence } : null;
}

type UnmatchedSeed = [storeId: string, kind: UnmatchedListing["kind"], source: ListingSource, rawTitle: string, priceCents: number, bestGuess: UnmatchedListing["bestGuess"]];

const UNMATCHED_SEEDS: UnmatchedSeed[] = [
  ["arcano-cards-madrid", "single", "web", "Ragavan Ratero Habil (MH2) Foil Etched - JAP", 1890, guess("Ragavan, Nimble Pilferer", 0.62)],
  ["duelistas-turia-valencia", "single", "web", "Sheoldred Apocalypse Prerelease Promo FOIL", 7450, guess("Sheoldred, the Apocalypse", 0.58)],
  ["cartas-del-sur-sevilla", "single", "web", "Fire/Ice (Apocalypse) LP", 95, guess("Fire // Ice", 0.55)],
  ["arcano-cards-madrid", "single", "web", "Aves del Paraiso 4ª Edicion", 650, guess("Birds of Paradise", 0.64)],
  ["duelistas-turia-valencia", "single", "web", "Contrahechiso - Tempest Remastered", 120, guess("Counterspell", 0.66)],
  ["bazar-arcano-eixample", "single", "cardmarket_csv", "idProduct 812345 · Edge of Eternities Collector (fila 214)", 450, null],
  ["cofre-mana-gracia", "sealed", "web", "Caja de sobres de coleccionista (edición sin indicar)", 29900, null],
  ["tierras-basicas-sants", "sealed", "web", "Pack Navidad: 3 sobres + dado", 1695, null],
  ["dados-dragones-lh", "sealed", "web", "Lote 20 tierras básicas surtidas", 300, null],
  ["mesa-duelo-poblenou", "sealed", "web", "Fundas Dragon Shield Matte negras (100)", 1295, null],
];

const UNMATCHED: UnmatchedListing[] = UNMATCHED_SEEDS.map(([storeId, kind, source, rawTitle, priceCents, bestGuess], i) => {
  const store = STORE_BY_ID.get(storeId);
  return {
    listingId: `unmatched-${i + 1}`,
    storeId,
    kind,
    source,
    rawTitle,
    url:
      source === "cardmarket_csv" && store?.cardmarketUser
        ? cardmarketOffersUrl(store.cardmarketUser)
        : `${store?.website ?? "https://example.com"}/products/${slugify(rawTitle)}`,
    priceCents,
    bestGuess,
    scrapedAt: hoursAgo(planFor(storeId, source).lastOkHoursAgo ?? 24),
  };
});

function buildRuns(): ScrapeRun[] {
  const runs: ScrapeRun[] = [];
  for (const store of STORES) {
    for (const source of storeSources(store)) {
      const plan = planFor(store.id, source);
      const found =
        LISTINGS.filter((l) => l.storeId === store.id && l.source === source).length +
        SEALED_LISTINGS.filter((l) => l.storeId === store.id && l.source === source).length +
        UNMATCHED.filter((u) => u.storeId === store.id && u.source === source).length;
      const unmatched = UNMATCHED.filter((u) => u.storeId === store.id && u.source === source).length;
      const failed = plan.status === "error";
      runs.push({
        id: `run-${runs.length + 1}`,
        storeId: store.id,
        source,
        startedAt: hoursAgo(plan.hoursAgo + 0.1),
        finishedAt: hoursAgo(plan.hoursAgo),
        status: plan.status,
        found: failed ? 0 : found,
        matched: failed ? 0 : found - unmatched,
        unmatched: failed ? 0 : unmatched,
        error: plan.error ?? null,
      });
    }
  }
  return runs;
}

const RUNS = buildRuns();

// ---------------------------------------------------------------------------
// Búsqueda y filtros
// ---------------------------------------------------------------------------

/** Menor es mejor; null = no coincide */
function nameScore(norm: string, query: string): number | null {
  if (norm === query) return 0;
  if (norm.startsWith(query)) return 1;
  if (norm.split(" ").some((w) => w.startsWith(query))) return 2;
  if (norm.includes(query)) return 3;
  const sim = trigramSimilarity(norm, query);
  return sim >= 0.3 ? 4 + (1 - sim) : null;
}

function rankCards(q: string): Array<{ entry: NameEntry; score: number }> {
  const query = normalizeName(q);
  if (query.length < 2) return [];
  const best = new Map<string, { entry: NameEntry; score: number }>();
  for (const entry of NAMES) {
    const score = nameScore(entry.norm, query);
    if (score == null) continue;
    const prev = best.get(entry.oracleId);
    if (!prev || score < prev.score) best.set(entry.oracleId, { entry, score });
  }
  return [...best.values()].sort((a, b) => a.score - b.score || a.entry.name.length - b.entry.name.length);
}

/** Palabras habituales en español → las que usa MTGJSON en los nombres de producto */
const SEALED_SYNONYMS: Record<string, string> = {
  caja: "box",
  cajas: "box",
  display: "box",
  sobre: "booster",
  sobres: "booster",
  mazo: "deck",
  mazos: "deck",
  presentacion: "prerelease",
  coleccionista: "collector",
  juego: "play",
  inicio: "starter",
};

function rankSealed(q: string): CatalogSealed[] {
  const tokens = normalizeName(q)
    .split(" ")
    .filter((t) => t.length > 1 && t !== "de" && t !== "del")
    .map((t) => SEALED_SYNONYMS[t] ?? t);
  if (tokens.length === 0) return [];
  return SEALED.filter((p) => tokens.every((t) => p.searchText.split(" ").some((w) => w.startsWith(t)))).sort(
    (a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "") || a.name.localeCompare(b.name),
  );
}

function offerStore(storeId: string): OfferStore {
  const s = STORE_BY_ID.get(storeId);
  return s ? { id: s.id, name: s.name, city: s.city, local: s.local } : { id: storeId, name: storeId, city: "", local: false };
}

function summarizeCard(card: CatalogCard): CardSummary {
  const inStock = LISTINGS.filter((l) => l.oracleId === card.oracleId && l.inStock);
  return {
    oracleId: card.oracleId,
    nameEn: card.nameEn,
    nameEs: card.namesEs[0] ?? null,
    imageUrl: card.printings.find((p) => p.imageUrl)?.imageUrl ?? null,
    minPriceCents: inStock.length ? Math.min(...inStock.map((l) => l.priceCents)) : null,
    offerCount: inStock.length,
  };
}

function summarizeSealed(p: CatalogSealed): SealedSummary {
  const inStock = SEALED_LISTINGS.filter((l) => l.sealedProductId === p.sealedProductId && l.inStock);
  return {
    sealedProductId: p.sealedProductId,
    name: p.name,
    setCode: p.setCode,
    setName: SEALED_SET_BY_CODE.get(p.setCode)?.name ?? p.setCode.toUpperCase(),
    category: p.category,
    subtype: p.subtype,
    releaseDate: p.releaseDate,
    imageUrl: null,
    minPriceCents: inStock.length ? Math.min(...inStock.map((l) => l.priceCents)) : null,
    offerCount: inStock.length,
  };
}

function storeMatches(storeId: string, f: { cities?: string[]; localOnly?: boolean }): boolean {
  const store = STORE_BY_ID.get(storeId);
  if (!store) return false;
  if (f.localOnly && !store.local) return false;
  if (f.cities?.length && !f.cities.includes(store.city)) return false;
  return true;
}

function passes(listing: MockListing, f: OfferFilters): boolean {
  if (!storeMatches(listing.storeId, f)) return false;
  if (f.inStockOnly && !listing.inStock) return false;
  if (f.finish && listing.finish !== f.finish) return false;
  if (f.languages?.length && (!listing.language || !f.languages.includes(listing.language))) return false;
  if (f.minCondition) {
    if (!listing.condition) return false;
    if (CONDITIONS.indexOf(listing.condition) > CONDITIONS.indexOf(f.minCondition)) return false;
  }
  if (f.setCode && listing.printing?.setCode !== f.setCode) return false;
  return true;
}

function passesSealed(listing: MockSealedListing, f: SealedOfferFilters): boolean {
  if (!storeMatches(listing.storeId, f)) return false;
  if (f.inStockOnly && !listing.inStock) return false;
  if (f.languages?.length && (!listing.language || !f.languages.includes(listing.language))) return false;
  return true;
}

function toStore(info: StoreInfo): Store {
  const runs = RUNS.filter((r) => r.storeId === info.id);
  const okTimes = storeSources(info)
    .map((source) => planFor(info.id, source).lastOkHoursAgo)
    .filter((h): h is number => h != null);
  const latest = [...runs].sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""))[0];
  return {
    ...info,
    lastScrapedAt: okTimes.length ? hoursAgo(Math.min(...okTimes)) : null,
    lastStatus: latest?.status === "running" ? null : (latest?.status ?? null),
  };
}

// ---------------------------------------------------------------------------
// Repositorio
// ---------------------------------------------------------------------------

export function createMockRepository(): Repository {
  const runs = new Map<string, { storeId: string; source: ListingSource; saved: number }>();
  let runCounter = 0;

  return {
    // --- Web: cartas ---

    async autocomplete(q, limit = 8): Promise<CardSuggestion[]> {
      return rankCards(q)
        .slice(0, limit)
        .map(({ entry }) => ({
          oracleId: entry.oracleId,
          nameEn: CARD_BY_ID.get(entry.oracleId)?.nameEn ?? entry.name,
          matchedName: entry.name,
          lang: entry.lang,
        }));
    },

    async searchCards(q, limit = 20) {
      return rankCards(q)
        .slice(0, limit)
        .map(({ entry }) => CARD_BY_ID.get(entry.oracleId))
        .filter((c): c is CatalogCard => c != null)
        .map(summarizeCard);
    },

    async getCard(oracleId) {
      const card = CARD_BY_ID.get(oracleId);
      return card ? { card: summarizeCard(card), printings: card.printings } : null;
    },

    async getOffers(oracleId, filters = {}): Promise<Offer[]> {
      return LISTINGS.filter((l) => l.oracleId === oracleId && passes(l, filters))
        .sort((a, b) => a.priceCents - b.priceCents || Number(b.inStock) - Number(a.inStock))
        .map((l) => ({
          listingId: l.listingId,
          store: offerStore(l.storeId),
          source: l.source,
          printing: l.printing,
          url: l.url,
          priceCents: l.priceCents,
          inStock: l.inStock,
          quantity: l.quantity,
          condition: l.condition,
          language: l.language,
          finish: l.finish,
          scrapedAt: l.scrapedAt,
          matchConfidence: l.matchConfidence,
          referencePriceCents: referencePrice(l.printing, l.finish),
        }));
    },

    // --- Web: sellado ---

    async searchSealed(q, limit = 20) {
      return rankSealed(q).slice(0, limit).map(summarizeSealed);
    },

    async getSealedProduct(sealedProductId) {
      const product = SEALED_BY_ID.get(sealedProductId);
      return product ? summarizeSealed(product) : null;
    },

    async getSealedOffers(sealedProductId, filters = {}): Promise<SealedOffer[]> {
      return SEALED_LISTINGS.filter((l) => l.sealedProductId === sealedProductId && passesSealed(l, filters))
        .sort((a, b) => a.priceCents - b.priceCents || Number(b.inStock) - Number(a.inStock))
        .map((l) => ({
          listingId: l.listingId,
          store: offerStore(l.storeId),
          source: l.source,
          url: l.url,
          priceCents: l.priceCents,
          inStock: l.inStock,
          quantity: l.quantity,
          language: l.language,
          scrapedAt: l.scrapedAt,
          matchConfidence: l.matchConfidence,
        }));
    },

    // --- Web: tiendas ---

    async listStores() {
      return STORES.map(toStore);
    },

    async getStore(id): Promise<StoreDetail | null> {
      const info = STORE_BY_ID.get(id);
      if (!info) return null;
      const singles = LISTINGS.filter((l) => l.storeId === id);
      const sealed = SEALED_LISTINGS.filter((l) => l.storeId === id);
      return {
        ...toStore(info),
        listingCount: singles.length + sealed.length,
        inStockCount: singles.filter((l) => l.inStock).length + sealed.filter((l) => l.inStock).length,
        latestRuns: RUNS.filter((r) => r.storeId === id),
      };
    },

    // --- Panel interno ---

    async listUnmatched({ limit = 50, offset = 0 } = {}) {
      return { items: UNMATCHED.slice(offset, offset + limit), total: UNMATCHED.length };
    },

    async listLatestRuns() {
      return RUNS;
    },

    // --- Catálogo (emparejador) ---

    async findByExactName(nameNorm, lang) {
      const seen = new Set<string>();
      return NAMES.filter((n) => n.lang === lang && n.norm === nameNorm && !seen.has(n.oracleId) && seen.add(n.oracleId)).map(
        (n) => ({ oracleId: n.oracleId, name: CARD_BY_ID.get(n.oracleId)?.nameEn ?? n.name }),
      );
    },

    async findByTrigram(nameNorm, minSimilarity, limit) {
      // Como la BD: name es el nombre inglés de la carta aunque haya coincidido el español
      return NAMES.map((n) => ({
        oracleId: n.oracleId,
        name: CARD_BY_ID.get(n.oracleId)?.nameEn ?? n.name,
        lang: n.lang,
        similarity: trigramSimilarity(n.norm, nameNorm),
      }))
        .filter((n) => n.similarity >= minSimilarity)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
    },

    async resolveSet(hint) {
      const norm = normalizeName(hint);
      return norm ? (SET_ALIASES.get(norm) ?? null) : null;
    },

    async findPrintings(oracleId, setCode): Promise<PrintingCandidate[]> {
      const card = CARD_BY_ID.get(oracleId);
      if (!card) return [];
      return card.raw
        .filter((p) => p.setCode.toLowerCase() === setCode.toLowerCase())
        .map((p) => ({
          scryfallId: p.scryfallId,
          collectorNumber: p.collectorNumber,
          finishes: toFinishes(p.finishes),
          borderColor: p.borderColor,
          frameEffects: p.frameEffects,
          promoTypes: p.promoTypes,
          fullArt: p.fullArt,
          promo: p.promo,
        }));
    },

    async findPrintingByCardmarketId(cardmarketId) {
      return PRINTING_BY_CARDMARKET_ID.get(cardmarketId) ?? null;
    },

    async findSealedByCardmarketId(cardmarketId) {
      const p = SEALED.find((s) => s.cardmarketId === cardmarketId);
      return p ? toSealedCandidate(p) : null;
    },

    async findSealedProducts(setCode, opts = {}) {
      return SEALED.filter(
        (p) =>
          p.setCode === setCode.toLowerCase() &&
          (!opts.category || p.category === opts.category) &&
          (!opts.subtype || p.subtype === opts.subtype),
      ).map(toSealedCandidate);
    },

    async findSealedByTrigram(nameNorm, minSimilarity, limit) {
      return SEALED.map((p) => ({ ...toSealedCandidate(p), similarity: trigramSimilarity(p.norm, nameNorm) }))
        .filter((p) => p.similarity >= minSimilarity)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
    },

    async getOverride() {
      return null;
    },

    // --- Worker (ejecución en seco: no guarda nada, solo informa) ---

    async upsertStores(stores: StoreInfo[]) {
      console.log(`[mock] upsertStores: ${stores.length} tiendas`);
    },

    async startRun(storeId, source = "web") {
      const id = `mock-run-${++runCounter}`;
      runs.set(id, { storeId, source, saved: 0 });
      console.log(`[mock] startRun ${id} (${storeId}, ${source})`);
      return id;
    },

    async saveListings(runId, items: MatchedListing[]) {
      const run = runs.get(runId);
      if (run) run.saved += items.length;
      const matched = items.filter((i) => i.match).length;
      console.log(`[mock] saveListings ${runId}: ${items.length} listados (${matched} emparejados)`);
    },

    async finishRun(runId, result: { status: ScrapeStatus; stats: ScrapeRunStats; error?: string }) {
      const { found, matched, unmatched } = result.stats;
      console.log(
        `[mock] finishRun ${runId}: ${result.status} · encontrados ${found}, emparejados ${matched}, sin emparejar ${unmatched}` +
          (result.error ? ` · ${result.error}` : ""),
      );
    },
  };
}

function toSealedCandidate(p: CatalogSealed): SealedCandidate {
  return { sealedProductId: p.sealedProductId, setCode: p.setCode, name: p.name, category: p.category, subtype: p.subtype };
}
