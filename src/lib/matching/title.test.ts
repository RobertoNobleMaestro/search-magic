import { describe, expect, it } from "vitest";
import type { Condition, Finish, Lang } from "@/lib/data/types";
import { parseTitle, setHintForms, type ParsedTitle, type PrintingTag } from "./title";

// Ejemplos realistas de títulos de tiendas españolas (Shopify, WooCommerce, PrestaShop, HTML
// propio). Hay que sustituirlos o ampliarlos con títulos reales cuando se conozca la lista de tiendas.

describe("parseTitle", () => {
  const formats: Array<[string, Partial<ParsedTitle>]> = [
    ["Lightning Bolt (M11) NM", { name: "Lightning Bolt", setHints: ["M11"], condition: "NM" }],
    ["Relámpago [M11] - Español - Foil", { name: "Relámpago", setHints: ["M11"], language: "es", finish: "foil" }],
    [
      "Lightning Bolt | Magic 2011 | EX | Inglés",
      { name: "Lightning Bolt", setHints: ["Magic 2011"], condition: "EX", language: "en" },
    ],
    [
      "Counterspell - MH2 - 267 - Inglés",
      { name: "Counterspell", setHints: ["MH2"], collectorNumber: "267", language: "en" },
    ],
    [
      "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki (NEO) Borderless",
      { name: "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki", setHints: ["NEO"], tags: ["borderless"] },
    ],
    ["Sol Ring (C21) #263", { name: "Sol Ring", setHints: ["C21"], collectorNumber: "263" }],
    ["Anillo solar - Commander 2021 - Near Mint", { name: "Anillo solar", setHints: ["Commander 2021"], condition: "NM" }],
    ["Thoughtseize [2XM] Foil Etched", { name: "Thoughtseize", setHints: ["2XM"], finish: "etched" }],
    ["Llanowar Elves (Dominaria) JAP", { name: "Llanowar Elves", setHints: ["Dominaria"], language: "ja" }],
    [
      "Ragavan, Nimble Pilferer (MH2) - Showcase - Inglés - NM",
      { name: "Ragavan, Nimble Pilferer", setHints: ["MH2"], tags: ["showcase"], language: "en", condition: "NM" },
    ],
    [
      "Aves del Paraíso (Edición Básica 2010) Jugada",
      { name: "Aves del Paraíso", setHints: ["Edición Básica 2010"], condition: "PL" },
    ],
    ["Fire/Ice", { name: "Fire/Ice", setHints: [] }],
    ["Fuego // Hielo", { name: "Fuego // Hielo", setHints: [] }],
    [
      "El Anillo Único (LTR) Borderless Foil",
      { name: "El Anillo Único", setHints: ["LTR"], tags: ["borderless"], finish: "foil" },
    ],
    ["Lightning Bolt (Magic 2011 Foil)", { name: "Lightning Bolt", setHints: ["Magic 2011"], finish: "foil" }],
    ["Lightning Bolt (M11 - Foil)", { name: "Lightning Bolt", setHints: ["M11"], finish: "foil" }],
    ["Phyrexian Metamorph (Nueva Phyrexia)", { name: "Phyrexian Metamorph", setHints: ["Nueva Phyrexia"] }],
    ["LIGHTNING BOLT (M11) NM", { name: "LIGHTNING BOLT", setHints: ["M11"], condition: "NM" }],
    ["MTG - Lightning Bolt - M11", { name: "Lightning Bolt", setHints: ["M11"] }],
    ["M11 - Lightning Bolt - NM", { name: "Lightning Bolt", setHints: ["M11"], condition: "NM" }],
    [
      "MH2 | Ragavan, Nimble Pilferer | Borderless",
      { name: "Ragavan, Nimble Pilferer", setHints: ["MH2"], tags: ["borderless"] },
    ],
    ["Magic: The Gathering - Relámpago [M11]", { name: "Relámpago", setHints: ["M11"] }],
    [
      "Sheoldred, the Apocalypse (DMU) Prerelease Foil",
      { name: "Sheoldred, the Apocalypse", setHints: ["DMU"], tags: ["prerelease"], finish: "foil" },
    ],
  ];

  it.each(formats)("%s", (title, expected) => {
    expect(parseTitle(title)).toMatchObject({ nonSingle: false, tags: [], ...expected });
  });

  const conditions: Array<[string, Condition]> = [
    ["M", "MT"],
    ["MT", "MT"],
    ["Mint", "MT"],
    ["Nueva", "MT"],
    ["NM", "NM"],
    ["Near Mint", "NM"],
    ["Near-Mint", "NM"],
    ["Casi nueva", "NM"],
    ["Como nueva", "NM"],
    ["EX", "EX"],
    ["Excelente", "EX"],
    ["Excellent", "EX"],
    ["GD", "GD"],
    ["Good", "GD"],
    ["Buena", "GD"],
    ["Bueno", "GD"],
    ["MP", "GD"],
    ["LP", "LP"],
    ["Light Played", "LP"],
    ["Ligeramente jugada", "LP"],
    ["PL", "PL"],
    ["Played", "PL"],
    ["Jugada", "PL"],
    ["HP", "PL"],
    ["Heavily Played", "PL"],
    ["Muy jugada", "PL"],
    ["PO", "PO"],
    ["Poor", "PO"],
    ["Pobre", "PO"],
    ["Dañada", "PO"],
    ["Damaged", "PO"],
    ["DMG", "PO"],
  ];

  it.each(conditions)("estado %s → %s", (written, condition) => {
    expect(parseTitle(`Lightning Bolt (SOS) - ${written}`)).toMatchObject({ name: "Lightning Bolt", condition });
  });

  const languages: Array<[string, Lang]> = [
    ["Español", "es"],
    ["Castellano", "es"],
    ["ES", "es"],
    ["ESP", "es"],
    ["SPA", "es"],
    ["Inglés", "en"],
    ["EN", "en"],
    ["ENG", "en"],
    ["Italiano", "it"],
    ["IT", "it"],
    ["ITA", "it"],
    ["Francés", "fr"],
    ["FR", "fr"],
    ["FRA", "fr"],
    ["Alemán", "de"],
    ["DE", "de"],
    ["GER", "de"],
    ["Japonés", "ja"],
    ["JP", "ja"],
    ["JAP", "ja"],
    ["JA", "ja"],
    ["Portugués", "pt"],
    ["PT", "pt"],
    ["Coreano", "ko"],
    ["KO", "ko"],
    ["Ruso", "ru"],
    ["RU", "ru"],
    ["Chino", "zhs"],
  ];

  it.each(languages)("idioma %s → %s", (written, language) => {
    expect(parseTitle(`Lightning Bolt [SOS] (${written})`)).toMatchObject({ name: "Lightning Bolt", language });
  });

  const finishes: Array<[string, Finish]> = [
    ["Foil", "foil"],
    ["FOIL", "foil"],
    ["Foil Etched", "etched"],
    ["Etched Foil", "etched"],
    ["Etched", "etched"],
    ["No Foil", "nonfoil"],
    ["Non-Foil", "nonfoil"],
    ["Normal", "nonfoil"],
  ];

  it.each(finishes)("acabado %s → %s", (written, finish) => {
    expect(parseTitle(`Lightning Bolt (SOS) | ${written}`)).toMatchObject({ name: "Lightning Bolt", finish });
  });

  const printingTags: Array<[string, PrintingTag]> = [
    ["Borderless", "borderless"],
    ["Sin borde", "borderless"],
    ["Showcase", "showcase"],
    ["Extended Art", "extendedart"],
    ["Arte extendido", "extendedart"],
    ["Full Art", "fullart"],
    ["Promo", "promo"],
    ["Prerelease", "prerelease"],
    ["Presentación", "prerelease"],
    ["Retro Frame", "retro"],
    ["Old Frame", "retro"],
  ];

  it.each(printingTags)("variante %s → %s", (written, tag) => {
    expect(parseTitle(`Lightning Bolt (SOS) ${written}`)).toMatchObject({ name: "Lightning Bolt", tags: [tag] });
  });

  it("quita las etiquetas pegadas al final del nombre", () => {
    expect(parseTitle("Lightning Bolt NM")).toMatchObject({ name: "Lightning Bolt", condition: "NM" });
    expect(parseTitle("Lightning Bolt Near Mint")).toMatchObject({ name: "Lightning Bolt", condition: "NM" });
    expect(parseTitle("Relámpago FOIL ESP")).toMatchObject({ name: "Relámpago", finish: "foil", language: "es" });
    expect(parseTitle("Contrahechizo, NM, Inglés")).toMatchObject({ name: "Contrahechizo", condition: "NM", language: "en" });
    expect(parseTitle("Lightning Bolt M11 NM")).toMatchObject({ name: "Lightning Bolt", setHints: ["M11"], condition: "NM" });
    expect(parseTitle("Sheoldred Apocalypse Prerelease Promo FOIL")).toMatchObject({
      name: "Sheoldred Apocalypse",
      tags: ["prerelease", "promo"],
      finish: "foil",
    });
  });

  it("quita cantidades y FOIL del principio", () => {
    expect(parseTitle("1x Lightning Bolt NM")).toMatchObject({ name: "Lightning Bolt", condition: "NM", nonSingle: false });
    expect(parseTitle("FOIL Lightning Bolt (M11)")).toMatchObject({ name: "Lightning Bolt", finish: "foil" });
  });

  /** Resultado completo, para comprobar también lo que no se ha rellenado */
  const parsedAs = (name: string, extra: Partial<ParsedTitle> = {}): ParsedTitle => ({
    name,
    nonSingle: false,
    setHints: [],
    tags: [],
    ...extra,
  });

  it("no toma por etiqueta una abreviatura que forma parte del nombre", () => {
    expect(parseTitle("Espadas en guadañas | FRC")).toEqual(parsedAs("Espadas en guadañas", { setHints: ["FRC"] }));
    expect(parseTitle("Espadas en guadañas EN")).toEqual(parsedAs("Espadas en guadañas", { language: "en" }));
    expect(parseTitle("Elfos de Llanowar (J25)")).toEqual(parsedAs("Elfos de Llanowar", { setHints: ["J25"] }));
    expect(parseTitle("It That Betrays (ROE)")).toEqual(parsedAs("It That Betrays", { setHints: ["ROE"] }));
    expect(parseTitle("Etched Oracle (5DN)")).toEqual(parsedAs("Etched Oracle", { setHints: ["5DN"] }));
    // En minúsculas, "Es" pegado al nombre no se quita: podría ser parte de un nombre en español
    expect(parseTitle("Relámpago Es")).toEqual(parsedAs("Relámpago Es"));
  });

  it("no deja el nombre vacío aunque sea una palabra del vocabulario", () => {
    // "Foil" es una carta de Prophecy
    expect(parseTitle("Foil (PCY)")).toEqual(parsedAs("Foil", { setHints: ["PCY"] }));
  });

  it.each([
    ["Lightning Bolt (SOS) #332", "332"],
    ["Lightning Bolt (SOS) nº 332", "332"],
    ["Lightning Bolt (SOS) N.º 332", "332"],
    ["Lightning Bolt - SOS - 332/381", "332"],
    ["Lightning Bolt (SOS) - 113", "113"],
    ["Lightning Bolt (PSOS) - 113p", "113p"],
    ["Serra Angel (P30H) #1★ Foil", "1★"],
    ["Serra Angel (PLST) #DMR-271", "DMR-271"],
  ])("número de coleccionista en %s", (title, collectorNumber) => {
    expect(parseTitle(title)).toMatchObject({ collectorNumber });
  });

  it("un año dentro de la edición no es un número de coleccionista", () => {
    expect(parseTitle("Lightning Bolt | Magic 2011 | NM")).toEqual(
      parsedAs("Lightning Bolt", { setHints: ["Magic 2011"], condition: "NM" }),
    );
  });

  it.each([
    "Booster de Draft Bloomburrow",
    "Caja de sobres Modern Horizons 3",
    "Sobre de coleccionista Duskmourn (ES)",
    "Display Play Booster Foundations",
    "Lote 20 tierras básicas",
    "Fundas Dragon Shield Matte (100)",
    "Carpeta 9 bolsillos",
    "Mazo Commander precon",
    "Playmat Bloomburrow - Ultra Pro",
    "Tapete de juego Final Fantasy",
    "Deck Box Ultimate Guard Boulder 100+",
    "Bundle Aetherdrift",
    "Ficha de Soldado 1/1 (FDN)",
    "4x Lightning Bolt (SOS)",
    "Lightning Bolt x4",
    "Lightning Bolt (x4)",
    "Playset Counterspell (FDC)",
  ])("no es una carta suelta: %s", (title) => {
    expect(parseTitle(title).nonSingle).toBe(true);
  });

  it("quita los caracteres invisibles de formato", () => {
    expect(parseTitle("Light​ning Bolt⁣ (SOS)­ NM")).toEqual(
      parsedAs("Lightning Bolt", { setHints: ["SOS"], condition: "NM" }),
    );
  });

  it("descarta la rareza entre paréntesis, en inglés y en español", () => {
    for (const rarity of ["Common", "Uncommon", "Rare", "Mythic", "Mythic Rare", "Special", "Común", "Infrecuente", "Rara", "Mítica"]) {
      expect(parseTitle(`Lightning Bolt - Secrets of Strixhaven (${rarity}) [113]`)).toEqual(
        parsedAs("Lightning Bolt", { setHints: ["Secrets of Strixhaven"], collectorNumber: "113" }),
      );
    }
  });

  it("entre corchetes, [SET-123] es edición y número; fuera de corchetes sigue siendo un número", () => {
    expect(parseTitle("Lightning Bolt [SOS-113]")).toEqual(parsedAs("Lightning Bolt", { setHints: ["SOS"], collectorNumber: "113" }));
    expect(parseTitle("Serra Angel (PLST) #DMR-271")).toMatchObject({ setHints: ["PLST"], collectorNumber: "DMR-271" });
  });

  it("una variante de arte (V.2) no es la edición ni el número", () => {
    expect(parseTitle("Pantano (V.2) EX")).toEqual(parsedAs("Pantano", { condition: "EX" }));
    expect(parseTitle("Island (Ver. 3)")).toEqual(parsedAs("Island"));
  });
});

describe("parseTitle: títulos reales de las tiendas online (docs/tiendas-online.json)", () => {
  const parsedAs = (name: string, extra: Partial<ParsedTitle> = {}): ParsedTitle => ({
    name,
    nonSingle: false,
    setHints: [],
    tags: [],
    ...extra,
  });
  const U = "⁣";

  const examples: Array<[store: string, title: string, expected: ParsedTitle]> = [
    // MTG Canarias: solo el nombre; edición e idioma en atributos
    ["MTG Canarias", "Enfrentamiento decisivo", parsedAs("Enfrentamiento decisivo")],
    ["MTG Canarias", "Captain Kathryn Janeway", parsedAs("Captain Kathryn Janeway")],
    ["MTG Canarias", "U.S.S. Enterprise-D, Galaxy-Class", parsedAs("U.S.S. Enterprise-D, Galaxy-Class")],
    // El Rincón de Magic: "NOMBRE ES / NOMBRE EN (EDICIÓN)" en mayúsculas
    [
      "El Rincón de Magic",
      "BUSCACAMINOS CAMBIAFORMAS / CHANGELING WAYFINDER (LORWYN ECLIPSADO)",
      parsedAs("BUSCACAMINOS CAMBIAFORMAS / CHANGELING WAYFINDER", { setHints: ["LORWYN ECLIPSADO"] }),
    ],
    [
      "El Rincón de Magic",
      "AJANI ACOMPAÑANTE FORASTERO / AJANI OUTLAND CHAPERONE (LORWYN ECLIPSADO)",
      parsedAs("AJANI ACOMPAÑANTE FORASTERO / AJANI OUTLAND CHAPERONE", { setHints: ["LORWYN ECLIPSADO"] }),
    ],
    [
      "El Rincón de Magic",
      "FANFARRON DE AXGARD / AXGARD BRAGGART (KALDHEIM)",
      parsedAs("FANFARRON DE AXGARD / AXGARD BRAGGART", { setHints: ["KALDHEIM"] }),
    ],
    // Rebellion: "Nombre ES / Name EN"
    ["Rebellion", "Abajo en el valle / Down in the Valley", parsedAs("Abajo en el valle / Down in the Valley")],
    ["Rebellion", "Bardo, rey de Valle / Bard, King of Dale", parsedAs("Bardo, rey de Valle / Bard, King of Dale")],
    ["Rebellion", "Azog, Ruina de Moria / Azog, Moria´s Ruin", parsedAs("Azog, Ruina de Moria / Azog, Moria´s Ruin")],
    // El Duelista (Shopify): separadores invisibles U+2063 y número entre corchetes
    [
      "El Duelista",
      `Eldrazi Ravager${U} - Modern Horizons 3${U} (Uncommon)${U} [5]`,
      parsedAs("Eldrazi Ravager", { setHints: ["Modern Horizons 3"], collectorNumber: "5" }),
    ],
    [
      "El Duelista",
      `Kozilek's Return${U} - Commander: Modern Horizons 3${U} (Mythic)${U} [214]`,
      parsedAs("Kozilek's Return", { setHints: ["Commander: Modern Horizons 3"], collectorNumber: "214" }),
    ],
    [
      "El Duelista",
      `Dockside Extortionist${U} - Commander 2019${U} (Rare)${U} [24]`,
      parsedAs("Dockside Extortionist", { setHints: ["Commander 2019"], collectorNumber: "24" }),
    ],
    // Universe TCG (Shopify): "[SET-número]"
    [
      "Universe TCG",
      "Prismari, the Inspiration - Secrets of Strixhaven: Extras (Mythic) [XSOS-285]",
      parsedAs("Prismari, the Inspiration", { setHints: ["Secrets of Strixhaven: Extras", "XSOS"], collectorNumber: "285" }),
    ],
    [
      "Universe TCG",
      "Super Shredder - Teenage Mutant Ninja Turtles (Mythic) [TMT-83]",
      parsedAs("Super Shredder", { setHints: ["Teenage Mutant Ninja Turtles", "TMT"], collectorNumber: "83" }),
    ],
    [
      "Universe TCG",
      "Multiversal Passage - Marvel's Spider-Man (Rare) [SPM-180]",
      parsedAs("Multiversal Passage", { setHints: ["Marvel's Spider-Man", "SPM"], collectorNumber: "180" }),
    ],
    // Itaca: "Name EN / Nombre ES"
    ["Itaca", "Gleaming Splendor / Esplendor reluciente", parsedAs("Gleaming Splendor / Esplendor reluciente")],
    ["Itaca", "Smaug the Magnificent / Smaug el Magnífico", parsedAs("Smaug the Magnificent / Smaug el Magnífico")],
    ["Itaca", "Bilbo, Thief in the Night / Bilbo, ladrón en la noche", parsedAs("Bilbo, Thief in the Night / Bilbo, ladrón en la noche")],
    // Disfrutalo TCG: nombre y estado
    ["Disfrutalo TCG", "Camaradería NM", parsedAs("Camaradería", { condition: "NM" })],
    ["Disfrutalo TCG", "Altar de la progenie NM", parsedAs("Altar de la progenie", { condition: "NM" })],
    ["Disfrutalo TCG", "Pantano (V.2) EX", parsedAs("Pantano", { condition: "EX" })],
  ];

  it.each(examples)("%s: %s", (_store, title, expected) => {
    expect(parseTitle(title)).toEqual(expected);
  });
});

describe("setHintForms", () => {
  it("prueba la edición entera, sus partes y lo que va antes de los dos puntos", () => {
    expect(setHintForms("Secrets of Strixhaven: Extras")).toEqual([
      "Secrets of Strixhaven: Extras",
      "Secrets of Strixhaven: Extras",
      "Secrets of Strixhaven: Extras",
      "Secrets of Strixhaven",
    ]);
    expect(setHintForms("Edición: Magic 2011 (M11)")).toEqual(["Edición: Magic 2011 (M11)", "Magic 2011 (M11)", "Magic 2011", "M11"]);
  });
});

describe("parseTitle: más casos", () => {
  it.each([
    "Pack Rat (RTR)",
    "Lightning Bolt (Mystery Booster)",
    "Llanowar Elves (Duel Decks: Elves vs. Goblins)",
    "Sol Ring - Commander 2021 - Foil",
  ])("es una carta suelta: %s", (title) => {
    expect(parseTitle(title).nonSingle).toBe(false);
  });
});
