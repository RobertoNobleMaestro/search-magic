import { describe, expect, it } from "vitest";
import {
  cardmarketProfileUrl,
  conditionLabel,
  finishLabel,
  formatConfidence,
  formatDate,
  formatDateTime,
  formatDuration,
  formatEuros,
  formatPercentDiff,
  isStale,
  languageLabel,
  platformLabel,
  plural,
  priceDiffPercent,
  sealedFamily,
  sealedTypeLabel,
  sourceLabel,
  statusLabel,
  stockLabel,
  storeKindLabel,
  timeAgo,
} from "./format";

// Intl separa la cifra del símbolo con un espacio de no separación
const NBSP = " ";

describe("formatEuros", () => {
  it.each([
    [0, `0,00${NBSP}€`],
    [5, `0,05${NBSP}€`],
    [150, `1,50${NBSP}€`],
    [1999, `19,99${NBSP}€`],
    // en español las cifras de cuatro dígitos no llevan separador de miles
    [123456, `1234,56${NBSP}€`],
    [1234567, `12.345,67${NBSP}€`],
  ])("%i céntimos → %s", (cents, expected) => {
    expect(formatEuros(cents)).toBe(expected);
  });
});

describe("priceDiffPercent", () => {
  it("calcula la diferencia respecto a la referencia en % entero", () => {
    expect(priceDiffPercent(88, 100)).toBe(-12);
    expect(priceDiffPercent(108, 100)).toBe(8);
    expect(priceDiffPercent(150, 166)).toBe(-10);
    expect(priceDiffPercent(100, 100)).toBe(0);
  });

  it("no devuelve -0 al redondear", () => {
    expect(Object.is(priceDiffPercent(998, 1000), 0)).toBe(true);
  });

  it("devuelve null sin referencia", () => {
    expect(priceDiffPercent(100, null)).toBeNull();
    expect(priceDiffPercent(100, 0)).toBeNull();
  });
});

describe("formatPercentDiff", () => {
  it("usa el signo menos tipográfico y espacio antes de %", () => {
    expect(formatPercentDiff(-12)).toBe(`−12${NBSP}%`);
    expect(formatPercentDiff(8)).toBe(`+8${NBSP}%`);
    expect(formatPercentDiff(0)).toBe(`0${NBSP}%`);
  });
});

describe("formatConfidence", () => {
  it("convierte 0..1 en porcentaje", () => {
    expect(formatConfidence(0.62)).toBe(`62${NBSP}%`);
    expect(formatConfidence(1)).toBe(`100${NBSP}%`);
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it.each([
    [10_000, "hace un momento"],
    [5 * 60_000, "hace 5 min"],
    [59 * 60_000, "hace 59 min"],
    [3 * 3_600_000, "hace 3 h"],
    [3 * 3_600_000 + 50 * 60_000, "hace 3 h"],
    [23 * 3_600_000, "hace 23 h"],
    [31 * 3_600_000, "hace 1 día"],
    [2 * 86_400_000, "hace 2 días"],
  ])("%i ms → %s", (ms, expected) => {
    expect(timeAgo(ago(ms), now)).toBe(expected);
  });

  it("trata las fechas futuras (relojes desajustados) como recientes", () => {
    expect(timeAgo(new Date(now.getTime() + 60_000).toISOString(), now)).toBe("hace un momento");
  });

  it("devuelve cadena vacía con fechas no válidas", () => {
    expect(timeAgo("no es una fecha", now)).toBe("");
  });
});

describe("isStale", () => {
  const now = new Date("2026-10-18T12:00:00Z");

  it("marca como viejos los datos de más de 24 h o sin fecha", () => {
    expect(isStale("2026-10-17T13:00:00Z", now)).toBe(false);
    expect(isStale("2026-10-17T11:00:00Z", now)).toBe(true);
    expect(isStale(null, now)).toBe(true);
  });
});

describe("formatDateTime", () => {
  it("usa la hora de Madrid", () => {
    expect(formatDateTime("2026-10-18T12:05:00Z")).toBe("18/10/26, 14:05");
    expect(formatDateTime("2026-01-15T12:05:00Z")).toBe("15/1/26, 13:05");
  });
});

describe("formatDate", () => {
  it("fecha larga en español, sin desfase de zona horaria", () => {
    expect(formatDate("2024-08-02")).toBe("2 de agosto de 2024");
    expect(formatDate("2026-01-01")).toBe("1 de enero de 2026");
    expect(formatDate("no es una fecha")).toBe("");
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0 s"],
    [45_000, "45 s"],
    [360_000, "6 min"],
    [395_000, "6 min 35 s"],
    [3_600_000, "1 h"],
    [3_900_000, "1 h 5 min"],
  ])("%i ms → %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe("textos", () => {
  it("plural", () => {
    expect(plural(1, "oferta", "ofertas")).toBe("1 oferta");
    expect(plural(0, "oferta", "ofertas")).toBe("0 ofertas");
    expect(plural(3, "impresión", "impresiones")).toBe("3 impresiones");
  });

  it("stockLabel", () => {
    expect(stockLabel(false, 0)).toBe("Agotado");
    expect(stockLabel(true, null)).toBe("En stock");
    expect(stockLabel(true, 1)).toBe("1 ud.");
    expect(stockLabel(true, 4)).toBe("4 uds.");
  });
});

describe("etiquetas", () => {
  it("estado de la carta", () => {
    expect(conditionLabel("MT")).toBe("Mint");
    expect(conditionLabel("NM")).toBe("Near Mint");
    expect(conditionLabel("EX")).toBe("Excelente");
    expect(conditionLabel("GD")).toBe("Buena");
    expect(conditionLabel("LP")).toBe("Ligeramente jugada");
    expect(conditionLabel("PL")).toBe("Jugada");
    expect(conditionLabel("PO")).toBe("Pobre");
    expect(conditionLabel(null)).toBe("Desconocido");
  });

  it("acabado", () => {
    expect(finishLabel("nonfoil")).toBe("Normal");
    expect(finishLabel("foil")).toBe("Foil");
    expect(finishLabel("etched")).toBe("Etched");
  });

  it("tipo de tienda, fuente y perfil de Cardmarket", () => {
    expect(storeKindLabel(true)).toBe("Tienda física");
    expect(storeKindLabel(false)).toBe("Online");
    expect(sourceLabel("web")).toBe("Web de la tienda");
    expect(sourceLabel("cardmarket_csv")).toBe("Stock de Cardmarket");
    expect(cardmarketProfileUrl("CofreDelMana")).toBe("https://www.cardmarket.com/es/Magic/Users/CofreDelMana");
    expect(cardmarketProfileUrl("Tienda Rara")).toBe("https://www.cardmarket.com/es/Magic/Users/Tienda%20Rara");
  });

  it("idioma, con el código como respaldo", () => {
    expect(languageLabel("es")).toBe("Español");
    expect(languageLabel("en")).toBe("Inglés");
    expect(languageLabel("ja")).toBe("Japonés");
    expect(languageLabel("zhs")).toBe("Chino simplificado");
    expect(languageLabel("zht")).toBe("Chino tradicional");
    expect(languageLabel("ph")).toBe("ph");
    expect(languageLabel(null)).toBe("Desconocido");
  });

  it("plataforma y estado del scraping", () => {
    expect(platformLabel("woocommerce")).toBe("WooCommerce");
    expect(statusLabel("ok")).toBe("OK");
    expect(statusLabel("partial")).toBe("Parcial");
    expect(statusLabel("error")).toBe("Error");
    expect(statusLabel("skipped")).toBe("Omitida");
    expect(statusLabel("running")).toBe("En curso");
    expect(statusLabel(null)).toBe("Sin datos");
  });
});

describe("producto sellado", () => {
  it.each([
    ["booster_pack", "play", "Sobre de juego"],
    ["booster_pack", "draft", "Sobre de draft"],
    ["booster_pack", "set", "Sobre de edición"],
    ["booster_pack", "collector", "Sobre de coleccionista"],
    ["booster_pack", "jumpstart", "Sobre de Jumpstart"],
    ["booster_box", "play", "Caja de sobres de juego"],
    ["booster_box", "draft", "Caja de sobres de draft"],
    ["booster_box", "set", "Caja de sobres de edición"],
    ["booster_box", "collector", "Caja de sobres de coleccionista"],
    ["booster_case", "collector", "Lote de cajas de sobres de coleccionista"],
    ["bundle", "default", "Bundle"],
    ["bundle", "gift_bundle", "Bundle regalo"],
    ["bundle_case", "default", "Lote de bundles"],
    ["bundle_case", "gift_bundle", "Lote de bundles regalo"],
    ["deck", "commander", "Mazo Commander"],
    ["deck", "starter_deck", "Mazo de inicio"],
    ["limited_aid_tool", "prerelease_kit", "Kit de presentación"],
    ["limited_aid_case", "prerelease_kit", "Lote de kits de presentación"],
    ["multiple_decks", "two_player_starter", "Kit de inicio para 2 jugadores"],
    ["box_set", "mtgo_redemption", "Canje de MTGO"],
  ])("%s/%s → %s", (category, subtype, expected) => {
    expect(sealedTypeLabel(category, subtype)).toBe(expected);
  });

  it("tiene respaldo para subtipos, categorías y valores desconocidos", () => {
    expect(sealedTypeLabel("booster_pack", "nuevo_tipo")).toBe("Sobre");
    expect(sealedTypeLabel("booster_box", null)).toBe("Caja de sobres");
    expect(sealedTypeLabel("bundle", "otro")).toBe("Bundle");
    expect(sealedTypeLabel("deck", "otro")).toBe("Mazo");
    expect(sealedTypeLabel("box_set", "other")).toBe("Caja especial");
    expect(sealedTypeLabel("categoria_nueva", "x")).toBe("Producto sellado");
    expect(sealedTypeLabel(null, null)).toBe("Producto sellado");
  });

  it("familia del producto", () => {
    expect(sealedFamily("booster_box")).toBe("box");
    expect(sealedFamily("booster_case")).toBe("box");
    expect(sealedFamily("bundle")).toBe("bundle");
    expect(sealedFamily("booster_pack")).toBe("pack");
    expect(sealedFamily("deck")).toBe("deck");
    expect(sealedFamily("limited_aid_tool")).toBe("other");
    expect(sealedFamily(null)).toBe("other");
  });
});
