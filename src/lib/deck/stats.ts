import type { DeckCard, DeckEntry } from "./types";

/** Grupos por tipo, en el orden en que se enseñan */
export const TYPE_GROUPS = [
  { key: "commander", label: "Comandante" },
  { key: "creature", label: "Criaturas" },
  { key: "planeswalker", label: "Planeswalkers" },
  { key: "instant", label: "Instantáneos" },
  { key: "sorcery", label: "Conjuros" },
  { key: "artifact", label: "Artefactos" },
  { key: "enchantment", label: "Encantamientos" },
  { key: "battle", label: "Batallas" },
  { key: "land", label: "Tierras" },
  { key: "other", label: "Otras" },
] as const;

export type TypeGroup = (typeof TYPE_GROUPS)[number]["key"];

/** Grupo de una carta por el tipo de su cara frontal (una criatura artefacto es criatura) */
export function typeGroup(card: DeckCard): TypeGroup {
  const type = card.typeLine.split(" // ")[0] ?? card.typeLine;
  if (/\bLand\b/.test(type)) return "land";
  if (/\bCreature\b/.test(type)) return "creature";
  if (/\bPlaneswalker\b/.test(type)) return "planeswalker";
  if (/\bInstant\b/.test(type)) return "instant";
  if (/\bSorcery\b/.test(type)) return "sorcery";
  if (/\bArtifact\b/.test(type)) return "artifact";
  if (/\bEnchantment\b/.test(type)) return "enchantment";
  if (/\bBattle\b/.test(type)) return "battle";
  return "other";
}

/** Cartas agrupadas por tipo, cada grupo ordenado por coste y nombre */
export function groupByType(entries: DeckEntry[], commanderId: string | null): Array<{ key: TypeGroup; label: string; entries: DeckEntry[]; count: number }> {
  const groups = new Map<TypeGroup, DeckEntry[]>();
  for (const entry of entries) {
    const key = entry.card.oracleId === commanderId ? "commander" : typeGroup(entry.card);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return TYPE_GROUPS.filter((g) => groups.has(g.key)).map((g) => {
    const list = (groups.get(g.key) ?? []).sort((a, b) => a.card.cmc - b.card.cmc || (a.card.nameEs ?? a.card.name).localeCompare(b.card.nameEs ?? b.card.name, "es"));
    return { key: g.key, label: g.label, entries: list, count: list.reduce((s, e) => s + e.quantity, 0) };
  });
}

/** Curva de maná de lo que no es tierra: cuántas cartas cuestan 0, 1, …, 6 y 7 o más */
export function manaCurve(entries: DeckEntry[]): number[] {
  const curve = Array.from({ length: 8 }, () => 0);
  for (const { card, quantity } of entries) {
    if (typeGroup(card) === "land") continue;
    curve[Math.min(7, Math.floor(card.cmc))]! += quantity;
  }
  return curve;
}

export function averageCmc(entries: DeckEntry[]): number {
  const spells = entries.filter((e) => typeGroup(e.card) !== "land");
  const count = spells.reduce((s, e) => s + e.quantity, 0);
  return count ? spells.reduce((s, e) => s + e.card.cmc * e.quantity, 0) / count : 0;
}

/** Precio total en céntimos (lo que no tiene precio no suma) y cuántas cartas no tienen */
export function totalPrice(entries: DeckEntry[]): { cents: number; missing: number } {
  let cents = 0;
  let missing = 0;
  for (const { card, quantity } of entries) {
    if (card.priceEurCents == null) missing += quantity;
    else cents += card.priceEurCents * quantity;
  }
  return { cents, missing };
}
