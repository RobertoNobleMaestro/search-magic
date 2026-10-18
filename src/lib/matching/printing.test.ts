import { describe, expect, it } from "vitest";
import type { PrintingCandidate } from "@/lib/data/types";
import { choosePrinting, type PrintingHints } from "./printing";

/** Impresión normal de una edición; el id es también el número de coleccionista */
function candidate(id: string, extra: Partial<PrintingCandidate> = {}): PrintingCandidate {
  return {
    scryfallId: id,
    collectorNumber: id,
    finishes: ["nonfoil", "foil"],
    borderColor: "black",
    frameEffects: [],
    promoTypes: [],
    fullArt: false,
    promo: false,
    ...extra,
  };
}

function hints(extra: Partial<PrintingHints> = {}): PrintingHints {
  return { finish: "nonfoil", finishKnown: false, tags: [], ...extra };
}

const normal = candidate("100");
const borderless = candidate("300", { borderColor: "borderless", frameEffects: ["inverted"] });
const showcase = candidate("250", { frameEffects: ["showcase", "legendary"] });
const extended = candidate("320", { frameEffects: ["extendedart"] });
const foilOnly = candidate("400", { finishes: ["foil"], promoTypes: ["textured"], frameEffects: ["showcase"] });

describe("choosePrinting", () => {
  it("sin candidatas no hay impresión", () => {
    expect(choosePrinting([], hints())).toBeNull();
  });

  it("el número de coleccionista manda", () => {
    expect(choosePrinting([normal, borderless], hints({ collectorNumber: "300", tags: ["showcase"] }))).toEqual({
      scryfallId: "300",
      guessed: false,
    });
    expect(choosePrinting([candidate("63")], hints({ collectorNumber: "063" }))?.scryfallId).toBe("63");
  });

  it("un número con un acabado imposible es una suposición", () => {
    expect(choosePrinting([normal, foilOnly], hints({ collectorNumber: "400", finishKnown: true }))).toEqual({
      scryfallId: "400",
      guessed: true,
    });
  });

  it("un número que no existe en la edición deja elegir por las demás pistas", () => {
    expect(choosePrinting([normal, borderless], hints({ collectorNumber: "999" }))).toEqual({ scryfallId: "100", guessed: true });
  });

  it("la única impresión de la edición no es una suposición", () => {
    expect(choosePrinting([borderless], hints())).toEqual({ scryfallId: "300", guessed: false });
  });

  it("descarta las impresiones que no existen en el acabado del listado", () => {
    expect(choosePrinting([showcase, foilOnly], hints({ tags: ["showcase"], finishKnown: true }))).toEqual({
      scryfallId: "250",
      guessed: false,
    });
    // Con el "nonfoil" por defecto, descartar las solo foil ya es suponer
    expect(choosePrinting([showcase, foilOnly], hints({ tags: ["showcase"] }))).toEqual({ scryfallId: "250", guessed: true });
  });

  it("ignora un acabado que no existe en la edición", () => {
    expect(choosePrinting([normal, borderless], hints({ finish: "etched", finishKnown: true }))).toEqual({
      scryfallId: "100",
      guessed: true,
    });
  });

  it("elige por las variantes del título", () => {
    const pool = [normal, borderless, showcase, extended];
    expect(choosePrinting(pool, hints({ tags: ["borderless"] }))?.scryfallId).toBe("300");
    expect(choosePrinting(pool, hints({ tags: ["showcase"] }))?.scryfallId).toBe("250");
    expect(choosePrinting(pool, hints({ tags: ["extendedart"] }))?.scryfallId).toBe("320");
  });

  it("si la variante no existe en la edición, no elige ninguna", () => {
    expect(choosePrinting([normal, showcase], hints({ tags: ["borderless"] }))).toBeNull();
  });

  it("sin variantes en el título elige la única impresión normal", () => {
    expect(choosePrinting([normal, borderless, showcase, extended], hints())).toEqual({ scryfallId: "100", guessed: true });
  });

  it("con dos impresiones normales no elige, salvo que solo una venga sin promo_types", () => {
    expect(choosePrinting([normal, candidate("101")], hints())).toBeNull();
    const starter = candidate("700", { promoTypes: ["starterdeck"] });
    expect(choosePrinting([normal, starter], hints())).toEqual({ scryfallId: "100", guessed: true });
  });

  it("las promos de presentación se reconocen por promo_types", () => {
    const prerelease = candidate("107s", { promo: true, promoTypes: ["prerelease", "datestamped"] });
    const promoPack = candidate("107p", { promo: true, promoTypes: ["promopack", "stamped"] });
    expect(choosePrinting([prerelease, promoPack], hints({ tags: ["prerelease"] }))?.scryfallId).toBe("107s");
    expect(choosePrinting([prerelease, promoPack], hints({ tags: ["promo"] }))).toBeNull();
  });

  it("el marco grabado cuadra con el acabado etched", () => {
    const etched = candidate("500", { finishes: ["etched"], frameEffects: ["etched"] });
    expect(choosePrinting([normal, etched], hints({ finish: "etched", finishKnown: true }))?.scryfallId).toBe("500");
  });

  it("con marco retro y sin el marco en el catálogo, no elige entre varias", () => {
    expect(choosePrinting([normal, candidate("401")], hints({ tags: ["retro"] }))).toBeNull();
    expect(choosePrinting([normal], hints({ tags: ["retro"] }))).toEqual({ scryfallId: "100", guessed: true });
  });

  it("con el marco en el catálogo, retro elige la impresión de marco antiguo", () => {
    const modern = candidate("100", { frame: "2015" });
    const retro = candidate("401", { frame: "1997" });
    expect(choosePrinting([modern, retro], hints({ tags: ["retro"] }))).toEqual({ scryfallId: "401", guessed: false });
    expect(choosePrinting([modern, candidate("402", { frame: "1993" })], hints({ tags: ["retro"] }))?.scryfallId).toBe("402");
    // Ninguna de marco antiguo: el título pide algo que esta edición no tiene
    expect(choosePrinting([modern, candidate("101", { frame: "2003" })], hints({ tags: ["retro"] }))).toBeNull();
  });
});
