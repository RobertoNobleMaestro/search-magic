import { describe, expect, it } from "vitest";
import fixture from "@/lib/data/fixtures/scryfall-sample.json";
import { createMockRepository } from "@/lib/data/mock";
import type { AnyMatchResult, CatalogLookup, MatchMethod, MatchResult, NormalizedListing, PrintingCandidate } from "@/lib/data/types";
import {
  AMBIGUOUS_NAME_CONFIDENCE,
  EXACT_EN_CONFIDENCE,
  EXACT_ES_CONFIDENCE,
  PRINTING_GUESSED_PENALTY,
  PRINTING_UNRESOLVED_PENALTY,
  TRIGRAM_MAX_CONFIDENCE,
  TRIGRAM_MIN_CONFIDENCE,
  enrichListing,
  matchListing,
  normalizeTitle,
} from "./index";

// Ejemplos realistas de títulos de tiendas españolas, emparejados contra la muestra real de
// Scryfall de src/lib/data/fixtures (16 cartas). Hay que sustituirlos o ampliarlos con títulos
// reales cuando se conozca la lista de tiendas.

function listing(rawTitle: string, extra: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    storeId: "tienda-prueba",
    externalId: rawTitle,
    rawTitle,
    url: "https://tienda-prueba.example.com/producto",
    priceCents: 150,
    currency: "EUR",
    inStock: true,
    scrapedAt: "2026-10-18T10:00:00.000Z",
    ...extra,
  };
}

function card(nameEn: string) {
  const found = fixture.cards.find((c) => c.nameEn === nameEn);
  if (!found) throw new Error(`No está en la muestra: ${nameEn}`);
  return found;
}

const oracleOf = (nameEn: string) => card(nameEn).oracleId;

/** El resultado como carta suelta (falla si es un producto sellado) */
function single(result: AnyMatchResult | null): MatchResult | null {
  if (result?.kind === "sealed") throw new Error(`Se esperaba una carta suelta: ${JSON.stringify(result)}`);
  return result;
}

function printingOf(nameEn: string, setCode: string, collectorNumber: string): string {
  const found = card(nameEn).printings.find((p) => p.setCode === setCode && p.collectorNumber === collectorNumber);
  if (!found) throw new Error(`No está en la muestra: ${nameEn} ${setCode} #${collectorNumber}`);
  return found.scryfallId;
}

interface Expected {
  card: string;
  method: MatchMethod;
  /** [edición, número], o null si la impresión queda sin identificar */
  printing: [string, string] | null;
  /** valor exacto, o [mín, máx] en los trigram */
  confidence: number | [number, number];
}

const EN = EXACT_EN_CONFIDENCE;
const ES = EXACT_ES_CONFIDENCE;
const GUESS = PRINTING_GUESSED_PENALTY;
const NONE = PRINTING_UNRESOLVED_PENALTY;
const TRIGRAM: [number, number] = [TRIGRAM_MIN_CONFIDENCE - NONE, TRIGRAM_MAX_CONFIDENCE];
const FABLE = "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki";

const en = (name: string, printing: [string, string] | null, confidence: number): Expected => ({
  card: name,
  method: "exact_en",
  printing,
  confidence,
});
const es = (name: string, printing: [string, string] | null, confidence: number): Expected => ({
  card: name,
  method: "exact_es",
  printing,
  confidence,
});
const trigram = (name: string, printing: [string, string] | null): Expected => ({
  card: name,
  method: "trigram",
  printing,
  confidence: TRIGRAM,
});

const CASES: Array<[string, Expected | null]> = [
  // Nombre exacto en inglés; edición por código o por nombre
  ["Lightning Bolt (SOS) NM", en("Lightning Bolt", ["sos", "113"], EN - GUESS)],
  ["Lightning Bolt [SOS] #332 - Foil", en("Lightning Bolt", ["sos", "332"], EN)],
  ["Lightning Bolt | Secrets of Strixhaven | EX | Inglés", en("Lightning Bolt", ["sos", "113"], EN - GUESS)],
  ["Lightning Bolt (SOS) | Arte extendido", en("Lightning Bolt", ["sos", "332"], EN)],
  ["Lightning Bolt (FDC)", en("Lightning Bolt", ["fdc", "163"], EN)],
  ["Lightning Bolt (M11) NM", en("Lightning Bolt", null, EN - NONE)], // M11 no está en la muestra
  ["Counterspell - SLD - 7120 - Inglés", en("Counterspell", ["sld", "7120"], EN)],
  ["Counterspell (Foundations Commander) Near Mint", en("Counterspell", ["fdc", "61"], EN)],
  ["Counterspell - MH2 - 267 - Inglés", en("Counterspell", null, EN - NONE)], // sin impresión de MH2 en la muestra
  ["Sol Ring (C21) #263", en("Sol Ring", null, EN - NONE)],
  ["Sol Ring - Secret Lair Drop - #2807 - NM", en("Sol Ring", ["sld", "2807"], EN)],
  ["Thoughtseize [2XM] Foil Etched", en("Thoughtseize", ["2xm", "109"], EN - GUESS)], // 2XM no tiene etched
  ["Thoughtseize (SLD) Foil Etched", en("Thoughtseize", ["sld", "1117"], EN)],
  ["Thoughtseize - Double Masters - Borderless", en("Thoughtseize", ["2xm", "344"], EN)],
  ["Ragavan, Nimble Pilferer (MH2) - Showcase - Inglés - NM", en("Ragavan, Nimble Pilferer", null, EN - NONE)],
  ["Ragavan, Nimble Pilferer (MH2) Borderless", en("Ragavan, Nimble Pilferer", ["mh2", "315"], EN)],
  ["Ragavan, Nimble Pilferer [MUL] Showcase", en("Ragavan, Nimble Pilferer", ["mul", "21"], EN - GUESS)],
  ["MH2 | Ragavan, Nimble Pilferer | Borderless", en("Ragavan, Nimble Pilferer", ["mh2", "315"], EN)],
  ["Sheoldred, the Apocalypse (DMU) #107 NM", en("Sheoldred, the Apocalypse", ["dmu", "107"], EN)],
  ["Sheoldred, the Apocalypse (DMU) Prerelease Foil", en("Sheoldred, the Apocalypse", ["pdmu", "107s"], EN)],
  ["Llanowar Elves (Dominaria) JAP", en("Llanowar Elves", null, EN - NONE)],
  ["Llanowar Elves | Foundations Jumpstart | NM", en("Llanowar Elves", ["j25", "149"], EN)],
  ["Giant Growth (Bloomburrow) - Inglés", en("Giant Growth", ["blb", "393"], EN)],
  ["Birds of Paradise (BLC) Borderless", en("Birds of Paradise", ["blc", "81"], EN)],
  ["Brainstorm (SOS) - Extended Art", en("Brainstorm", ["sos", "317"], EN)],
  ["Dark Ritual (MSC)", en("Dark Ritual", ["msc", "793"], EN)],
  ["Serra Angel (P30H) Foil", en("Serra Angel", null, EN - NONE)], // dos promos sin número que las distinga
  ["Serra Angel (P30H) #1★ Foil", en("Serra Angel", ["p30h", "1★"], EN)],
  ["Serra Angel (PLST) #DMR-271", en("Serra Angel", ["plst", "DMR-271"], EN)],

  // Cartas de varias caras y cartas partidas
  ["Fable of the Mirror-Breaker // Reflection of Kiki-Jiki (NEO) Borderless", en(FABLE, null, EN - NONE)],
  ["Fable of the Mirror-Breaker (NEO) - Showcase", en(FABLE, ["neo", "357"], EN)],
  ["Fable of the Mirror-Breaker / Reflection of Kiki-Jiki - Kamigawa: Neon Dynasty", en(FABLE, ["neo", "141"], EN - GUESS)],
  ["Fire/Ice", en("Fire // Ice", null, EN - NONE)],
  ["Fire // Ice [MH2] Etched", en("Fire // Ice", ["mh2", "290"], EN)],
  ["Fire / Ice - UMA - 225", en("Fire // Ice", ["uma", "225"], EN)],
  ["Fuego // Hielo", es("Fire // Ice", null, ES - NONE)],
  ["Fuego // Hielo (Apocalypse) - Español - LP", es("Fire // Ice", ["apc", "128"], ES)],
  ["Fábula del rompe espejos (NEO)", es(FABLE, ["neo", "141"], ES - GUESS)],

  // Nombre exacto en español
  ["Relámpago [SOS] - Español - Foil", es("Lightning Bolt", ["sos", "113"], ES - GUESS)],
  ["Relámpago [M11] - Español - Foil", es("Lightning Bolt", null, ES - NONE)],
  ["Contrahechizo (FDC) - Castellano", es("Counterspell", ["fdc", "61"], ES)],
  ["Anillo solar - Commander 2021 - Near Mint", es("Sol Ring", null, ES - NONE)],
  ["Ritual siniestro (MSC) EX", es("Dark Ritual", ["msc", "793"], ES)],
  ["Espadas en guadañas | FRC | Buena", es("Swords to Plowshares", ["frc", "37"], ES)],
  ["Inspiración súbita (SOS) #317 - ESP", es("Brainstorm", ["sos", "317"], ES)],
  ["Confiscar pensamientos [TSR] Japonés", es("Thoughtseize", ["tsr", "334"], ES)],
  ["Aves del Paraíso (Edición Básica 2010) Jugada", es("Birds of Paradise", null, ES - NONE)],
  // En LTR hay tres borderless foil (póster, promo de bundle y numerada): no se adivina
  ["El Anillo Único (LTR) Borderless Foil", es("The One Ring", null, ES - NONE)],
  ["El Anillo Único (LTR) Showcase", es("The One Ring", ["ltr", "697"], ES - GUESS)],
  ["Sheoldred, el Apocalipsis (DMU) Showcase", es("Sheoldred, the Apocalypse", ["dmu", "290"], ES - GUESS)],
  ["Elfos de Llanowar | J25 | Inglés | NM", es("Llanowar Elves", ["j25", "149"], ES)],
  ["J25 - Elfos de Llanowar - Castellano", es("Llanowar Elves", ["j25", "149"], ES)],
  ["Ángel de Serra (FDN) - Francés", es("Serra Angel", ["fdn", "147"], ES - GUESS)],
  ["Crecimiento gigante (BLB) - Italiano", es("Giant Growth", ["blb", "393"], ES)],
  ["Ragavan, ratero hábil (MH2) #138", es("Ragavan, Nimble Pilferer", ["mh2", "138"], ES)],

  // Erratas: trigram
  ["Lightnin Bolt (SOS)", trigram("Lightning Bolt", ["sos", "113"])],
  ["Counterspel - FDC", trigram("Counterspell", ["fdc", "61"])],
  ["Brainstorn [SOS] #52", trigram("Brainstorm", ["sos", "52"])],
  ["Relampgo (SOS) Foil", trigram("Lightning Bolt", ["sos", "113"])],
  ["Swords to Plowshare (FRC)", trigram("Swords to Plowshares", ["frc", "37"])],
  ["Birds of Paradice - Ravnica Remastered - Borderless", trigram("Birds of Paradise", ["rvr", "432"])],
  ["Crecimiento gigantesco (FDN)", trigram("Giant Growth", ["fdn", "223"])],
  ["Elfos Llanowar (J25)", trigram("Llanowar Elves", ["j25", "149"])],
  ["Sheoldred Apocalypse Prerelease Promo FOIL", trigram("Sheoldred, the Apocalypse", null)],

  // Cartas que no están en la muestra, también con nombres parecidos a los de otra carta
  ["Black Lotus (LEA) NM", null],
  ["Tarmogoyf [MH1] - Inglés", null],
  ["Lightning Helix (RVR)", null],
  ["Lightning Axe - Inglés", null],
  ["Serra Avenger (TSP)", null],

  // No son cartas sueltas (el sellado se prueba en sealed.test.ts): Bloomburrow no tiene sobres de draft
  ["Booster de Draft Bloomburrow", null],
  ["Lote 20 tierras básicas", null],
  ["Fundas Dragon Shield Matte (100)", null],
  ["Carpeta 9 bolsillos", null],
  ["Mazo Commander precon", null],
  ["Playmat Bloomburrow - Ultra Pro", null],
  ["Deck Box Ultimate Guard Boulder 100+", null],
  ["4x Lightning Bolt (SOS)", null],
  ["Ficha de Soldado 1/1 (FDN)", null],
];

describe("matchListing", () => {
  const catalog = createMockRepository();

  it.each(CASES)("%s", async (rawTitle, expected) => {
    const result = await matchListing(listing(rawTitle), catalog);
    if (!expected) {
      expect(result).toBeNull();
      return;
    }
    expect(result).toMatchObject({
      kind: "single",
      oracleId: oracleOf(expected.card),
      scryfallId: expected.printing ? printingOf(expected.card, ...expected.printing) : null,
      method: expected.method,
    });
    const confidence = result?.confidence ?? Number.NaN;
    if (Array.isArray(expected.confidence)) {
      expect(confidence).toBeGreaterThanOrEqual(expected.confidence[0]);
      expect(confidence).toBeLessThanOrEqual(expected.confidence[1]);
    } else {
      expect(confidence).toBeCloseTo(expected.confidence, 5);
    }
  });

  it("deja para revisión manual las erratas con letras cambiadas de sitio", async () => {
    // Similitud 0,53, en la franja de "Lightning Axe" frente a "Lightning Bolt": no se puede aceptar
    expect(await matchListing(listing("Thoughtsieze (TSR)"), catalog)).toBeNull();
  });

  it("la confianza del trigram crece con la similitud", async () => {
    const close = await matchListing(listing("Swords to Plowshare (FRC)"), catalog); // 0,86
    const far = await matchListing(listing("Relampgo (FRC)"), catalog); // 0,58
    expect(close?.confidence).toBeGreaterThan(far?.confidence ?? 1);
  });

  it("solo consulta el trigram sin nombre exacto, y como mucho dos veces", async () => {
    const base = createMockRepository();
    const queries: string[] = [];
    const spy: CatalogLookup = {
      ...base,
      findByTrigram: (nameNorm, minSimilarity, limit) => {
        queries.push(nameNorm);
        return base.findByTrigram(nameNorm, minSimilarity, limit);
      },
    };
    await matchListing(listing("Relámpago (SOS) - Foil"), spy);
    expect(queries).toEqual([]);
    // Carta de dos caras que no está en la muestra: nombre completo y primera cara
    await matchListing(listing("Delver of Secrets // Insectile Aberration (ISD)"), spy);
    expect(queries).toEqual(["delver of secrets insectile aberration", "delver of secrets"]);
  });
});

describe("matchListing: datos del adaptador", () => {
  const catalog = createMockRepository();

  it("usa la edición y el acabado de la variante cuando el título no los trae", async () => {
    const result = await matchListing(listing("Thoughtseize", { setHint: "Secret Lair Drop", finish: "etched" }), catalog);
    expect(result).toMatchObject({ scryfallId: printingOf("Thoughtseize", "sld", "1117"), confidence: EN });
  });

  it("la edición del adaptador va antes que la del título", async () => {
    const result = single(await matchListing(listing("Relámpago (FDC)", { setHint: "SOS" }), catalog));
    expect(result?.scryfallId).toBe(printingOf("Lightning Bolt", "sos", "113"));
  });

  it("reconoce la edición dentro de un texto compuesto", async () => {
    const setHint = "Edición: Marvel Super Heroes Commander (MSC)";
    const result = single(await matchListing(listing("Dark Ritual", { setHint }), catalog));
    expect(result?.scryfallId).toBe(printingOf("Dark Ritual", "msc", "793"));
  });
});

describe("matchListing: correcciones manuales", () => {
  const base = createMockRepository();

  function withOverride(titleNorm: string, override: AnyMatchResult) {
    const lookups: Array<[string, string]> = [];
    const catalog: CatalogLookup = {
      ...base,
      getOverride: async (storeId, key) => {
        lookups.push([storeId, key]);
        return key === titleNorm ? override : null;
      },
    };
    return { catalog, lookups };
  }

  const thoughtseize: MatchResult = {
    oracleId: oracleOf("Thoughtseize"),
    scryfallId: printingOf("Thoughtseize", "tsr", "334"),
    confidence: 1,
    method: "override",
  };

  it("devuelve la corrección tal cual, buscada por tienda y título normalizado", async () => {
    const { catalog, lookups } = withOverride("thoughtsieze", thoughtseize);
    expect(await matchListing(listing("Thoughtsieze (TSR) NM"), catalog)).toEqual(thoughtseize);
    expect(lookups).toEqual([["tienda-prueba", normalizeTitle("Thoughtsieze (TSR) NM")]]);
  });

  it("si la corrección no fija la impresión, la busca con la edición del título", async () => {
    const { catalog } = withOverride("thoughtsieze", { ...thoughtseize, scryfallId: null });
    expect(await matchListing(listing("Thoughtsieze (TSR) NM"), catalog)).toEqual(thoughtseize);
  });

  it("rescata una carta que el filtro toma por producto", async () => {
    const boosterTutor: MatchResult = {
      oracleId: "00000000-0000-4000-8000-000000000001",
      scryfallId: null,
      confidence: 1,
      method: "override",
    };
    const { catalog } = withOverride("booster tutor", boosterTutor);
    expect(await matchListing(listing("Booster Tutor (UST)"), base)).toBeNull();
    expect(await matchListing(listing("Booster Tutor (UST)"), catalog)).toEqual(boosterTutor);
  });

  it("devuelve tal cual una corrección de producto sellado", async () => {
    const box: AnyMatchResult = {
      kind: "sealed",
      sealedProductId: "d575bd23-ebd6-586e-af7b-04924db4f1c3",
      confidence: 1,
      method: "override",
    };
    const { catalog } = withOverride("caja bloomburrow edicion limitada", box);
    expect(await matchListing(listing("Caja Bloomburrow Edición Limitada (ES)"), catalog)).toEqual(box);
  });
});

describe("matchListing: títulos de las tiendas online", () => {
  const catalog = createMockRepository();
  const U = "⁣"; // separador invisible de los títulos de Shopify

  const cases: Array<[string, Partial<NormalizedListing>, string, [string, string] | null, MatchMethod]> = [
    // El Duelista / Universe TCG (Shopify)
    [`Lightning Bolt${U} - Secrets of Strixhaven${U} (Uncommon)${U} [332]`, {}, "Lightning Bolt", ["sos", "332"], "exact_en"],
    ["Counterspell - Foundations Commander (Uncommon) [FDC-61]", {}, "Counterspell", ["fdc", "61"], "exact_en"],
    // Subedición que el catálogo no conoce: se prueba lo de antes de los dos puntos
    ["Lightning Bolt - Secrets of Strixhaven: Extras (Uncommon) [XSOS-332]", {}, "Lightning Bolt", ["sos", "332"], "exact_en"],
    ["Sheoldred, the Apocalypse - Dominaria United (Mythic) [DMU-107]", {}, "Sheoldred, the Apocalypse", ["dmu", "107"], "exact_en"],
    // El Rincón de Magic, Rebellion, Itaca: bilingües con " / "
    ["RELÁMPAGO / LIGHTNING BOLT (SECRETS OF STRIXHAVEN)", {}, "Lightning Bolt", ["sos", "113"], "exact_en"],
    ["Contrahechizo / Counterspell", {}, "Counterspell", null, "exact_en"],
    ["Counterspell / Contrahechizo", { setHint: "Foundations Commander" }, "Counterspell", ["fdc", "61"], "exact_en"],
    ["Ritual siniestro / Dark Ritual", { setHint: "MSC" }, "Dark Ritual", ["msc", "793"], "exact_en"],
    ["Inspiración súbita / Brainstorm", { setHint: "SOS", collectorNumber: "317" }, "Brainstorm", ["sos", "317"], "exact_en"],
    // Un lado que no está en el catálogo no impide emparejar con el otro
    ["Relámpago / Lightnig Bolt", {}, "Lightning Bolt", null, "exact_es"],
    // Una carta partida escrita con una sola barra sigue siendo una carta partida
    ["Fire / Ice", { setHint: "Apocalypse" }, "Fire // Ice", ["apc", "128"], "exact_en"],
    // MTG Canarias: solo el nombre; edición e idioma en atributos
    ["Relámpago", { setHint: "Secrets of Strixhaven", language: "es" }, "Lightning Bolt", ["sos", "113"], "exact_es"],
    ["Elfos de Llanowar", { setHint: "Foundations Jumpstart" }, "Llanowar Elves", ["j25", "149"], "exact_es"],
    // Disfrutalo TCG: nombre y estado
    ["Contrahechizo NM", { setHint: "FDC" }, "Counterspell", ["fdc", "61"], "exact_es"],
  ];

  it.each(cases)("%s", async (rawTitle, extra, cardName, printing, method) => {
    const result = single(await matchListing(listing(rawTitle, extra), catalog));
    expect(result).toMatchObject({
      kind: "single",
      oracleId: oracleOf(cardName),
      scryfallId: printing ? printingOf(cardName, ...printing) : null,
      method,
    });
  });

  it("si los dos lados de un título bilingüe son cartas distintas, no empareja", async () => {
    expect(await matchListing(listing("Relámpago / Counterspell"), catalog)).toBeNull();
  });

  it("el número de un campo estructurado manda sobre el del título", async () => {
    const result = single(await matchListing(listing("Lightning Bolt (SOS) #113", { collectorNumber: "332" }), catalog));
    expect(result?.scryfallId).toBe(printingOf("Lightning Bolt", "sos", "332"));
  });

  it("los títulos bilingües prueban el trigram por cada lado", async () => {
    const base = createMockRepository();
    const queries: string[] = [];
    const spy: CatalogLookup = {
      ...base,
      findByTrigram: (nameNorm, minSimilarity, limit) => {
        queries.push(nameNorm);
        return base.findByTrigram(nameNorm, minSimilarity, limit);
      },
    };
    const result = await matchListing(listing("Relampgo / Lightnin Bolt"), spy);
    expect(result).toMatchObject({ oracleId: oracleOf("Lightning Bolt"), method: "trigram" });
    expect(queries).toEqual(["relampgo"]);
  });
});

describe("matchListing: idProduct de Cardmarket", () => {
  const catalog = createMockRepository();

  it.each([
    [882058, "Lightning Bolt", "sos", "113"],
    [910434, "Counterspell", "fdc", "61"],
    [671359, "Sheoldred, the Apocalypse", "dmu", "107"],
    [607390, FABLE, "neo", "357"],
  ] as const)("carta %i", async (cardmarketId, cardName, setCode, number) => {
    // El título del CSV no cuenta: manda el id
    const result = await matchListing(listing("título cualquiera del CSV", { cardmarketId }), catalog);
    expect(result).toEqual({
      kind: "single",
      oracleId: oracleOf(cardName),
      scryfallId: printingOf(cardName, setCode, number),
      confidence: 1,
      method: "cardmarket_id",
    });
  });

  it.each([
    [774109, "d575bd23-ebd6-586e-af7b-04924db4f1c3"], // Bloomburrow Play Booster Box
    [657394, "d01631ef-a954-5feb-b8cc-fdba0d46a80a"], // Dominaria United Draft Booster Pack
    [698914, "8b6a4f8e-bd03-56af-9ee0-1f2d4884d509"], // LTR Prerelease Pack
    [776446, "2ff3f72e-205a-5323-9d7e-e2dd856f3bb2"], // Duskmourn Nightmare Bundle
  ])("producto sellado %i", async (cardmarketId, sealedProductId) => {
    const result = await matchListing(listing("Lightning Bolt (SOS)", { cardmarketId }), catalog);
    expect(result).toEqual({ kind: "sealed", sealedProductId, confidence: 1, method: "cardmarket_id" });
  });

  it("con kind sellado mira primero el sellado", async () => {
    const result = await matchListing(listing("x", { cardmarketId: 774109, kind: "sealed" }), catalog);
    expect(result).toMatchObject({ kind: "sealed", sealedProductId: "d575bd23-ebd6-586e-af7b-04924db4f1c3" });
  });

  it("un id que no está en el catálogo se queda sin emparejar, aunque el título sea claro", async () => {
    expect(await matchListing(listing("Lightning Bolt (SOS) NM", { cardmarketId: 999999999 }), catalog)).toBeNull();
    expect(await matchListing(listing("Bloomburrow Play Booster Box", { cardmarketId: 1 }), catalog)).toBeNull();
  });

  it("no consulta correcciones ni nombres con un id de Cardmarket", async () => {
    const calls: string[] = [];
    const spy: CatalogLookup = {
      ...catalog,
      getOverride: async () => {
        calls.push("getOverride");
        return null;
      },
      findByExactName: async () => {
        calls.push("findByExactName");
        return [];
      },
    };
    await matchListing(listing("Lightning Bolt", { cardmarketId: 999999999 }), spy);
    expect(calls).toEqual([]);
  });
});

describe("matchListing: tipo que indica el adaptador", () => {
  const base = createMockRepository();
  const calls: string[] = [];
  const spy: CatalogLookup = {
    ...base,
    findByExactName: (nameNorm, lang) => {
      calls.push("findByExactName");
      return base.findByExactName(nameNorm, lang);
    },
    findSealedProducts: (setCode, opts) => {
      calls.push("findSealedProducts");
      return base.findSealedProducts(setCode, opts);
    },
  };

  it("kind single: solo cartas sueltas", async () => {
    calls.length = 0;
    expect(await matchListing(listing("Bloomburrow Bundle", { kind: "single" }), spy)).toBeNull();
    expect(calls).not.toContain("findSealedProducts");
  });

  it("kind sealed: solo producto sellado", async () => {
    calls.length = 0;
    expect(await matchListing(listing("Lightning Bolt (SOS)", { kind: "sealed" }), spy)).toBeNull();
    expect(calls).not.toContain("findByExactName");
  });

  it("kind sealed con un título sin palabras de producto", async () => {
    const result = await matchListing(listing("Bloomburrow Tin Mouse", { kind: "sealed" }), base);
    expect(result).toMatchObject({ kind: "sealed", sealedProductId: "ed686ac8-f381-5b34-9e58-db558bb57ef7" });
  });

  it("kind single: cartas con palabras de producto en el título (colecciones solo de sueltas)", async () => {
    const titles: Array<[string, string]> = [
      ["Thoughtseize (Promo Pack)", "Thoughtseize"],
      ["Sheoldred, the Apocalypse - Box Topper", "Sheoldred, the Apocalypse"],
      ["Lightning Bolt - Bundle Promo", "Lightning Bolt"],
      ["Serra Angel - Welcome Deck 2017", "Serra Angel"],
      ["Sol Ring - Commander Deck", "Sol Ring"],
    ];
    for (const [title, name] of titles) {
      expect(await matchListing(listing(title), base), title).toBeNull();
      const enriched = enrichListing(listing(title, { kind: "single" }));
      expect(enriched.kind).toBe("single");
      expect(single(await matchListing(enriched, base)), title).toMatchObject({ oracleId: oracleOf(name) });
    }
  });

  it("los accesorios no se emparejan aunque el adaptador diga otra cosa", async () => {
    expect(await matchListing(listing("Fundas Dragon Shield Matte (100)", { kind: "sealed" }), base)).toBeNull();
    expect(await matchListing(listing("Lote 4x Lightning Bolt", { kind: "single" }), base)).toBeNull();
  });
});

describe("matchListing: nombre exacto de varias cartas", () => {
  // Como si "Relámpago" también fuera la traducción de Counterspell
  const base = createMockRepository();
  const catalog: CatalogLookup = {
    ...base,
    findByExactName: async (nameNorm, lang) =>
      nameNorm === "relampago" && lang === "es"
        ? [
            { oracleId: oracleOf("Lightning Bolt"), name: "Relámpago" },
            { oracleId: oracleOf("Counterspell"), name: "Relámpago" },
          ]
        : base.findByExactName(nameNorm, lang),
  };

  it("sin edición se queda sin emparejar", async () => {
    expect(await matchListing(listing("Relámpago - Español"), catalog)).toBeNull();
  });

  it("si las dos cartas están en la edición, se queda sin emparejar", async () => {
    expect(await matchListing(listing("Relámpago (FDC)"), catalog)).toBeNull();
  });

  it("en un título bilingüe, el lado ambiguo no tumba al que identifica la carta", async () => {
    for (const title of ["Relámpago / Lightning Bolt", "Lightning Bolt / Relámpago"]) {
      expect(single(await matchListing(listing(title), catalog))).toMatchObject({ oracleId: oracleOf("Lightning Bolt"), method: "exact_en" });
    }
    // ...siempre que la carta del otro lado esté entre las candidatas del ambiguo
    expect(await matchListing(listing("Relámpago / Serra Angel"), catalog)).toBeNull();
  });

  it("si la edición deja una sola, la acepta con menos confianza", async () => {
    const result = await matchListing(listing("Relámpago (SOS)"), catalog);
    expect(result).toMatchObject({
      oracleId: oracleOf("Lightning Bolt"),
      scryfallId: printingOf("Lightning Bolt", "sos", "113"),
      method: "exact_es",
    });
    expect(result?.confidence).toBeCloseTo(AMBIGUOUS_NAME_CONFIDENCE - GUESS, 5);
  });
});

describe("matchListing: edición de respaldo (lo de antes de los dos puntos)", () => {
  // Como en la BD: el nombre de Cardmarket de Commander 2011 es "Commander"; aquí apunta a fdc
  const base = createMockRepository();
  const eocSolRing: PrintingCandidate = {
    scryfallId: "sol-ring-eoc-57",
    collectorNumber: "57",
    finishes: ["nonfoil", "foil"],
    borderColor: "black",
    frameEffects: [],
    promoTypes: [],
    fullArt: false,
    promo: false,
  };
  const catalog = (knowsEoc: boolean): CatalogLookup => ({
    ...base,
    resolveSet: async (hint) => {
      const key = hint.trim().toLowerCase();
      if (key === "commander") return "fdc";
      if (key === "eoc") return knowsEoc ? "eoc" : null;
      return base.resolveSet(hint);
    },
    findPrintings: async (oracleId, setCode) =>
      setCode === "eoc" ? (oracleId === oracleOf("Sol Ring") ? [eocSolRing] : []) : base.findPrintings(oracleId, setCode),
  });
  const title = "Sol Ring - Commander: Edge of Eternities (Uncommon) [EOC-57]";

  it("el código entre corchetes manda sobre la forma de respaldo", async () => {
    expect(single(await matchListing(listing(title), catalog(true)))).toMatchObject({ scryfallId: "sol-ring-eoc-57" });
  });

  it("con la edición de respaldo, un número que no está en ella no elige impresión", async () => {
    const result = single(await matchListing(listing(title), catalog(false)));
    expect(result).toMatchObject({ oracleId: oracleOf("Sol Ring"), scryfallId: null });
  });
});

describe("normalizeTitle", () => {
  it.each([
    ["Lightning Bolt (M11) NM", "lightning bolt"],
    ["Relámpago [M11] - Español - Foil", "relampago"],
    ["Ragavan, Nimble Pilferer (MH2) - Showcase - Inglés - NM", "ragavan nimble pilferer"],
    [`${FABLE} (NEO) Borderless`, "fable of the mirror breaker reflection of kiki jiki"],
    ["Fuego // Hielo", "fuego hielo"],
    ["Fire/Ice", "fire ice"],
    ["Sol Ring (C21) #263", "sol ring"],
    ["1x Lightning Bolt NM", "lightning bolt"],
    ["Booster de Draft Bloomburrow (ES)", "booster de draft bloomburrow"],
    ["Foil", "foil"],
    ["", ""],
    // Tiendas online (docs/tiendas-online.json)
    ["Eldrazi Ravager⁣ - Modern Horizons 3⁣ (Uncommon)⁣ [5]", "eldrazi ravager"],
    ["Kozilek's Return⁣ - Commander: Modern Horizons 3⁣ (Mythic)⁣ [214]", "kozileks return"],
    ["Dockside Extortionist⁣ - Commander 2019⁣ (Rare)⁣ [24]", "dockside extortionist"],
    ["Prismari, the Inspiration - Secrets of Strixhaven: Extras (Mythic) [XSOS-285]", "prismari the inspiration"],
    ["Super Shredder - Teenage Mutant Ninja Turtles (Mythic) [TMT-83]", "super shredder"],
    ["Multiversal Passage - Marvel's Spider-Man (Rare) [SPM-180]", "multiversal passage"],
    ["BUSCACAMINOS CAMBIAFORMAS / CHANGELING WAYFINDER (LORWYN ECLIPSADO)", "buscacaminos cambiaformas changeling wayfinder"],
    ["AJANI ACOMPAÑANTE FORASTERO / AJANI OUTLAND CHAPERONE (LORWYN ECLIPSADO)", "ajani acompanante forastero ajani outland chaperone"],
    ["FANFARRON DE AXGARD / AXGARD BRAGGART (KALDHEIM)", "fanfarron de axgard axgard braggart"],
    ["Abajo en el valle / Down in the Valley", "abajo en el valle down in the valley"],
    ["Bardo, rey de Valle / Bard, King of Dale", "bardo rey de valle bard king of dale"],
    ["Azog, Ruina de Moria / Azog, Moria´s Ruin", "azog ruina de moria azog morias ruin"],
    ["Gleaming Splendor / Esplendor reluciente", "gleaming splendor esplendor reluciente"],
    ["Smaug the Magnificent / Smaug el Magnífico", "smaug the magnificent smaug el magnifico"],
    ["Bilbo, Thief in the Night / Bilbo, ladrón en la noche", "bilbo thief in the night bilbo ladron en la noche"],
    ["Enfrentamiento decisivo", "enfrentamiento decisivo"],
    ["Captain Kathryn Janeway", "captain kathryn janeway"],
    ["U.S.S. Enterprise-D, Galaxy-Class", "u s s enterprise d galaxy class"],
    ["Camaradería NM", "camaraderia"],
    ["Altar de la progenie NM", "altar de la progenie"],
    ["Pantano (V.2) EX", "pantano"],
  ])("%s → %s", (rawTitle, expected) => {
    expect(normalizeTitle(rawTitle)).toBe(expected);
  });

  it("da la misma clave a todas las ediciones y estados de una carta", () => {
    const titles = ["Lightning Bolt (M11) NM", "Lightning Bolt [SOS] #332 - Foil", "LIGHTNING BOLT | Magic 2011 | EX"];
    expect(new Set(titles.map(normalizeTitle))).toEqual(new Set(["lightning bolt"]));
  });
});

describe("enrichListing", () => {
  it("rellena estado, idioma, acabado y edición a partir del título", () => {
    expect(enrichListing(listing("Relámpago [M11] - Español - Foil - NM"))).toMatchObject({
      condition: "NM",
      language: "es",
      finish: "foil",
      setHint: "M11",
      kind: "single",
    });
  });

  it("no pisa lo que trae el adaptador", () => {
    const input = listing("Relámpago [M11] - Español - Foil - NM", {
      condition: "EX",
      language: "en",
      finish: "nonfoil",
      setHint: "Magic 2011",
      kind: "single",
    });
    expect(enrichListing(input)).toEqual(input);
  });

  it("solo rellena lo que falta", () => {
    const result = enrichListing(listing("Lightning Bolt (SOS) - Japonés - LP", { language: "en" }));
    expect(result).toMatchObject({ language: "en", condition: "LP", setHint: "SOS" });
  });

  it.each([
    [
      "Eldrazi Ravager⁣ - Modern Horizons 3⁣ (Uncommon)⁣ [5]",
      { setHint: "Modern Horizons 3", kind: "single" },
    ],
    [
      "Prismari, the Inspiration - Secrets of Strixhaven: Extras (Mythic) [XSOS-285]",
      { setHint: "Secrets of Strixhaven: Extras", kind: "single" },
    ],
    ["FANFARRON DE AXGARD / AXGARD BRAGGART (KALDHEIM)", { setHint: "KALDHEIM" }],
    ["Camaradería NM", { condition: "NM", kind: "single" }],
    ["Pantano (V.2) EX", { condition: "EX", kind: "single" }],
  ] as const)("tiendas online: %s", (rawTitle, expected) => {
    expect(enrichListing(listing(rawTitle))).toMatchObject(expected);
  });

  it("no rellena el número de coleccionista: ese campo es solo para datos estructurados", () => {
    expect(enrichListing(listing("Lightning Bolt (SOS) #332")).collectorNumber).toBeUndefined();
  });

  it("no añade campos si el título no dice nada", () => {
    const input = listing("Lightning Bolt");
    expect(enrichListing(input)).toStrictEqual(input);
  });

  it("no modifica el listado de entrada", () => {
    const input = listing("Lightning Bolt (SOS) NM");
    const copy = structuredClone(input);
    enrichListing(input);
    expect(input).toStrictEqual(copy);
  });
});
