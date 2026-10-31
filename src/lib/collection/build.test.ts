import { describe, expect, it } from "vitest";
import { parseManaBoxCsv } from "@/lib/deck/manabox";
import type { DeckCard } from "@/lib/deck/types";
import { buildLines, collectionEntries, collectionStats, groupEntries, unitPrice } from "./build";

function card(over: Partial<DeckCard> & Pick<DeckCard, "scryfallId" | "name">): DeckCard {
  return {
    oracleId: `oracle-${over.name}`,
    nameEs: null,
    setCode: "fra",
    collectorNumber: "1",
    typeLine: "Instant",
    manaCost: "{U}",
    cmc: 1,
    colors: ["U"],
    colorIdentity: ["U"],
    oracleText: "",
    keywords: [],
    imageUrl: null,
    imageUrlEs: null,
    priceEurCents: 10,
    priceEurFoilCents: 30,
    legalCommander: true,
    isToken: false,
    ...over,
  };
}

const ID = {
  solve: "7beaa8c9-1a2c-4c88-b579-91e371d8d9e3",
  plains1: "a4eaecb8-066a-4c72-aa5d-5ed0614ba537",
  plains2: "57999b70-74c6-415a-aef8-3afc546e7557",
  thopter: "bfd6132f-c96b-4ce0-ac4d-c46356afc767",
};

// Trozo del CSV de ManaBox con las repeticiones típicas: la misma carta en normal y en foil,
// dos ilustraciones de la misma tierra y una línea repetida
const CSV = [
  "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price",
  `Solve for Disappointment,FRA,Reality Fracture,67,foil,common,1,1,${ID.solve},0.13`,
  `Solve for Disappointment,FRA,Reality Fracture,67,normal,common,1,1,${ID.solve},0.02`,
  `Solve for Disappointment,FRA,Reality Fracture,67,normal,common,2,1,${ID.solve},0.04`,
  `Plains,FRA,Reality Fracture,281,normal,common,1,2,${ID.plains1},0.12`,
  `Plains,FRA,Reality Fracture,383,normal,common,1,3,${ID.plains2},0.69`,
  `Thopter,TFRA,Reality Fracture Tokens,14,normal,common,13,4,${ID.thopter},`,
].join("\n");

const CARDS = [
  card({ scryfallId: ID.solve, name: "Solve for Disappointment", collectorNumber: "67" }),
  card({ scryfallId: ID.plains1, oracleId: "oracle-plains", name: "Plains", collectorNumber: "281", typeLine: "Basic Land — Plains", colors: [], cmc: 0, priceEurCents: 12 }),
  card({ scryfallId: ID.plains2, oracleId: "oracle-plains", name: "Plains", collectorNumber: "383", typeLine: "Basic Land — Plains", colors: [], cmc: 0, priceEurCents: 69 }),
  card({ scryfallId: ID.thopter, name: "Thopter", setCode: "tfra", typeLine: "Token Artifact Creature — Thopter", colors: [], isToken: true, priceEurCents: null, priceEurFoilCents: null }),
];
const RESPONSE = { cards: CARDS.map((c) => ({ key: `id:${c.scryfallId}`, card: c })), notFound: [] };

describe("buildLines", () => {
  const { rows } = parseManaBoxCsv(CSV);
  const { lines, missing } = buildLines(rows, RESPONSE);

  it("suma la misma impresión con el mismo acabado y separa normal y foil", () => {
    expect(missing).toEqual([]);
    const solve = lines.filter((l) => l.card.scryfallId === ID.solve);
    expect(solve.map((l) => [l.finish, l.quantity])).toEqual([
      ["foil", 1],
      ["normal", 3],
    ]);
    // lo pagado por las 3 normales: 0,02 + 2 × 0,04
    expect(solve.find((l) => l.finish === "normal")?.paidCents).toBe(10);
  });

  it("avisa de las cartas que no ha encontrado", () => {
    const partial = buildLines(rows, { cards: RESPONSE.cards.slice(0, 1), notFound: [] });
    expect(partial.missing).toEqual(["1 Plains", "1 Plains", "13 Thopter"]);
  });

  it("junta las repetidas en una sola carta con su cantidad, foils y versiones", () => {
    const entries = collectionEntries(lines);
    expect(entries).toHaveLength(3);
    const solve = entries.find((e) => e.card.name === "Solve for Disappointment")!;
    // el precio de mercado por copia es el de la copia que más vale (la foil)
    expect(solve).toMatchObject({ quantity: 4, foil: 1, versions: 1, valueCents: 30 + 3 * 10, unitCents: 30 });
    const plains = entries.find((e) => e.card.name === "Plains")!;
    expect(plains).toMatchObject({ quantity: 2, versions: 2, valueCents: 12 + 69 });
    // se enseña la impresión de número más bajo
    expect(plains.card.collectorNumber).toBe("281");
    // la ficha no tiene precio
    expect(entries.find((e) => e.card.isToken)?.valueCents).toBeNull();
  });

  it("con split cada impresión va aparte (pero normal y foil siguen juntas)", () => {
    const entries = collectionEntries(lines, true);
    expect(entries.filter((e) => e.card.name === "Plains")).toHaveLength(2);
    expect(entries.filter((e) => e.card.name === "Solve for Disappointment")).toHaveLength(1);
  });

  it("agrupa por color con tierras y fichas al final", () => {
    const groups = groupEntries(collectionEntries(lines), "color", "cmc");
    expect(groups.map((g) => [g.key, g.count])).toEqual([
      ["U", 4],
      ["L", 2],
      ["T", 13],
    ]);
  });

  it("ordena por precio de mercado en los dos sentidos, con las que no tienen precio al final", () => {
    const names = (sort: "price" | "price-asc") => groupEntries(collectionEntries(lines, true), "none", sort)[0]!.entries.map((e) => `${e.card.name} ${e.unitCents}`);
    expect(names("price")).toEqual(["Plains 69", "Solve for Disappointment 30", "Plains 12", "Thopter null"]);
    expect(names("price-asc")).toEqual(["Plains 12", "Solve for Disappointment 30", "Plains 69", "Thopter null"]);
  });

  it("cuenta cartas, fichas, distintas, foils y valor", () => {
    expect(collectionStats(lines)).toEqual({ cards: 6, tokens: 13, distinct: 2, foil: 1, valueCents: 30 + 30 + 12 + 69, paidCents: 13 + 2 + 8 + 12 + 69 });
  });
});

describe("unitPrice", () => {
  it("usa el precio foil para las foil y, si no hay precio, el de compra", () => {
    const c = card({ scryfallId: "x", name: "X", priceEurCents: 10, priceEurFoilCents: null });
    expect(unitPrice({ card: c, finish: "foil", quantity: 1, paidCents: 5 })).toBe(10);
    expect(unitPrice({ card: { ...c, priceEurCents: null }, finish: "normal", quantity: 2, paidCents: 10 })).toBe(5);
  });
});
