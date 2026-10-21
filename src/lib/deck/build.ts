import { normalizeName } from "@/lib/normalize";
import { identifierFor, identifierKey } from "./manabox";
import type { Color, Deck, DeckCard, DeckEntry, ImportRow } from "./types";

/** Respuesta de POST /api/mazo/cartas */
export interface CardsResponse {
  cards: Array<{ key: string; card: DeckCard }>;
  notFound: string[];
}

/** Pide a la API los datos de las líneas importadas */
export async function fetchCards(rows: ImportRow[]): Promise<CardsResponse> {
  const identifiers = rows.map(identifierFor);
  const unique = [...new Map(identifiers.map((id) => [identifierKey(id), id])).values()];
  const res = await fetch("/api/mazo/cartas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiers: unique }),
  });
  const data = (await res.json()) as CardsResponse & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data;
}

/** Junta líneas y cartas: suma cantidades de la misma carta y separa las fichas */
export function buildEntries(rows: ImportRow[], response: CardsResponse): { cards: DeckEntry[]; tokens: DeckEntry[]; missing: string[] } {
  const byKey = new Map(response.cards.map((c) => [c.key, c.card]));
  const entries: DeckEntry[] = [];
  const missing: string[] = [];
  for (const row of rows) {
    const card = byKey.get(identifierKey(identifierFor(row)));
    if (!card) {
      missing.push(`${row.quantity} ${row.name}`);
      continue;
    }
    const existing = entries.find((e) => e.card.oracleId === card.oracleId);
    if (existing) existing.quantity += row.quantity;
    else entries.push({ card, quantity: row.quantity });
  }
  return { cards: entries.filter((e) => !e.card.isToken), tokens: entries.filter((e) => e.card.isToken), missing };
}

const ORDER: Color[] = ["W", "U", "B", "R", "G"];

/** Comandante propuesto: la criatura legendaria con más colores, si solo hay una así */
export function guessCommander(cards: DeckEntry[]): string | null {
  const legends = cards.filter((e) => /\bLegendary\b/.test(e.card.typeLine) && /\bCreature\b/.test(e.card.typeLine));
  const widest = Math.max(0, ...legends.map((e) => e.card.colorIdentity.length));
  const top = legends.filter((e) => e.card.colorIdentity.length === widest);
  return top.length === 1 ? top[0]!.card.oracleId : null;
}

export function sortColors(colors: Color[]): Color[] {
  return ORDER.filter((c) => colors.includes(c));
}

export function newDeck(name: string, cards: DeckEntry[], tokens: DeckEntry[], now = new Date()): Deck {
  return {
    version: 1,
    id: `mazo-${now.getTime().toString(36)}`,
    name,
    commanderId: guessCommander(cards),
    cards,
    tokens,
    pool: [],
    protectedIds: [],
    cutCandidateIds: [],
    swaps: [],
    dismissedIds: [],
    importedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/** Añade cartas nuevas al pool (sumando cantidades si ya estaban) */
export function addToPool(deck: Deck, entries: DeckEntry[], now = new Date()): Deck {
  const pool = deck.pool.map((e) => ({ ...e }));
  for (const entry of entries) {
    const existing = pool.find((e) => e.card.oracleId === entry.card.oracleId);
    if (existing) existing.quantity += entry.quantity;
    else pool.push({ ...entry });
  }
  return { ...deck, pool, swaps: [], updatedAt: now.toISOString() };
}

/**
 * Cartas del mazo por nombre (en inglés o en español, una por línea): para marcar de golpe
 * las que no se tocan o las candidatas a salir.
 */
export function matchNames(entries: DeckEntry[], text: string): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const name = normalizeName(raw.replace(/^\s*\d+\s*x?\s+/, ""));
    if (!name) continue;
    const names = (card: DeckCard) => [card.name, card.nameEs ?? "", ...card.name.split(" // ")].map(normalizeName);
    const words = name.split(" ").length;
    // primero el nombre exacto ("Mister Fantastic"); si no, el comienzo ("Valeria Richards")
    const hit =
      entries.find(({ card }) => names(card).includes(name)) ??
      entries.find(({ card }) => names(card).some((n) => n.split(" ").slice(0, words).join(" ") === name));
    if (hit) ids.push(hit.card.oracleId);
    else unknown.push(raw.trim());
  }
  return { ids: [...new Set(ids)], unknown };
}

/** Lista para importar en ManaBox, Moxfield o Archidekt: "1 Sol Ring (MSC) 248" */
export function exportList(deck: Deck): string {
  const line = (e: DeckEntry) => `${e.quantity} ${e.card.name} (${e.card.setCode.toUpperCase()}) ${e.card.collectorNumber}`;
  const commander = deck.cards.filter((e) => e.card.oracleId === deck.commanderId);
  const rest = deck.cards.filter((e) => e.card.oracleId !== deck.commanderId).sort((a, b) => a.card.name.localeCompare(b.card.name));
  return [...(commander.length ? ["Commander", ...commander.map(line), "", "Deck"] : []), ...rest.map(line)].join("\n");
}
