import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cardmarketOffersUrl,
  detectDelimiter,
  hasCardmarketCsv,
  mapColumns,
  parseCardmarketCsv,
  parseCondition,
  parseCsv,
  parseLanguage,
} from "../adapters/cardmarket-csv";
import { decodeText } from "../encoding";
import type { StoreConfig } from "../types";

const SCRAPED_AT = "2026-10-18T10:00:00.000Z";
const opts = { storeId: "rincon-draft-collblanc", cardmarketUser: "RinconDelDraft", scrapedAt: SCRAPED_AT };
const OFFERS = "https://www.cardmarket.com/es/Magic/Users/RinconDelDraft/Offers/Singles";

const fixture = (name: string) => decodeText(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe("parseCsv", () => {
  it("comillas con separadores, comillas dobladas y saltos de línea dentro", () => {
    const text = 'a;b;c\r\n1;"dos; y ""medio""";"tres\nlíneas"\r\n4;;\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["1", 'dos; y "medio"', "tres\nlíneas"],
      ["4", "", ""],
    ]);
  });

  it("unas comillas sin cerrar son un error (no se traga el resto del fichero)", () => {
    expect(() => parseCsv('idProduct;Name;Price\n5000;"Bolt;1,00\n5001;Fire;2,00\n')).toThrow("comillas sin cerrar en la fila 2");
  });

  it("detecta el separador de la cabecera, también con la línea sep= de Excel", () => {
    expect(detectDelimiter("idArticle;idProduct;Name")).toBe(";");
    expect(detectDelimiter('idArticle,"Name; local",Price')).toBe(",");
    expect(detectDelimiter("idArticle\tidProduct\tName")).toBe("\t");
    expect(parseCsv("sep=,\r\na;b,c\r\n")).toEqual([["a;b", "c"]]);
  });

  it("quita el BOM", () => {
    expect(parseCsv("﻿a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("mapColumns", () => {
  it("reconoce las cabeceras sin mayúsculas, acentos ni signos", () => {
    const index = mapColumns(["IDARTICLE", "Foil?", "Exp. Name", "Exp.", "Cantidad", "precio"]);
    expect(index).toMatchObject({ articleId: 0, foil: 1, expansion: 2, expansionCode: 3, amount: 4, price: 5 });
    expect(mapColumns(["Expansión", "Edición"])).toEqual({ expansion: 0 });
  });

  it("una cabecera fijada en la configuración manda", () => {
    expect(mapColumns(["Carta", "Preu"], { price: "preu" })).toMatchObject({ name: 0, price: 1 });
  });
});

describe("parseLanguage y parseCondition", () => {
  it("idiomas por id de Cardmarket o por nombre, en inglés o en español", () => {
    expect(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"].map(parseLanguage)).toEqual([
      "en", "fr", "de", "es", "it", "zhs", "ja", "pt", "ru", "ko", "zht",
    ]);
    expect(["S-Chinese", "T-Chinese", "Spanish", "Español", "japonés", "Deutsch"].map(parseLanguage)).toEqual([
      "zhs", "zht", "es", "es", "ja", "de",
    ]);
    expect(parseLanguage("")).toBeUndefined();
    expect(parseLanguage("99")).toBeUndefined();
  });

  it("estados de Cardmarket en código o en palabras", () => {
    expect(["MT", "nm", "EX", "GD", "LP", "PL", "PO"].map(parseCondition)).toEqual(["MT", "NM", "EX", "GD", "LP", "PL", "PO"]);
    expect(["Near Mint", "Light Played", "Casi nueva", ""].map(parseCondition)).toEqual(["NM", "LP", "NM", undefined]);
  });
});

describe("parseCardmarketCsv: exportación con ';', ids de idioma, coma decimal y BOM", () => {
  const { listings, skipped, columns } = parseCardmarketCsv(fixture("cardmarket-stock-semicolon.csv"), opts);
  const byId = new Map(listings.map((l) => [l.externalId, l]));

  it("un listado por artículo; las firmadas no se importan", () => {
    expect(listings.map((l) => l.externalId)).toEqual(["1500000001", "1500000002", "1500000003", "1500000004", "1500000006"]);
    expect(skipped).toEqual([{ row: 5, reason: "firmada o alterada" }]);
    expect(columns).toMatchObject({ articleId: "idArticle", productId: "idProduct", nameEn: "English Name", expansion: "Exp. Name" });
  });

  it("lee idProduct, precio, cantidad, estado, idioma y acabado", () => {
    expect(byId.get("1500000001")).toEqual({
      storeId: "rincon-draft-collblanc",
      externalId: "1500000001",
      rawTitle: "Ragavan, Nimble Pilferer (Modern Horizons 2)",
      url: OFFERS,
      priceCents: 3850,
      currency: "EUR",
      inStock: true,
      quantity: 2,
      condition: "NM",
      language: "es",
      finish: "nonfoil",
      setHint: "Modern Horizons 2",
      cardmarketId: 566480,
      scrapedAt: SCRAPED_AT,
    });
    expect(byId.get("1500000002")).toMatchObject({ rawTitle: "Sheoldred, the Apocalypse (Dominaria United)", finish: "foil", language: "en", condition: "EX" });
    expect(byId.get("1500000004")).toMatchObject({ language: "ja", condition: "LP", priceCents: 1800, cardmarketId: 607389 });
  });

  it("un playset se guarda por carta: precio / 4 y cantidad × 4", () => {
    expect(byId.get("1500000003")).toMatchObject({ priceCents: 45, quantity: 12, inStock: true });
  });

  it("cantidad 0: sin stock", () => {
    expect(byId.get("1500000006")).toMatchObject({ inStock: false, quantity: 0, language: "fr", condition: "GD" });
  });
});

describe("parseCardmarketCsv: exportación con ',', nombres de idioma, punto decimal e idExpansion", () => {
  const { listings, skipped } = parseCardmarketCsv(fixture("cardmarket-stock-comma.csv"), opts);
  const byId = new Map(listings.map((l) => [l.externalId, l]));

  it("enlaza a sus sueltas de esa expansión y lee el número de colección", () => {
    expect(byId.get("1600000001")).toEqual({
      storeId: "rincon-draft-collblanc",
      externalId: "1600000001",
      rawTitle: "Lightning Bolt (Secrets of Strixhaven)",
      url: `${OFFERS}?idExpansion=6123`,
      priceCents: 39,
      currency: "EUR",
      inStock: true,
      quantity: 4,
      condition: "NM",
      language: "es",
      finish: "nonfoil",
      setHint: "Secrets of Strixhaven",
      collectorNumber: "113",
      cardmarketId: 882058,
      scrapedAt: SCRAPED_AT,
    });
  });

  it("campos entre comillas, separador de miles, foil con true/1 e idioma T-Chinese", () => {
    expect(byId.get("1600000002")).toMatchObject({ rawTitle: "Ragavan, Nimble Pilferer (Modern Horizons 2)", finish: "foil", priceCents: 5200 });
    expect(byId.get("1600000003")).toMatchObject({ priceCents: 125_000, language: "ja", condition: "EX", finish: "foil" });
    expect(byId.get("1600000004")).toMatchObject({ language: "zht", condition: "NM", finish: "foil", collectorNumber: "IFIYW-7", quantity: 2 });
  });

  it("descarta las filas sin precio", () => {
    expect(listings).toHaveLength(4);
    expect(skipped).toEqual([{ row: 5, reason: "sin precio" }]);
  });
});

describe("parseCardmarketCsv: otras exportaciones", () => {
  it("cabeceras en español y sin idArticle: clave estable, numerada si se repite", () => {
    const csv = [
      "Producto;Expansión;Idioma;Estado;Foil;Precio;Cantidad",
      "Counterspell;Foundations Commander;Español;Casi nueva;;0,50 €;3",
      "Counterspell;Foundations Commander;Español;Casi nueva;;0,45 €;1",
      "Counterspell;Foundations Commander;Inglés;NM;Sí;2,00 €;1",
    ].join("\n");
    const { listings } = parseCardmarketCsv(csv, opts);
    expect(listings.map((l) => l.externalId)).toEqual([
      "cm:counterspell foundations commander:es:NM:nonfoil:",
      "cm:counterspell foundations commander:es:NM:nonfoil:#2",
      "cm:counterspell foundations commander:en:NM:foil:",
    ]);
    expect(listings[0]).toMatchObject({ rawTitle: "Counterspell (Foundations Commander)", priceCents: 50, quantity: 3 });
    expect(listings[0]!.cardmarketId).toBeUndefined();
  });

  it("una columna Exp. con cifras es el id de la expansión; sin cantidad, una unidad", () => {
    const csv = "idProduct,English Name,Exp.,Price\n910434,Counterspell,5875,0.25\n";
    const [listing] = parseCardmarketCsv(csv, opts).listings;
    expect(listing).toMatchObject({
      externalId: "cm:910434::::",
      rawTitle: "Counterspell",
      url: `${OFFERS}?idExpansion=5875`,
      quantity: 1,
      inStock: true,
      cardmarketId: 910434,
    });
    expect(listing!.setHint).toBeUndefined();
    expect(listing!.finish).toBeUndefined();
  });

  it("solo euros; con categoría, distingue sueltas de sellado", () => {
    const csv = [
      "idArticle;idProduct;Name;Category;Price;Currency Code",
      "1;910434;Counterspell;Magic Single;0,25;EUR",
      "2;901234;Foundations Play Booster Box;Magic Display;150,00;EUR",
      "3;910434;Counterspell;Magic Single;0,30;USD",
    ].join("\n");
    const { listings, skipped } = parseCardmarketCsv(csv, opts);
    expect(listings.map((l) => [l.externalId, l.kind])).toEqual([
      ["1", "single"],
      ["2", "sealed"],
    ]);
    expect(skipped).toEqual([{ row: 3, reason: "moneda USD" }]);
  });

  it("la cabecera fijada en cardmarketCsv.columns manda", () => {
    const csv = "idProduct;Carta;Preu\n910434;Counterspell;0,25\n";
    expect(() => parseCardmarketCsv(csv, opts)).toThrow(/columnas price.*"Preu"/);
    expect(parseCardmarketCsv(csv, { ...opts, columns: { price: "Preu" } }).listings[0]).toMatchObject({ priceCents: 25 });
  });

  it("sin precio ni producto, explica qué falta y qué cabeceras hay", () => {
    expect(() => parseCardmarketCsv("foo,bar\n1,2\n", opts)).toThrow('no tiene las columnas price y productId o name. Cabeceras: "foo", "bar"');
  });

  it("se salta las filas vacías y las cantidades que no son números", () => {
    const csv = "idProduct;Name;Price;Amount\n\n910434;Counterspell;0,25;dos\n;;;\n";
    expect(parseCardmarketCsv(csv, opts)).toMatchObject({ listings: [], skipped: [{ row: 2, reason: 'cantidad no válida: "dos"' }] });
  });
});

describe("cardmarketOffersUrl", () => {
  it("enlaza a las sueltas del usuario, con o sin expansión", () => {
    expect(cardmarketOffersUrl("inGenio")).toBe("https://www.cardmarket.com/es/Magic/Users/inGenio/Offers/Singles");
    expect(cardmarketOffersUrl("Magic-Industria-61", "1234")).toBe(
      "https://www.cardmarket.com/es/Magic/Users/Magic-Industria-61/Offers/Singles?idExpansion=1234",
    );
  });
});

describe("hasCardmarketCsv", () => {
  const store: StoreConfig = {
    id: "tienda-csv",
    name: "Tienda CSV",
    city: "Barcelona",
    province: "Barcelona",
    local: true,
    address: "Carrer Fals, 1, 08001 Barcelona",
    website: null,
    platform: null,
    cardmarketUser: "TiendaCsv",
    enabled: true,
  };

  it("hace falta cardmarketUser y un enlace o el fichero en disco", () => {
    const paths: string[] = [];
    const exists = (path: string) => (paths.push(path), path.endsWith("tienda-csv.csv"));
    expect(hasCardmarketCsv(store, exists)).toBe(true);
    expect(paths[0]).toMatch(/data[\\/]cardmarket[\\/]tienda-csv\.csv$/);
    expect(hasCardmarketCsv(store, () => false)).toBe(false);
    expect(hasCardmarketCsv({ ...store, cardmarketCsv: { url: "https://tienda.example.com/stock.csv" } }, () => false)).toBe(true);
    expect(hasCardmarketCsv({ ...store, cardmarketUser: null }, () => true)).toBe(false);
  });
});
