import type { CardsResponse } from "@/lib/deck/build";
import { identifierFor, identifierKey } from "@/lib/deck/manabox";
import type { DeckCard, ImportRow } from "@/lib/deck/types";
import type { Collection, CollectionEntry, CollectionLine, Finish } from "./types";

/** Como mucho por petición a /api/mazo/cartas */
const REQUEST_BATCH = 250;

/** Pide a la API los datos de las cartas, en lotes y sin buscar la versión en español */
export async function fetchCollectionCards(rows: ImportRow[]): Promise<CardsResponse> {
  const identifiers = [...new Map(rows.map(identifierFor).map((id) => [identifierKey(id), id])).values()];
  const out: CardsResponse = { cards: [], notFound: [] };
  for (let i = 0; i < identifiers.length; i += REQUEST_BATCH) {
    const res = await fetch("/api/mazo/cartas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: identifiers.slice(i, i + REQUEST_BATCH), spanish: false }),
    });
    const data = (await res.json()) as CardsResponse & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
    out.cards.push(...data.cards);
    out.notFound.push(...data.notFound);
  }
  return out;
}

/** Junta las líneas del CSV: la misma impresión con el mismo acabado se suma en una sola línea */
export function buildLines(rows: ImportRow[], response: CardsResponse): { lines: CollectionLine[]; missing: string[] } {
  const byKey = new Map(response.cards.map((c) => [c.key, c.card]));
  const lines = new Map<string, CollectionLine>();
  const missing: string[] = [];
  for (const row of rows) {
    const card = byKey.get(identifierKey(identifierFor(row)));
    if (!card) {
      missing.push(`${row.quantity} ${row.name}`);
      continue;
    }
    const finish: Finish = row.finish ?? "normal";
    const key = `${card.scryfallId}|${finish}`;
    const line = lines.get(key) ?? { card, finish, quantity: 0, paidCents: null };
    line.quantity += row.quantity;
    if (row.purchaseCents != null) line.paidCents = (line.paidCents ?? 0) + row.purchaseCents * row.quantity;
    lines.set(key, line);
  }
  return { lines: [...lines.values()], missing };
}

export function newCollection(name: string, lines: CollectionLine[], now = new Date()): Collection {
  return { version: 1, id: `coleccion-${now.getTime().toString(36)}`, name, lines, importedAt: now.toISOString() };
}

/** Precio actual por carta (Cardmarket vía Scryfall) según el acabado; si no hay, el de compra */
export function unitPrice(line: CollectionLine): number | null {
  const { card } = line;
  const current = line.finish === "normal" ? card.priceEurCents : (card.priceEurFoilCents ?? card.priceEurCents);
  return current ?? (line.paidCents == null ? null : Math.round(line.paidCents / line.quantity));
}

const collectorOrder = (cn: string) => {
  const n = Number.parseInt(cn, 10);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
};

/**
 * Una entrada por carta (todas sus impresiones y acabados juntos) o, con split, una por impresión.
 * Así las repetidas del CSV (normal y foil, o dos ilustraciones) salen una sola vez con su cantidad.
 */
export function collectionEntries(lines: CollectionLine[], split = false): CollectionEntry[] {
  const groups = new Map<string, CollectionLine[]>();
  for (const line of lines) {
    const key = split ? line.card.scryfallId : line.card.oracleId;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  return [...groups].map(([key, group]) => {
    const sorted = [...group].sort(
      (a, b) => collectorOrder(a.card.collectorNumber) - collectorOrder(b.card.collectorNumber) || (a.finish === "normal" ? -1 : b.finish === "normal" ? 1 : 0),
    );
    const units = sorted.map(unitPrice).filter((u): u is number => u != null);
    const prices = sorted.map((l) => {
      const unit = unitPrice(l);
      return unit == null ? null : unit * l.quantity;
    });
    return {
      key,
      card: sorted[0]!.card,
      lines: sorted,
      quantity: sorted.reduce((s, l) => s + l.quantity, 0),
      foil: sorted.filter((l) => l.finish !== "normal").reduce((s, l) => s + l.quantity, 0),
      versions: new Set(sorted.map((l) => l.card.scryfallId)).size,
      valueCents: prices.some((p) => p != null) ? prices.reduce<number>((s, p) => s + (p ?? 0), 0) : null,
      unitCents: units.length ? Math.max(...units) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Grupos y orden
// ---------------------------------------------------------------------------

export type GroupMode = "color" | "type" | "rarity" | "cmc" | "none";
/** price = precio de mercado de mayor a menor; price-asc = de menor a mayor */
export type SortMode = "cmc" | "name" | "price" | "price-asc" | "number";

const frontType = (card: DeckCard) => card.typeLine.split(" // ")[0] ?? card.typeLine;
const isLand = (card: DeckCard) => /\bLand\b/.test(frontType(card));

const TYPE_TESTS: Array<[string, RegExp]> = [
  ["land", /\bLand\b/],
  ["creature", /\bCreature\b/],
  ["planeswalker", /\bPlaneswalker\b/],
  ["instant", /\bInstant\b/],
  ["sorcery", /\bSorcery\b/],
  ["artifact", /\bArtifact\b/],
  ["enchantment", /\bEnchantment\b/],
  ["battle", /\bBattle\b/],
];

const GROUPS: Record<GroupMode, { order: Array<[string, string]>; of: (card: DeckCard) => string }> = {
  color: {
    order: [["W", "Blanco"], ["U", "Azul"], ["B", "Negro"], ["R", "Rojo"], ["G", "Verde"], ["M", "Multicolor"], ["C", "Incoloras"], ["L", "Tierras"], ["T", "Fichas"]],
    of: (c) => (c.isToken ? "T" : isLand(c) ? "L" : c.colors.length > 1 ? "M" : (c.colors[0] ?? "C")),
  },
  type: {
    order: [["creature", "Criaturas"], ["planeswalker", "Planeswalkers"], ["instant", "Instantáneos"], ["sorcery", "Conjuros"], ["artifact", "Artefactos"], ["enchantment", "Encantamientos"], ["battle", "Batallas"], ["land", "Tierras"], ["token", "Fichas"], ["other", "Otras"]],
    of: (c) => (c.isToken ? "token" : (TYPE_TESTS.find(([, re]) => re.test(frontType(c)))?.[0] ?? "other")),
  },
  rarity: {
    order: [["mythic", "Míticas"], ["rare", "Raras"], ["uncommon", "Infrecuentes"], ["common", "Comunes"], ["special", "Especiales"], ["token", "Fichas"]],
    of: (c) => (c.isToken ? "token" : ["mythic", "rare", "uncommon", "common"].includes(c.rarity ?? "") ? c.rarity! : "special"),
  },
  cmc: {
    order: [["0", "Coste 0"], ["1", "Coste 1"], ["2", "Coste 2"], ["3", "Coste 3"], ["4", "Coste 4"], ["5", "Coste 5"], ["6", "Coste 6"], ["7", "Coste 7+"], ["land", "Tierras"], ["token", "Fichas"]],
    of: (c) => (c.isToken ? "token" : isLand(c) ? "land" : String(Math.min(7, Math.floor(c.cmc)))),
  },
  none: { order: [["all", "Todas"]], of: () => "all" },
};

const byName = (a: CollectionEntry, b: CollectionEntry) => a.card.name.localeCompare(b.card.name, "en");
/** Las cartas sin precio van siempre al final */
const byPrice = (dir: 1 | -1) => (a: CollectionEntry, b: CollectionEntry) =>
  (a.unitCents == null ? 1 : 0) - (b.unitCents == null ? 1 : 0) || dir * ((a.unitCents ?? 0) - (b.unitCents ?? 0)) || byName(a, b);

const SORTS: Record<SortMode, (a: CollectionEntry, b: CollectionEntry) => number> = {
  cmc: (a, b) => a.card.cmc - b.card.cmc || byName(a, b),
  name: byName,
  price: byPrice(-1),
  "price-asc": byPrice(1),
  number: (a, b) => a.card.setCode.localeCompare(b.card.setCode) || collectorOrder(a.card.collectorNumber) - collectorOrder(b.card.collectorNumber),
};

export interface EntryGroup {
  key: string;
  label: string;
  entries: CollectionEntry[];
  /** copias, no cartas distintas */
  count: number;
}

/** Entradas por grupos en su orden fijo, cada grupo ordenado; los grupos vacíos no salen */
export function groupEntries(entries: CollectionEntry[], mode: GroupMode, sort: SortMode): EntryGroup[] {
  const def = GROUPS[mode];
  const buckets = new Map<string, CollectionEntry[]>(def.order.map(([k]) => [k, []]));
  for (const e of entries) buckets.get(def.of(e.card))?.push(e);
  return def.order
    .map(([key, label]) => {
      const list = (buckets.get(key) ?? []).sort(SORTS[sort] ?? SORTS.cmc);
      return { key, label, entries: list, count: list.reduce((s, e) => s + e.quantity, 0) };
    })
    .filter((g) => g.entries.length > 0);
}

/** Cifras de la cabecera */
export function collectionStats(lines: CollectionLine[]) {
  const sum = (list: CollectionLine[], f: (l: CollectionLine) => number) => list.reduce((s, l) => s + f(l), 0);
  const cards = lines.filter((l) => !l.card.isToken);
  return {
    cards: sum(cards, (l) => l.quantity),
    tokens: sum(lines.filter((l) => l.card.isToken), (l) => l.quantity),
    distinct: new Set(cards.map((l) => l.card.oracleId)).size,
    foil: sum(lines.filter((l) => l.finish !== "normal"), (l) => l.quantity),
    valueCents: sum(lines, (l) => (unitPrice(l) ?? 0) * l.quantity),
    paidCents: sum(lines, (l) => l.paidCents ?? 0),
  };
}
