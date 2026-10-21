import { describe, expect, it } from "vitest";
import fixture from "./fixtures/cuatro-invencibles.json";
import { cardRoles, evaluateCard, topReasons } from "./roles";
import type { Color, DeckCard, DeckEntry } from "./types";

// Cartas reales del mazo «Los 4 invencibles» y de sus mejoras (datos de Scryfall)
const ALL = [...fixture.deck.cards, ...fixture.upgrade.cards] as DeckEntry[];
const IDENTITY: Color[] = ["W", "U", "R", "G"];

function card(name: string): DeckCard {
  const found = ALL.find((e) => e.card.name === name)?.card;
  if (!found) throw new Error(`No está en el fixture: ${name}`);
  return found;
}

describe("cardRoles", () => {
  it.each([
    ["Sol Ring", "ramp"],
    ["Bloom Tender", "ramp"],
    ["Farseek", "ramp"],
    ["Valeria Richards, Precocious", "ramp"],
    ["Whirlwind of Thought", "draw"],
    ["Path to Exile", "removal"],
    ["Annie Joins Up", "removal"],
    ["Supreme Verdict", "wipe"],
    ["Promise of Loyalty", "wipe"],
    ["Nova Flame", "wipe"],
    ["Dovin's Veto", "counter"],
    ["Lightning Greaves", "protection"],
    ["Rhythm of the Wild", "protection"],
    ["Eladamri's Call", "draw"],
    ["Hallowed Fountain", "land"],
  ])("%s → %s", (name, role) => {
    expect(cardRoles(card(name))[0]).toBe(role);
  });

  it("Eladamri's Call también es tutor y Galactus también es criatura", () => {
    expect(cardRoles(card("Eladamri's Call"))).toContain("tutor");
    expect(cardRoles(card("Galactus, Devourer of Worlds"))).toContain("threat");
  });

  it("el cementerio rival no es eliminación", () => {
    expect(cardRoles(card("Negative Zone Portal"))).not.toContain("removal");
  });
});

describe("evaluateCard", () => {
  const score = (name: string) => evaluateCard(card(name), IDENTITY).score;
  const reasons = (name: string) => evaluateCard(card(name), IDENTITY).parts.map((p) => p.reason);

  it("premia lo que dispara al comienzo del combate tras un hechizo que no es criatura", () => {
    expect(reasons("Mister Fantastic")).toContain("dispara al comienzo del combate si lanzaste un hechizo que no es criatura");
  });

  it("los hechizos de los rivales no cuentan como recompensa", () => {
    expect(reasons("Dovin's Veto")).not.toContain("recompensa lanzar hechizos que no son criatura");
    expect(reasons("The Queen of Dale")).not.toContain("recompensa lanzar hechizos que no son criatura");
  });

  it("castiga lo que rompe la propia mesa, lo caro y lo que regala cartas", () => {
    expect(reasons("Ultimate Nullification")).toEqual(
      expect.arrayContaining(["barrido que también rompe tu mesa", "obliga a sacrificar una criatura legendaria"]),
    );
    expect(reasons("Galactus, Devourer of Worlds")).toContain("cara: 10 de maná");
    expect(reasons("Genesis Ultimatum")).toContain("difícil de pagar: 7 símbolos de color");
    expect(reasons("Cut a Deal")).toContain("también da cartas a los rivales");
    expect(reasons("Negative Zone Portal")).toContain("depende de lanzar una moneda");
  });

  it("ordena las tierras: fetch y shock por encima de básicas, lentas por debajo", () => {
    expect(score("Scalding Tarn")).toBeGreaterThan(score("Hallowed Fountain"));
    expect(score("Hallowed Fountain")).toBeGreaterThan(score("Plains"));
    expect(score("Plains")).toBeGreaterThan(score("Evolving Wilds"));
    expect(score("Jetmir's Garden")).toBeGreaterThan(score("Plains"));
  });

  it("los colores de una fetch son los de lo que busca", () => {
    expect(evaluateCard(card("Scalding Tarn"), IDENTITY).landColors.sort()).toEqual(["R", "U"]);
    expect(evaluateCard(card("Command Tower"), IDENTITY).landColors).toEqual(IDENTITY);
  });

  it("topReasons da los motivos de más peso", () => {
    const top = topReasons(evaluateCard(card("Ultimate Nullification"), IDENTITY), 2, "cons");
    expect(top).toEqual(["barrido que también rompe tu mesa", "obliga a sacrificar una criatura legendaria"]);
  });
});
