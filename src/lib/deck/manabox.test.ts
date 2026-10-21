import { describe, expect, it } from "vitest";
import { identifierFor, looksLikeManaBoxCsv, parseCardList, parseDeckText, parseManaBoxCsv } from "./manabox";

const CSV = [
  "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Signed,Condition,Language,Proxy,Purchase price currency,Added",
  'Sol Ring,MSC,"Marvel Super Heroes Commander",248,normal,uncommon,1,111,2d0e4f2c-0b5b-4b6e-8d43-6b5f3c2a1a11,0.5,false,false,false,near_mint,en,false,EUR,2026-10-18',
  'Forest,MSH,"Marvel Super Heroes",290,normal,common,5,222,0a6e1b9c-2f3d-4c5e-9a8b-7c6d5e4f3a22,0,false,false,false,near_mint,es,false,EUR,2026-10-18',
  '"Fire // Ice",DMR,"Dominaria Remastered",215,normal,uncommon,1,333,,0,false,false,false,near_mint,en,false,EUR,2026-10-18',
].join("\r\n");

describe("parseManaBoxCsv", () => {
  it("lee nombre, cantidad, Scryfall ID, edición, número e idioma", () => {
    const { rows, errors } = parseManaBoxCsv(CSV);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      name: "Sol Ring",
      quantity: 1,
      scryfallId: "2d0e4f2c-0b5b-4b6e-8d43-6b5f3c2a1a11",
      setCode: "msc",
      collectorNumber: "248",
      language: "en",
    });
    // la cantidad manda: una línea pueden ser varias cartas
    expect(rows[1]).toMatchObject({ name: "Forest", quantity: 5, language: "es" });
    // comillas con coma dentro y sin Scryfall ID
    expect(rows[2]).toMatchObject({ name: "Fire // Ice", setCode: "dmr", collectorNumber: "215" });
    expect(rows[2]?.scryfallId).toBeUndefined();
  });

  it("reconoce el CSV aunque lleve BOM", () => {
    expect(looksLikeManaBoxCsv(`﻿${CSV}`)).toBe(true);
    expect(parseManaBoxCsv(`﻿${CSV}`).rows).toHaveLength(3);
  });

  it("avisa de las líneas sin cantidad", () => {
    const { rows, errors } = parseManaBoxCsv("Name,Quantity\nSol Ring,\nArcane Signet,1");
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });
});

describe("parseCardList", () => {
  it("entiende cantidades, x, edición y número", () => {
    const { rows, errors } = parseCardList("1 Sol Ring\n2x Island\nCommand Tower\n1 Arcane Signet (MSC) 249\n\n# notas\nDeck");
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { name: "Sol Ring", quantity: 1 },
      { name: "Island", quantity: 2 },
      { name: "Command Tower", quantity: 1 },
      { name: "Arcane Signet", quantity: 1, setCode: "msc", collectorNumber: "249" },
    ]);
  });

  it("parseDeckText elige el formato", () => {
    expect(parseDeckText(CSV).rows).toHaveLength(3);
    expect(parseDeckText("1 Sol Ring").rows).toEqual([{ name: "Sol Ring", quantity: 1 }]);
  });
});

describe("identifierFor", () => {
  it("prefiere el id, luego edición y número, luego el nombre", () => {
    expect(identifierFor({ name: "A", quantity: 1, scryfallId: "x", setCode: "s", collectorNumber: "1" })).toEqual({ id: "x" });
    expect(identifierFor({ name: "A", quantity: 1, setCode: "s", collectorNumber: "1" })).toEqual({ set: "s", collector_number: "1" });
    expect(identifierFor({ name: "A", quantity: 1 })).toEqual({ name: "A" });
  });
});
