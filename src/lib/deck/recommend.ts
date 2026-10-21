import { ROLE_LABEL, evaluateCard, topReasons, type CardEvaluation } from "./roles";
import type { Color, Deck, DeckCard, DeckEntry, Swap } from "./types";

/**
 * Cambios recomendados: por cada carta nueva, qué carta del mazo sale y por qué.
 *
 * - El mazo sigue en 100: cada cambio es una carta por otra, y las tierras se cambian por tierras.
 * - Nunca sale el comandante ni lo marcado como "no tocar"; lo marcado como "candidata a salir"
 *   sale antes.
 * - Una carta nueva solo entra si tiene mejor nota que la que sale (con un margen), si es legal en
 *   Commander, si está dentro de la identidad de color y si no está ya en el mazo.
 * - Las mejores cartas nuevas eligen primero.
 */

/** Diferencia mínima de nota para proponer un cambio */
export const SWAP_MARGIN = 3;
/** Si no hay nada del mismo papel, solo se cambia por algo claramente peor */
export const FALLBACK_MARGIN = 8;
/** Lo que se resta a una "candidata a salir" para que salga antes */
export const CUT_CANDIDATE_PENALTY = 15;
/** Básicas que se dejan como mínimo de cada tipo (las buscan Cultivate, Farseek, las fetch…) */
export const MIN_BASICS_PER_TYPE = 2;

export interface Rejection {
  card: DeckCard;
  reason: string;
}

export interface Recommendation {
  swaps: Swap[];
  /** no pueden entrar: fuera de la identidad, no legales, fichas o repetidas */
  rejected: Rejection[];
  /** podrían entrar, pero no mejoran ninguna carta del mazo */
  notBetter: Rejection[];
}

export interface RecommendInput {
  cards: DeckEntry[];
  pool: DeckEntry[];
  commanderId: string | null;
  protectedIds: string[];
  cutCandidateIds: string[];
}

const COLOR_NAME: Record<Color, string> = { W: "blanco", U: "azul", B: "negro", R: "rojo", G: "verde" };

/** Identidad de color del mazo: la del comandante o, sin comandante, la de todas las cartas */
export function deckIdentity(cards: DeckEntry[], commanderId: string | null): Color[] {
  const commander = cards.find((e) => e.card.oracleId === commanderId)?.card;
  const source = commander ? [commander] : cards.map((e) => e.card);
  const set = new Set<Color>(source.flatMap((c) => c.colorIdentity));
  return (["W", "U", "B", "R", "G"] as Color[]).filter((c) => set.has(c));
}

/** Nombre para enseñar: el español si existe */
export function displayName(card: DeckCard): string {
  return card.nameEs ?? card.name;
}

/** "Mister Fantastic" o "Señor Fantástico (Mister Fantastic)" */
function label(card: DeckCard): string {
  return card.nameEs && card.nameEs !== card.name ? `${card.nameEs} (${card.name})` : card.name;
}

function isBasic(card: DeckCard): boolean {
  return /\bBasic Land\b/.test(card.typeLine);
}

interface Slot {
  card: DeckCard;
  evaluation: CardEvaluation;
  /** nota para decidir qué sale (con la penalización de candidata) */
  keepScore: number;
  candidate: boolean;
}

export function recommendSwaps(input: RecommendInput): Recommendation {
  const identity = deckIdentity(input.cards, input.commanderId);
  const protectedSet = new Set(input.protectedIds);
  const candidateSet = new Set(input.cutCandidateIds);
  const inDeck = new Set(input.cards.map((e) => e.card.oracleId));

  // Un hueco por copia: las básicas repetidas pueden salir de una en una
  const slots: Slot[] = input.cards.flatMap((entry) => {
    if (entry.card.oracleId === input.commanderId || protectedSet.has(entry.card.oracleId)) return [];
    const evaluation = evaluateCard(entry.card, identity);
    const candidate = candidateSet.has(entry.card.oracleId);
    const keepScore = evaluation.score - (candidate ? CUT_CANDIDATE_PENALTY : 0);
    return Array.from({ length: entry.quantity }, () => ({ card: entry.card, evaluation, keepScore, candidate }));
  });
  const basicsLeft = new Map<string, number>();
  for (const s of slots) if (isBasic(s.card)) basicsLeft.set(s.card.oracleId, (basicsLeft.get(s.card.oracleId) ?? 0) + 1);

  const rejected: Rejection[] = [];
  const notBetter: Rejection[] = [];
  const seen = new Set<string>();
  const incoming: Array<{ card: DeckCard; evaluation: CardEvaluation }> = [];
  for (const { card } of input.pool) {
    if (seen.has(card.oracleId)) continue;
    seen.add(card.oracleId);
    const outside = card.colorIdentity.filter((c) => !identity.includes(c));
    if (card.isToken) rejected.push({ card, reason: "es una ficha" });
    else if (!card.legalCommander) rejected.push({ card, reason: "no es legal en Commander" });
    else if (outside.length > 0) rejected.push({ card, reason: `fuera de la identidad de color del comandante (${outside.map((c) => COLOR_NAME[c]).join(", ")})` });
    else if (inDeck.has(card.oracleId) && !isBasic(card)) rejected.push({ card, reason: "ya está en el mazo" });
    else incoming.push({ card, evaluation: evaluateCard(card, identity) });
  }
  incoming.sort((a, b) => b.evaluation.score - a.evaluation.score);

  const used = new Set<Slot>();
  const swaps: Swap[] = [];
  const assign = (card: DeckCard, evaluation: CardEvaluation, out: Slot) => {
    used.add(out);
    if (isBasic(out.card)) basicsLeft.set(out.card.oracleId, (basicsLeft.get(out.card.oracleId) ?? 1) - 1);
    swaps.push({ outId: out.card.oracleId, inId: card.oracleId, reason: swapReason(card, evaluation, out), source: "auto" });
  };
  // 1.ª pasada: cada carta nueva contra las de su mismo papel (un barrido sale por otro barrido)
  const leftover: typeof incoming = [];
  for (const item of incoming) {
    const out = item.evaluation.role === "land" ? pickLand(slots, used, basicsLeft, item.evaluation) : pickSameRole(slots, used, item.evaluation);
    if (out) assign(item.card, item.evaluation, out);
    else leftover.push(item);
  }
  // 2.ª pasada: lo que queda, contra candidatas a salir o cartas claramente peores de otro papel
  for (const { card, evaluation } of leftover) {
    const out = evaluation.role === "land" ? null : pickFallback(slots, used, evaluation);
    if (out) assign(card, evaluation, out);
    else notBetter.push({ card, reason: notBetterReason(slots, used, evaluation) });
  }
  // en el orden de las cartas nuevas, de mejor a peor
  const order = new Map(incoming.map((item, i) => [item.card.oracleId, i]));
  swaps.sort((a, b) => (order.get(a.inId) ?? 0) - (order.get(b.inId) ?? 0));
  return { swaps, rejected, notBetter };
}

function pickLand(slots: Slot[], used: Set<Slot>, basicsLeft: Map<string, number>, incoming: CardEvaluation): Slot | null {
  const options = slots.filter((s) => {
    if (used.has(s) || s.evaluation.role !== "land") return false;
    if (s.evaluation.isBasicLand && (basicsLeft.get(s.card.oracleId) ?? 0) <= MIN_BASICS_PER_TYPE) return false;
    return s.keepScore + SWAP_MARGIN <= incoming.score;
  });
  // La más floja; entre básicas, una de un color que da la nueva y del tipo del que quedan más
  options.sort((a, b) => {
    if (a.keepScore !== b.keepScore) return a.keepScore - b.keepScore;
    const sharesA = Number(a.evaluation.landColors.some((c) => incoming.landColors.includes(c)));
    const sharesB = Number(b.evaluation.landColors.some((c) => incoming.landColors.includes(c)));
    if (sharesA !== sharesB) return sharesB - sharesA;
    return (basicsLeft.get(b.card.oracleId) ?? 0) - (basicsLeft.get(a.card.oracleId) ?? 0);
  });
  return options[0] ?? null;
}

/** La más floja primero; a igual nota, la más cara */
const byKeepScore = (a: Slot, b: Slot) => a.keepScore - b.keepScore || b.card.cmc - a.card.cmc;

function pickSameRole(slots: Slot[], used: Set<Slot>, incoming: CardEvaluation): Slot | null {
  return (
    slots
      .filter((s) => !used.has(s) && s.evaluation.role === incoming.role && s.keepScore + SWAP_MARGIN <= incoming.score)
      .sort(byKeepScore)[0] ?? null
  );
}

function pickFallback(slots: Slot[], used: Set<Slot>, incoming: CardEvaluation): Slot | null {
  return (
    slots
      .filter(
        (s) =>
          !used.has(s) &&
          s.evaluation.role !== "land" &&
          (s.candidate || s.keepScore + FALLBACK_MARGIN <= incoming.score) &&
          s.keepScore + SWAP_MARGIN <= incoming.score,
      )
      .sort(byKeepScore)[0] ?? null
  );
}

function swapReason(incoming: DeckCard, evaluation: CardEvaluation, out: Slot): string {
  const pros = topReasons(evaluation, 2, "pros");
  const cons = topReasons(out.evaluation, 2, "cons");
  const outWhy = [...(out.candidate ? ["estaba en tu lista de candidatas a salir"] : []), ...cons];
  const sameRole = evaluation.role === out.evaluation.role;
  return (
    `Entra ${label(incoming)} (${ROLE_LABEL[evaluation.role]}, nota ${evaluation.score}${pros.length ? `: ${pros.join(", ")}` : ""}). ` +
    `Sale ${label(out.card)} (${ROLE_LABEL[out.evaluation.role]}, nota ${out.evaluation.score}` +
    `${outWhy.length ? `: ${outWhy.join(", ")}` : sameRole ? ": la más floja de su papel" : ""}).`
  );
}

function notBetterReason(slots: Slot[], used: Set<Slot>, evaluation: CardEvaluation): string {
  const sameRole = slots
    .filter((s) => !used.has(s) && s.evaluation.role === evaluation.role)
    .sort((a, b) => a.keepScore - b.keepScore)[0];
  if (!sameRole) return `no hay ninguna carta de ${ROLE_LABEL[evaluation.role]} que mejore (nota ${evaluation.score})`;
  return `no mejora lo que hay: la carta de ${ROLE_LABEL[evaluation.role]} más floja que puede salir es ${label(sameRole.card)} (nota ${sameRole.keepScore}) y esta tiene ${evaluation.score}`;
}

/** Aplica los cambios: salen del mazo, entran desde el pool. El mazo sigue con las mismas cartas. */
export function applySwaps(deck: Deck, swaps: Swap[], now = new Date()): Deck {
  const cards = deck.cards.map((e) => ({ ...e }));
  const pool = deck.pool.map((e) => ({ ...e }));
  for (const swap of swaps) {
    const out = cards.find((e) => e.card.oracleId === swap.outId);
    const inPool = pool.find((e) => e.card.oracleId === swap.inId);
    if (!out || !inPool) continue;
    out.quantity -= 1;
    inPool.quantity -= 1;
    const existing = cards.find((e) => e.card.oracleId === swap.inId);
    if (existing) existing.quantity += 1;
    else cards.push({ card: inPool.card, quantity: 1 });
  }
  return {
    ...deck,
    cards: cards.filter((e) => e.quantity > 0),
    pool: pool.filter((e) => e.quantity > 0),
    swaps: deck.swaps.filter((s) => !swaps.includes(s)),
    updatedAt: now.toISOString(),
  };
}

export function deckSize(entries: DeckEntry[]): number {
  return entries.reduce((sum, e) => sum + e.quantity, 0);
}

/** Problemas del mazo: tamaño, identidad de color y copias repetidas */
export function validateDeck(deck: Deck): string[] {
  const problems: string[] = [];
  const size = deckSize(deck.cards);
  if (size !== 100) problems.push(`El mazo tiene ${size} cartas: en Commander son 100 (comandante incluido)`);
  if (!deck.commanderId) problems.push("Elige el comandante");
  const identity = deckIdentity(deck.cards, deck.commanderId);
  for (const { card, quantity } of deck.cards) {
    const outside = card.colorIdentity.filter((c) => !identity.includes(c));
    if (deck.commanderId && outside.length > 0) problems.push(`${label(card)} está fuera de la identidad de color`);
    if (quantity > 1 && !isBasic(card) && !/a deck can have any number of cards named/i.test(card.oracleText)) {
      problems.push(`${label(card)} está ${quantity} veces: en Commander solo puede haber una`);
    }
  }
  return problems;
}
