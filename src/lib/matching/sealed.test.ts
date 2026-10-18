import { describe, expect, it } from "vitest";
import sealedFixture from "@/lib/data/fixtures/sealed-sample.json";
import { createMockRepository } from "@/lib/data/mock";
import type { CatalogLookup, ListingKind, MatchMethod, NormalizedListing, SealedCandidate } from "@/lib/data/types";
import {
  SEALED_DEFAULT_CONFIDENCE,
  SEALED_DISCOVERED_PENALTY,
  SEALED_EXACT_CONFIDENCE,
  SEALED_TIEBREAK_CONFIDENCE,
  SEALED_TRIGRAM_MAX_CONFIDENCE,
  SEALED_TRIGRAM_MIN_CONFIDENCE,
  classifyTitle,
  enrichListing,
  matchListing,
  parseSealedTitle,
} from "./index";

// Títulos de producto sellado como los escriben las tiendas españolas (en español y en inglés),
// emparejados contra la muestra real de MTGJSON de src/lib/data/fixtures/sealed-sample.json.

function listing(rawTitle: string, extra: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    storeId: "tienda-prueba",
    externalId: rawTitle,
    rawTitle,
    url: "https://tienda-prueba.example.com/producto",
    priceCents: 15500,
    currency: "EUR",
    inStock: true,
    scrapedAt: "2026-10-18T10:00:00.000Z",
    ...extra,
  };
}

/** sealedProductId de un producto de la muestra, por su nombre en MTGJSON */
function productId(name: string): string {
  const found = sealedFixture.products.find((p) => p.name === name);
  if (!found) throw new Error(`No está en la muestra: ${name}`);
  return found.sealedProductId;
}

const EXACT = SEALED_EXACT_CONFIDENCE;
const DEFAULT = SEALED_DEFAULT_CONFIDENCE;
const TIEBREAK = SEALED_TIEBREAK_CONFIDENCE;
const DISCOVERED = SEALED_DISCOVERED_PENALTY;
const TRIGRAM: [number, number] = [SEALED_TRIGRAM_MIN_CONFIDENCE, SEALED_TRIGRAM_MAX_CONFIDENCE];

type Expected = [product: string, method: MatchMethod, confidence: number | [number, number]];

const CASES: Array<[string, Expected | null]> = [
  // Cajas de sobres: edición por nombre inglés, español, de Cardmarket o código
  ["Caja de sobres de juego Bloomburrow (Español)", ["Bloomburrow Play Booster Box", "exact_es", EXACT]],
  ["Bloomburrow Play Booster Box - ENG", ["Bloomburrow Play Booster Box", "exact_en", EXACT]],
  ["Display Bloomburrow", ["Bloomburrow Play Booster Box", "exact_en", DEFAULT]], // sin subtipo: de juego
  ["Caja de sobres de draft DMU", ["Dominaria United Draft Booster Box", "exact_es", EXACT]],
  ["Magic: The Gathering Foundations - Play Booster Box (36 sobres)", ["Foundations Play Booster Box", "exact_es", EXACT]],
  ["Display 36 sobres de juego Foundations - Castellano", ["Foundations Play Booster Box", "exact_es", EXACT]],
  [
    "Caja de 36 sobres de coleccionista Kamigawa: Dinastía de neón",
    ["Kamigawa Neon Dynasty Collector Booster Box", "exact_es", EXACT],
  ],
  ["Phyrexia: All Will Be One Set Booster Box", ["Phyrexia All Will Be One Set Booster Box", "exact_en", EXACT]],
  ["Duskmourn: House of Horror Collector Booster Box - Inglés", ["Duskmourn House of Horror Collector Booster Box", "exact_en", EXACT]],
  // Nombre corto de la edición: sale de los nombres de producto
  ["Duskmourn Play Booster Box", ["Duskmourn House of Horror Play Booster Box", "exact_en", EXACT - DISCOVERED]],

  // Sobres sueltos: de juego, de draft, de edición, de coleccionista
  ["Sobre de juego Bloomburrow", ["Bloomburrow Play Booster Pack", "exact_es", EXACT]],
  ["Sobre Bloomburrow", ["Bloomburrow Play Booster Pack", "exact_es", DEFAULT]],
  ["Star Trek Play Booster", ["Star Trek Play Booster Pack", "exact_en", EXACT]],
  ["Sobre de juego Star Trek - Inglés", ["Star Trek Play Booster Pack", "exact_es", EXACT]],
  ["Booster de Draft Dominaria Unida", ["Dominaria United Draft Booster Pack", "exact_es", EXACT]],
  ["Sobre Dominaria Unida", ["Dominaria United Draft Booster Pack", "exact_es", DEFAULT]], // sin sobres de juego en DMU
  ["Sobre de edición Dominaria Unida - Español", ["Dominaria United Set Booster Pack", "exact_es", EXACT]],
  ["Modern Horizons 3 Collector Booster Pack", ["Modern Horizons 3 Collector Booster Pack", "exact_en", EXACT]],
  ["Sobre de coleccionista Duskmourn (ES)", ["Duskmourn House of Horror Collector Booster Pack", "exact_es", EXACT - DISCOVERED]],
  ["Lord of the Rings Draft Booster", ["The Lord of the Rings Tales of Middle earth Draft Booster Pack", "exact_en", EXACT - DISCOVERED]],
  // En LTR hay dos de coleccionista: la normal y la Special Edition
  [
    "Sobre de coleccionista El Señor de los Anillos: relatos de la Tierra Media",
    ["The Lord of the Rings Tales of Middle earth Collector Booster Pack", "exact_es", TIEBREAK],
  ],
  [
    "LTR Special Edition Collector Booster",
    ["The Lord of the Rings Tales of Middle earth Special Edition Collector Booster Pack", "exact_en", EXACT],
  ],
  ["Jumpstart Booster LTR", ["The Lord of the Rings Tales of Middle earth Jumpstart Booster Pack", "exact_en", TIEBREAK]],
  ["Theme Booster Kamigawa Neon Dynasty Ninjas", ["Kamigawa Neon Dynasty Theme Booster Ninjas", "exact_en", EXACT]],
  ["Sobre temático Kamigawa: Dinastía de neón - Ninjas", ["Kamigawa Neon Dynasty Theme Booster Ninjas", "exact_es", EXACT]],
  ["Bloomburrow Foil Promo Pack", ["Bloomburrow Foil Promo Pack", "exact_en", EXACT]],
  [
    "Murders at Karlov Manor Collector Booster Sample Pack",
    ["Murders at Karlov Manor Collector Booster Sample Pack", "exact_en", EXACT],
  ],

  // Bundles
  ["Bundle Bloomburrow", ["Bloomburrow Bundle", "exact_en", EXACT]],
  ["Bloomburrow Bundle (EN)", ["Bloomburrow Bundle", "exact_en", EXACT]],
  ["Fat Pack Outlaws of Thunder Junction", ["Outlaws of Thunder Junction Bundle", "exact_en", EXACT]],
  ["Bundle The Hobbit", ["The Hobbit Bundle", "exact_en", DEFAULT]], // no el de regalo
  ["The Hobbit Gift Bundle", ["The Hobbit Gift Bundle", "exact_en", EXACT]],
  ["Bundle de regalo Modern Horizons 3", ["Modern Horizons 3 Gift Bundle", "exact_es", EXACT]],
  ["Nightmare Bundle Duskmourn", ["Duskmourn House of Horror Nightmare Bundle", "exact_en", EXACT - DISCOVERED]],
  ["Phyrexia Compleat Bundle", ["Phyrexia All Will Be One Compleat Bundle", "exact_en", EXACT - DISCOVERED]],
  ["Reality Fracture Bundle", ["Reality Fracture Bundle", "exact_en", DEFAULT]], // no el de Secret Lair
  ["Reality Fracture Secret Lair Bundle", ["Reality Fracture Secret Lair Bundle", "exact_en", EXACT]],

  // Kits de presentación, de inicio, mazos y cajas para empezar
  ["Kit de presentación Pirexia: Todos serán uno", ["Phyrexia All Will Be One Prerelease Pack", "exact_es", EXACT]],
  ["Murders at Karlov Manor Prerelease Pack", ["Murders at Karlov Manor Prerelease Pack", "exact_en", EXACT]],
  ["Pack de presentación The Hobbit (Español)", ["The Hobbit Prerelease Kit", "exact_es", EXACT]],
  ["Kit de inicio Bloomburrow", ["Bloomburrow Starter Kit", "exact_es", EXACT]],
  [
    "Starter Kit El Señor de los Anillos: relatos de la Tierra Media",
    ["The Lord of the Rings Tales of Middle earth Starter Kit", "exact_en", EXACT],
  ],
  ["Foundations Beginner Box", ["Foundations Beginner Box", "exact_en", EXACT]],
  ["Foundations Starter Collection", ["Foundations Starter Collection", "exact_en", EXACT]],
  ["Draft Night Reality Fracture", ["Reality Fracture Draft Night", "exact_en", EXACT]],
  ["Welcome Deck Duskmourn negro", ["Welcome Deck 2024 Black Deck", "exact_en", EXACT - DISCOVERED]],
  ["Mazo de bienvenida Duskmourn - Azul", ["Welcome Deck 2024 Blue Deck", "exact_es", EXACT - DISCOVERED]],

  // Cajas de cajas y canjes de MTGO: solo si el título lo dice
  ["Caja de cajas de sobres de juego Bloomburrow", ["Bloomburrow Play Booster Box Case", "exact_es", EXACT]],
  ["Bloomburrow Play Booster Box Case", ["Bloomburrow Play Booster Box Case", "exact_en", EXACT]],
  ["Bloomburrow MTGO Redemption", ["Bloomburrow MTGO Redemption", "exact_en", EXACT]],

  // Erratas en la edición: trigram sobre el nombre inglés, sin salirse del tipo
  ["Bloomburow Play Booster Box", ["Bloomburrow Play Booster Box", "trigram", TRIGRAM]],
  ["Fundations Bundle", ["Foundations Bundle", "trigram", TRIGRAM]],

  // Ediciones que no están en la muestra
  ["Sobre de juego Aetherdrift", null],
  ["Caja de sobres de juego Final Fantasy", null],
  ["Tarkir Dragonstorm Collector Booster Box", null],
  ["Edge of Eternities Play Booster", null],
  // Mazos Commander: van en su propia edición (BLC), que no está en la muestra de sellado
  ["Mazo Commander Bloomburrow", null],
  // Productos sin edición, ambiguos o que la edición no tiene
  ["Caja de sobres de coleccionista (edición sin indicar)", null],
  ["Theme Booster Kamigawa Neon Dynasty", null], // seis colores
  ["Booster de Draft Bloomburrow", null], // Bloomburrow no tiene sobres de draft
  ["Bundle Bloomburrow Edición Firmada por el Artista", null],
  // Accesorios, lotes, otros juegos y servicios
  ["Fundas Dragon Shield Matte negras (100)", null],
  ["Pack Navidad: 3 sobres + dado", null],
  ["Lote 20 tierras básicas surtidas", null],
  ["Playmat Bloomburrow - Ultra Pro", null],
  ["Deck Box Ultimate Guard Boulder 100+", null],
  ["Carpeta Bloomburrow 9 bolsillos", null],
  ["Pokémon Booster Escarlata y Púrpura", null],
  ["One Piece Booster Box OP-09", null],
  ["Entrada para el torneo de presentación de Bloomburrow", null],
  ["2x Sobre de juego Bloomburrow", null],
  // Varios productos juntos con "+": ninguno de ellos (ni su precio el de uno solo)
  ["Caja de sobres de juego Bloomburrow + Sobre de coleccionista", null],
  ["Bloomburrow Play Booster Box + Bundle", null],
  ["Pack Bloomburrow: Bundle + Play Booster Box", null],
  ["Bundle + Caja de sobres de juego Bloomburrow", null],
  // Varias unidades: lotes, no el producto suelto
  ["3 sobres de juego Bloomburrow", null],
  ["Pack 3 Play Boosters Bloomburrow", null],
  ["Pack de 3 sobres Bloomburrow", null],
  ["2 Bloomburrow Play Booster Box", null],
  ["Bloomburrow Collector Booster Box (2 cajas)", null],
  ["Bloomburrow Play Booster Box (6 cajas)", null],
  // ...pero la cantidad que trae un producto no lo es, ni el número de una edición
  ["Bundle Bloomburrow (9 sobres de juego)", ["Bloomburrow Bundle", "exact_es", EXACT]],
  ["Caja de 36 sobres de juego Bloomburrow", ["Bloomburrow Play Booster Box", "exact_es", EXACT]],
  // "caja de 6 displays" es una caja de cajas
  ["Bloomburrow Play Booster Box - Caja de 6 displays", ["Bloomburrow Play Booster Box Case", "trigram", TRIGRAM]],
];

describe("matchListing: producto sellado", () => {
  const catalog = createMockRepository();

  it.each(CASES)("%s", async (rawTitle, expected) => {
    const result = await matchListing(listing(rawTitle), catalog);
    if (!expected) {
      expect(result).toBeNull();
      return;
    }
    const [product, method, confidence] = expected;
    expect(result).toMatchObject({ kind: "sealed", sealedProductId: productId(product), method });
    const value = result?.confidence ?? Number.NaN;
    if (Array.isArray(confidence)) {
      expect(value).toBeGreaterThanOrEqual(confidence[0]);
      expect(value).toBeLessThanOrEqual(confidence[1]);
    } else {
      expect(value).toBeCloseTo(confidence, 5);
    }
  });

  it("usa la edición del adaptador", async () => {
    const result = await matchListing(listing("Caja de sobres de juego", { setHint: "Modern Horizons 3" }), catalog);
    expect(result).toMatchObject({ sealedProductId: productId("Modern Horizons 3 Play Booster Box") });
  });

  it("si la edición del adaptador y la del título no cuadran, no empareja", async () => {
    expect(await matchListing(listing("Bundle Bloomburrow", { setHint: "DSK" }), catalog)).toBeNull();
  });

  it("la edición del adaptador puede venir escrita como en el título", async () => {
    const result = await matchListing(listing("Bundle Bloomburrow", { setHint: "Edición: Bloomburrow (BLB)" }), catalog);
    expect(result).toMatchObject({ sealedProductId: productId("Bloomburrow Bundle") });
  });

  it("nunca empareja cajas de cajas si el título no lo dice", async () => {
    const cases = (await catalog.findSealedProducts("blb")).filter((p) => p.name.endsWith("Case"));
    for (const title of ["Bloomburrow Play Booster Box", "Bloomburrow Bundle", "Bloomburrow Prerelease Pack", "Kit de inicio Bloomburrow"]) {
      const result = await matchListing(listing(title), catalog);
      expect(result).not.toBeNull();
      expect(cases.map((c) => c.sealedProductId)).not.toContain(result?.kind === "sealed" ? result.sealedProductId : "");
    }
  });

  it("títulos reales de El Nucli: marcas ™/® y aclaraciones en negativo", async () => {
    const cases: Array<[string, string]> = [
      ["The Hobbit™ | Pack de presentación (no incluye entrada a torneo)", "The Hobbit Prerelease Kit"],
      ["Reality Fracture | Pack de presentación (no incluye entrada a torneo)", "Reality Fracture Prerelease Pack"],
      ["The Hobbit™ | Caja de Sobres de Juego", "The Hobbit Play Booster Box"],
      ["Magic: The Gathering® | Star Trek™ | Draft Night", "Star Trek Draft Night"],
    ];
    for (const [title, product] of cases) {
      const result = await matchListing(listing(title), catalog);
      expect(result).toMatchObject({ kind: "sealed", sealedProductId: productId(product) });
      expect(result?.confidence).toBeCloseTo(EXACT, 5);
    }
  });

  it("un título que solo dice la edición no es ningún producto", async () => {
    expect(await matchListing(listing("Bloomburrow", { kind: "sealed" }), catalog)).toBeNull();
  });

  it("nunca empareja canjes de MTGO si el título no los nombra", async () => {
    // Dominaria United tiene dos canjes (normal y foil): sin "MTGO" en el título, ninguno
    const redemptions = (await catalog.findSealedProducts("dmu", { category: "box_set" })).map((p) => p.sealedProductId);
    for (const title of ["Dominaria United Redemption Foil", "Dominaria Unida - Caja", "Dominaria United Box Set"]) {
      const result = await matchListing(listing(title, { kind: "sealed" }), catalog);
      expect(redemptions).not.toContain(result?.kind === "sealed" ? result.sealedProductId : "");
    }
    const explicit = await matchListing(listing("Dominaria United MTGO Redemption"), catalog);
    expect(explicit).toMatchObject({ sealedProductId: productId("Dominaria United MTGO Redemption") });
  });
});

describe("matchListing: mazos Commander", () => {
  // La muestra de sellado no trae mazos Commander: cuatro mazos reales de Bloomburrow Commander
  const base = createMockRepository();
  const decks: SealedCandidate[] = ["Animated Army", "Family Matters", "Peace Offering", "Squirreled Away"].map((deck, i) => ({
    sealedProductId: `00000000-0000-4000-8000-00000000000${i + 1}`,
    setCode: "blc",
    name: `Bloomburrow Commander Deck ${deck}`,
    category: "deck",
    subtype: "commander",
  }));
  const catalog: CatalogLookup = {
    ...base,
    findSealedProducts: async (setCode, opts = {}) =>
      setCode === "blc"
        ? decks.filter((d) => (!opts.category || d.category === opts.category) && (!opts.subtype || d.subtype === opts.subtype))
        : base.findSealedProducts(setCode, opts),
  };

  it.each([
    ["Mazo Commander Bloomburrow: Animated Army (Inglés)", 0],
    ["Bloomburrow Commander Deck - Family Matters", 1],
    ["Mazo Commander Bloomburrow Peace Offering - Español", 2],
    ["Commander Deck Squirreled Away (BLC)", 3],
  ])("%s", async (rawTitle, index) => {
    const result = await matchListing(listing(rawTitle), catalog);
    expect(result).toMatchObject({ kind: "sealed", sealedProductId: decks[index]!.sealedProductId });
  });

  it("sin el nombre del mazo no elige", async () => {
    expect(await matchListing(listing("Mazo Commander Bloomburrow"), catalog)).toBeNull();
  });
});

describe("classifyTitle", () => {
  const cases: Array<[string, ListingKind | null]> = [
    ["Lightning Bolt (SOS) NM", "single"],
    ["Relámpago", "single"],
    ["Lightning Bolt (Mystery Booster)", "single"],
    ["Lightning Bolt - Mystery Booster - NM", "single"],
    ["Sheoldred, the Apocalypse (DMU) Prerelease Foil", "single"],
    ["Llanowar Elves | Foundations Jumpstart | NM", "single"],
    // Edición con palabras de producto, pero con rareza y número: carta suelta
    ["Shivan Dragon - Welcome Deck 2017 (Rare) [12]", "single"],
    ["Kozilek's Return⁣ - Commander: Modern Horizons 3⁣ (Mythic)⁣ [214]", "single"],
    ["Caja de sobres de juego Bloomburrow", "sealed"],
    ["Bloomburrow - Play Booster Box (ES)", "sealed"],
    ["Sobre de coleccionista Duskmourn", "sealed"],
    ["Bundle Aetherdrift", "sealed"],
    ["Mazo Commander precon", "sealed"],
    ["Kit de presentación Bloomburrow", "sealed"],
    ["Starter Kit Bloomburrow", "sealed"],
    ["Display Foundations", "sealed"],
    ["Fundas Dragon Shield Matte (100)", null],
    ["Tapete de juego Final Fantasy", null],
    ["Lote 20 tierras básicas", null],
    ["Ficha de Soldado 1/1 (FDN)", null],
    ["4x Lightning Bolt (SOS)", null],
    ["Lightning Bolt (x4)", null],
    ["Pokémon Booster Box", null],
    ["Inscripción torneo Commander", null],
    ["Inscripción al torneo Modern del sábado", null],
    // la aclaración en negativo no es una inscripción
    ["The Hobbit™ | Pack de presentación (no incluye entrada a torneo)", "sealed"],
    // carta de Zendikar Rising, no una inscripción
    ["Inscripción de abundancia (ZNR)", "single"],
  ];

  it.each(cases)("%s → %s", (title, kind) => {
    expect(classifyTitle(title)).toBe(kind);
  });
});

describe("parseSealedTitle", () => {
  it.each([
    ["Caja de sobres de juego Bloomburrow (Español)", "booster_box", ["play"], "es"],
    ["Bloomburrow Collector Booster Box - ENG", "booster_box", ["collector"], "en"],
    ["Sobre de draft Dominaria Unida - Inglés", "booster_pack", ["draft"], "en"],
    ["Sobre de edición Kamigawa (Edición en español)", "booster_pack", ["set"], "es"],
    ["Bundle Duskmourn Versión Inglesa", "bundle", null, "en"],
    ["Gift Bundle The Hobbit (JP)", "bundle", ["gift_bundle"], "ja"],
    ["Mazo Commander Bloomburrow: Animated Army", "deck", ["commander"], undefined],
    ["Kit de presentación Bloomburrow EN", "limited_aid_tool", ["prerelease_kit"], "en"],
    ["Kit de inicio Foundations", "multiple_decks", ["two_player_starter"], undefined],
    ["Caja de cajas de sobres de coleccionista Bloomburrow", "booster_case", ["collector"], undefined],
    ["Bloomburrow Bundle Case", "bundle_case", null, undefined],
  ])("%s", (title, category, subtypes, language) => {
    expect(parseSealedTitle(title)).toMatchObject({ category, subtypes, language });
  });

  it("deja la edición en los tramos sin reconocer", () => {
    expect(parseSealedTitle("Caja de 36 sobres de coleccionista Kamigawa: Dinastía de neón").runs).toEqual([
      ["kamigawa", "dinastia", "de", "neon"],
    ]);
    expect(parseSealedTitle("Sobre temático Kamigawa - Ninjas (ES)").runs).toEqual([["kamigawa"], ["ninjas"]]);
  });
});

describe("enrichListing: producto sellado", () => {
  it("rellena el tipo y el idioma, y no toma segmentos del título por la edición", () => {
    const result = enrichListing(listing("Bloomburrow - Play Booster Box (Español)"));
    expect(result).toMatchObject({ kind: "sealed", language: "es" });
    expect(result.setHint).toBeUndefined();
  });

  it.each([
    ["Caja de sobres de juego Bloomburrow - Inglés", "en"],
    ["Sobre de coleccionista Duskmourn en castellano", "es"],
    ["Bundle Foundations (Edición en inglés)", "en"],
    ["Kit de presentación Bloomburrow - Versión española", "es"],
    ["Bloomburrow Collector Booster Box JP", "ja"],
    ["Caja de sobres de juego Bloomburrow (FR)", "fr"],
  ])("idioma de %s → %s", (title, language) => {
    expect(enrichListing(listing(title))).toMatchObject({ kind: "sealed", language });
  });

  it("no pisa lo que trae el adaptador", () => {
    const input = listing("Caja de sobres de juego Bloomburrow - Inglés", { kind: "sealed", language: "es" });
    expect(enrichListing(input)).toEqual(input);
  });

  it("sin idioma en el título no lo inventa", () => {
    expect(enrichListing(listing("Bundle Bloomburrow")).language).toBeUndefined();
  });
});
