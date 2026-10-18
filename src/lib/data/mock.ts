import rawFixture from "./fixtures/scryfall-sample.json";
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
  type MatchedListing,
  type Offer,
  type OfferFilters,
  type Printing,
  type PrintingCandidate,
  type Repository,
  type ScrapeRun,
  type ScrapeRunStats,
  type ScrapeStatus,
  type Store,
  type StoreDetail,
  type StoreInfo,
  type UnmatchedListing,
} from "./types";

/**
 * Datos de ejemplo en memoria (DATA_SOURCE=mock).
 *
 * Las cartas, impresiones y precios de referencia son reales: una muestra de Scryfall en
 * fixtures/scryfall-sample.json. Las tiendas, sus direcciones y sus ofertas son INVENTADAS
 * y se generan de forma determinista para que la web se vea igual en cada arranque.
 */

// ---------------------------------------------------------------------------
// Fixture de Scryfall
// ---------------------------------------------------------------------------

interface FixturePrinting {
  scryfallId: string;
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

interface Fixture {
  sets: Array<{ code: string; name: string; releasedAt: string }>;
  cards: FixtureCard[];
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

const fixture = rawFixture as unknown as Fixture;

function toFinishes(values: string[]): Finish[] {
  return values.filter((v): v is Finish => (FINISHES as readonly string[]).includes(v));
}

const CARDS: CatalogCard[] = fixture.cards.map((c) => {
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

const SETS = fixture.sets.map((s) => ({ ...s, norm: normalizeName(s.name) }));

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
    city: "barcelona",
    address: "Carrer de Verdi, 42, 08012 Barcelona",
    website: "https://cofre-mana.example.com",
    platform: "shopify",
  },
  {
    id: "bazar-arcano-eixample",
    name: "Bazar Arcano",
    city: "barcelona",
    address: "Carrer del Consell de Cent, 215, 08011 Barcelona",
    website: "https://bazar-arcano.example.com",
    platform: "woocommerce",
  },
  {
    id: "tierras-basicas-sants",
    name: "Tierras Básicas",
    city: "barcelona",
    address: "Carrer de Sants, 118, 08028 Barcelona",
    website: "https://tierras-basicas.example.com",
    platform: "prestashop",
  },
  {
    id: "mesa-duelo-poblenou",
    name: "La Mesa del Duelo",
    city: "barcelona",
    address: "Rambla del Poblenou, 77, 08005 Barcelona",
    website: "https://mesa-duelo.example.com",
    platform: "html",
  },
  {
    id: "dados-dragones-lh",
    name: "Dados y Dragones",
    city: "hospitalet",
    address: "Rambla de la Marina, 150, 08907 L'Hospitalet de Llobregat",
    website: "https://dados-dragones.example.com",
    platform: "shopify",
  },
  {
    id: "rincon-draft-collblanc",
    name: "Rincón del Draft",
    city: "hospitalet",
    address: "Carrer de Collblanc, 63, 08904 L'Hospitalet de Llobregat",
    website: "https://rincon-draft.example.com",
    platform: "woocommerce",
  },
];

const STORE_BY_ID = new Map(STORES.map((s) => [s.id, s]));

/** Última ejecución de cada tienda y cuándo fue la última correcta */
const RUN_PLAN: Record<string, { status: ScrapeStatus; hoursAgo: number; lastOkHoursAgo: number | null; error?: string }> = {
  "cofre-mana-gracia": { status: "ok", hoursAgo: 2, lastOkHoursAgo: 2 },
  "bazar-arcano-eixample": { status: "ok", hoursAgo: 5, lastOkHoursAgo: 5 },
  "tierras-basicas-sants": { status: "partial", hoursAgo: 3, lastOkHoursAgo: 15, error: "3 páginas de 42 devolvieron 503" },
  "mesa-duelo-poblenou": { status: "ok", hoursAgo: 8, lastOkHoursAgo: 8 },
  "dados-dragones-lh": {
    status: "error",
    hoursAgo: 1,
    lastOkHoursAgo: 31,
    error: "Timeout al descargar /products.json (3 reintentos)",
  },
  "rincon-draft-collblanc": { status: "ok", hoursAgo: 4, lastOkHoursAgo: 4 },
};

// ---------------------------------------------------------------------------
// Ofertas inventadas
// ---------------------------------------------------------------------------

interface MockListing {
  listingId: string;
  storeId: string;
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

function slugify(text: string): string {
  return normalizeName(text).replace(/ /g, "-");
}

function referencePrice(printing: Printing | null, finish: Finish): number | null {
  if (!printing) return null;
  if (finish === "nonfoil") return printing.priceEurCents;
  if (finish === "foil") return printing.priceEurFoilCents;
  return null;
}

function typicalPrice(card: CatalogCard): number {
  const prices = card.printings.map((p) => p.priceEurCents).filter((p): p is number => p != null).sort((a, b) => a - b);
  return prices[Math.floor(prices.length / 2)] ?? 300;
}

function generateListings(): MockListing[] {
  const out: MockListing[] = [];
  for (const card of CARDS) {
    for (const store of STORES) {
      const rand = seeded(`${store.id}:${card.oracleId}`);
      if (rand() > 0.6) continue;
      const copies = 1 + Math.floor(rand() * 3);
      const plan = RUN_PLAN[store.id];
      const scrapedAt = hoursAgo(plan?.lastOkHoursAgo ?? 24);
      for (let i = 0; i < copies; i++) {
        const printing = rand() > 0.05 ? (card.printings[Math.floor(rand() * Math.min(5, card.printings.length))] ?? null) : null;
        const options: Finish[] = printing && printing.finishes.length > 0 ? printing.finishes : ["nonfoil"];
        const finish: Finish =
          options.includes("nonfoil") && (options.length === 1 || rand() >= 0.25)
            ? "nonfoil"
            : (options.find((f) => f !== "nonfoil") ?? "nonfoil");
        const condition = weighted(rand, CONDITION_WEIGHTS);
        const base = referencePrice(printing, finish) ?? typicalPrice(card) * (finish === "nonfoil" ? 1 : 1.8);
        const raw = base * (0.82 + rand() * 0.5) * (condition ? CONDITION_FACTOR[condition] : 0.9);
        const priceCents = Math.max(10, Math.round(raw / 5) * 5);
        const inStock = rand() > 0.15;
        out.push({
          listingId: `${store.id}-${card.oracleId.slice(0, 8)}-${i}`,
          storeId: store.id,
          oracleId: card.oracleId,
          printing,
          url: `${store.website}/products/${slugify(card.nameEn)}-${printing?.setCode ?? "sin-edicion"}-${i + 1}`,
          priceCents,
          inStock,
          quantity: inStock ? (rand() < 0.1 ? null : 1 + Math.floor(rand() * 5)) : 0,
          condition,
          language: weighted(rand, LANGUAGE_WEIGHTS),
          finish,
          scrapedAt,
          matchConfidence: printing ? (rand() < 0.8 ? 1 : 0.92) : 0.85,
        });
      }
    }
  }
  return out;
}

const LISTINGS = generateListings();

function cardIdByName(nameEn: string): string | null {
  return CARDS.find((c) => c.nameEn === nameEn)?.oracleId ?? null;
}

function guess(nameEn: string, confidence: number): UnmatchedListing["bestGuess"] {
  const oracleId = cardIdByName(nameEn);
  return oracleId ? { oracleId, nameEn, confidence } : null;
}

const UNMATCHED: UnmatchedListing[] = [
  ["tierras-basicas-sants", "Ragavan Ratero Habil (MH2) Foil Etched - JAP", 1890, guess("Ragavan, Nimble Pilferer", 0.62)],
  ["cofre-mana-gracia", "Sheoldred Apocalypse Prerelease Promo FOIL", 7450, guess("Sheoldred, the Apocalypse", 0.58)],
  ["mesa-duelo-poblenou", "Fire/Ice (Apocalypse) LP", 95, guess("Fire // Ice", 0.55)],
  ["bazar-arcano-eixample", "Aves del Paraiso 4ª Edicion", 650, guess("Birds of Paradise", 0.64)],
  ["rincon-draft-collblanc", "Anillo Unico - El Señor de los Anillos (borderless)", 6200, guess("The One Ring", 0.6)],
  ["dados-dragones-lh", "Lote 20 tierras básicas surtidas", 300, null],
  ["cofre-mana-gracia", "Booster de Draft Bloomburrow (ES)", 550, null],
  ["tierras-basicas-sants", "Carpeta 9 bolsillos Ultra Pro negra", 1495, null],
  ["mesa-duelo-poblenou", "Contrahechiso - Tempest Remastered", 120, guess("Counterspell", 0.66)],
].map(([storeId, rawTitle, priceCents, bestGuess], i) => {
  const store = STORE_BY_ID.get(storeId as string);
  return {
    listingId: `unmatched-${i + 1}`,
    storeId: storeId as string,
    rawTitle: rawTitle as string,
    url: `${store?.website ?? "https://example.com"}/products/${slugify(rawTitle as string)}`,
    priceCents: priceCents as number,
    bestGuess: bestGuess as UnmatchedListing["bestGuess"],
    scrapedAt: hoursAgo(RUN_PLAN[storeId as string]?.lastOkHoursAgo ?? 24),
  };
});

function buildRuns(): ScrapeRun[] {
  return STORES.map((store, i) => {
    const plan = RUN_PLAN[store.id] ?? { status: "ok" as const, hoursAgo: 6, lastOkHoursAgo: 6 };
    const found = LISTINGS.filter((l) => l.storeId === store.id).length + UNMATCHED.filter((u) => u.storeId === store.id).length;
    const unmatched = UNMATCHED.filter((u) => u.storeId === store.id).length;
    const failed = plan.status === "error";
    return {
      id: `run-${i + 1}`,
      storeId: store.id,
      startedAt: hoursAgo(plan.hoursAgo + 0.1),
      finishedAt: hoursAgo(plan.hoursAgo),
      status: plan.status,
      found: failed ? 0 : found,
      matched: failed ? 0 : found - unmatched,
      unmatched: failed ? 0 : unmatched,
      error: plan.error ?? null,
    };
  });
}

const RUNS = buildRuns();

// ---------------------------------------------------------------------------
// Búsqueda
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

function summarize(card: CatalogCard): CardSummary {
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

function passes(listing: MockListing, f: OfferFilters): boolean {
  const store = STORE_BY_ID.get(listing.storeId);
  if (f.cities?.length && (!store || !f.cities.includes(store.city))) return false;
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

function toStore(info: StoreInfo): Store {
  const plan = RUN_PLAN[info.id];
  return {
    ...info,
    lastScrapedAt: plan?.lastOkHoursAgo != null ? hoursAgo(plan.lastOkHoursAgo) : null,
    lastStatus: plan?.status ?? null,
  };
}

// ---------------------------------------------------------------------------
// Repositorio
// ---------------------------------------------------------------------------

export function createMockRepository(): Repository {
  const runs = new Map<string, { storeId: string; saved: number }>();
  let runCounter = 0;

  return {
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
        .map(summarize);
    },

    async getCard(oracleId) {
      const card = CARD_BY_ID.get(oracleId);
      return card ? { card: summarize(card), printings: card.printings } : null;
    },

    async getOffers(oracleId, filters = {}): Promise<Offer[]> {
      return LISTINGS.filter((l) => l.oracleId === oracleId && passes(l, filters))
        .sort((a, b) => a.priceCents - b.priceCents || Number(b.inStock) - Number(a.inStock))
        .map((l) => {
          const store = STORE_BY_ID.get(l.storeId)!;
          return {
            listingId: l.listingId,
            store: { id: store.id, name: store.name, city: store.city },
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
          };
        });
    },

    async listStores() {
      return STORES.map(toStore);
    },

    async getStore(id): Promise<StoreDetail | null> {
      const info = STORE_BY_ID.get(id);
      if (!info) return null;
      const own = LISTINGS.filter((l) => l.storeId === id);
      return { ...toStore(info), listingCount: own.length, inStockCount: own.filter((l) => l.inStock).length };
    },

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
        (n) => ({ oracleId: n.oracleId, name: n.name }),
      );
    },

    async findByTrigram(nameNorm, minSimilarity, limit) {
      return NAMES.map((n) => ({ oracleId: n.oracleId, name: n.name, lang: n.lang, similarity: trigramSimilarity(n.norm, nameNorm) }))
        .filter((n) => n.similarity >= minSimilarity)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
    },

    async resolveSet(hint) {
      const norm = normalizeName(hint);
      if (!norm) return null;
      return SETS.find((s) => s.code.toLowerCase() === norm || s.norm === norm)?.code ?? null;
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

    async getOverride() {
      return null;
    },

    // --- Worker (ejecución en seco: no guarda nada, solo informa) ---

    async upsertStores(stores: StoreInfo[]) {
      console.log(`[mock] upsertStores: ${stores.length} tiendas`);
    },

    async startRun(storeId) {
      const id = `mock-run-${++runCounter}`;
      runs.set(id, { storeId, saved: 0 });
      console.log(`[mock] startRun ${id} (${storeId})`);
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
