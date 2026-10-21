import { describe, expect, it } from "vitest";
import fixture from "./fixtures/cuatro-invencibles.json";
import { MIN_BASICS_PER_TYPE, applySwaps, deckIdentity, deckSize, recommendSwaps, validateDeck } from "./recommend";
import { evaluateCard } from "./roles";
import type { Deck, DeckEntry } from "./types";

// El mazo real «Los 4 invencibles» (100 cartas, Mister Fantastic de comandante) y sus 39 mejoras
const CARDS = fixture.deck.cards as DeckEntry[];
const POOL = fixture.upgrade.cards as DeckEntry[];
const id = (name: string) => {
  const found = [...CARDS, ...POOL].find((e) => e.card.name === name)?.card.oracleId;
  if (!found) throw new Error(`No está en el fixture: ${name}`);
  return found;
};
const COMMANDER = id("Mister Fantastic");
const PROTECTED = ["Sol Ring", "Arcane Signet", "Lightning Greaves", "Path to Exile", "Three Visits", "Farseek", "Cultivate", "Whirlwind of Thought", "Cosmic Crucible", "Annie Joins Up"].map(id);
const CANDIDATES = ["Ultimate Nullification", "Promise of Loyalty", "Tragic Arrogance", "Cleansing Nova", "Negative Zone Portal", "Mind's Dilation", "Galactus, Devourer of Worlds", "Evolving Wilds", "Terramorphic Expanse"].map(id);

function deck(): Deck {
  return {
    version: 1,
    id: "test",
    name: "Los 4 invencibles",
    commanderId: COMMANDER,
    cards: CARDS,
    tokens: [],
    pool: POOL,
    protectedIds: PROTECTED,
    cutCandidateIds: CANDIDATES,
    swaps: [],
    dismissedIds: [],
    importedAt: "2026-10-21T10:00:00.000Z",
    updatedAt: "2026-10-21T10:00:00.000Z",
  };
}

const recommendation = recommendSwaps({ cards: CARDS, pool: POOL, commanderId: COMMANDER, protectedIds: PROTECTED, cutCandidateIds: CANDIDATES });

describe("recommendSwaps con el mazo real", () => {
  it("la identidad es la del comandante: blanco, azul, rojo y verde", () => {
    expect(deckIdentity(CARDS, COMMANDER)).toEqual(["W", "U", "R", "G"]);
  });

  it("rechaza lo que está fuera de la identidad de color", () => {
    expect(recommendation.rejected.map((r) => r.card.name)).toEqual(["Sunken Hollow"]);
    expect(recommendation.rejected[0]?.reason).toContain("negro");
  });

  it("nunca saca el comandante ni lo protegido", () => {
    const outs = new Set(recommendation.swaps.map((s) => s.outId));
    expect(outs.has(COMMANDER)).toBe(false);
    for (const p of PROTECTED) expect(outs.has(p)).toBe(false);
  });

  it("las tierras se cambian por tierras y cada carta nueva entra una sola vez", () => {
    const isLand = (oracleId: string) => [...CARDS, ...POOL].find((e) => e.card.oracleId === oracleId)!.card.typeLine.includes("Land");
    for (const s of recommendation.swaps) expect(isLand(s.inId)).toBe(isLand(s.outId));
    expect(new Set(recommendation.swaps.map((s) => s.inId)).size).toBe(recommendation.swaps.length);
  });

  it("un barrido sale por otro barrido: Supreme Verdict entra por Ultimate Nullification", () => {
    expect(recommendation.swaps).toContainEqual(
      expect.objectContaining({ inId: id("Supreme Verdict"), outId: id("Ultimate Nullification") }),
    );
  });

  it("las tierras lentas salen antes que las básicas, y quedan básicas de cada tipo", () => {
    const outs = recommendation.swaps.map((s) => s.outId);
    expect(outs).toEqual(expect.arrayContaining([id("Evolving Wilds"), id("Terramorphic Expanse")]));
    for (const basic of ["Plains", "Island", "Mountain", "Forest"]) {
      const before = CARDS.find((e) => e.card.name === basic)!.quantity;
      const removed = outs.filter((o) => o === id(basic)).length;
      expect(before - removed).toBeGreaterThanOrEqual(Math.min(before, MIN_BASICS_PER_TYPE));
    }
  });

  it("cada cambio mejora la nota de lo que sale y explica por qué", () => {
    const identity = deckIdentity(CARDS, COMMANDER);
    const score = (oracleId: string) => evaluateCard([...CARDS, ...POOL].find((e) => e.card.oracleId === oracleId)!.card, identity).score;
    for (const s of recommendation.swaps) {
      const candidate = CANDIDATES.includes(s.outId);
      expect(score(s.inId)).toBeGreaterThan(score(s.outId) - (candidate ? 15 : 0));
      expect(s.reason).toMatch(/^Entra .+ Sale .+/);
    }
  });

  it("aplicar los cambios deja el mazo en 100 cartas válidas", () => {
    const before = deck();
    expect(validateDeck(before)).toEqual([]);
    const after = applySwaps(before, recommendation.swaps);
    expect(deckSize(after.cards)).toBe(100);
    expect(validateDeck(after)).toEqual([]);
    expect(after.pool.length).toBe(POOL.length - recommendation.swaps.length);
    for (const s of recommendation.swaps) expect(after.cards.some((e) => e.card.oracleId === s.inId)).toBe(true);
  });
});
