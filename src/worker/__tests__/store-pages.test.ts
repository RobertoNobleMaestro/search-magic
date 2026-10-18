import { readFileSync } from "node:fs";
import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import { nextPageUrls, parseHtmlListings } from "../adapters/html";
import { parseRebellionPage } from "../adapters/rebellion";
import { parseShopifyProducts } from "../adapters/shopify";
import { parseWooProducts } from "../adapters/woocommerce";
import { STORES } from "../stores.config";

/**
 * Los adaptadores contra muestras reales recortadas (fixtures/stores, 18/10/2026) y con la
 * configuración real de stores.config.ts.
 */

const SCRAPED_AT = "2026-10-18T10:00:00.000Z";
const fixture = (name: string, encoding = "utf-8") =>
  new TextDecoder(encoding).decode(readFileSync(new URL(`./fixtures/stores/${name}`, import.meta.url)));
const json = (name: string): unknown => JSON.parse(fixture(name));
const store = (id: string) => STORES.find((s) => s.id === id)!;

function shopify(id: string, name: string) {
  return parseShopifyProducts(json(name), { storeId: id, baseUrl: store(id).website!, scrapedAt: SCRAPED_AT }).listings;
}

function html(id: string, name: string, pageUrl: string, encoding?: string) {
  const $ = load(fixture(name, encoding));
  const { selectors, nextPage } = store(id).html!;
  const page = parseHtmlListings($, { storeId: id, pageUrl, selectors, scrapedAt: SCRAPED_AT });
  return { ...page, next: nextPage ? nextPageUrls($, pageUrl, nextPage) : [] };
}

describe("Shopify", () => {
  it("El Duelista: quita los U+2063 del título y la opción Edition es el acabado", () => {
    const listings = shopify("el-duelista", "shopify-elduelista-magic-single.json");
    expect(listings).toHaveLength(7);
    expect(listings[0]).toEqual({
      storeId: "el-duelista",
      externalId: "50983124238667",
      rawTitle: "Eldrazi Ravager - Modern Horizons 3 (Uncommon) [5]",
      url: "https://www.elduelista.com/products/eldrazi-ravager-modern-horizons-3-uncommon-5?variant=50983124238667",
      priceCents: 20,
      currency: "EUR",
      inStock: true,
      language: "en",
      condition: "NM",
      finish: "nonfoil",
      scrapedAt: SCRAPED_AT,
    });
    // "Foil Normal" es foil, no una edición
    expect(listings[1]).toMatchObject({ rawTitle: "Avishkar Raceway - Aetherdrift: Promos (Common) [425]", finish: "foil" });
    expect(listings.every((l) => !l.setHint && !/\p{Cf}/u.test(l.rawTitle))).toBe(true);
    // una variante por idioma, cada una con su precio y su stock
    expect(listings.filter((l) => l.rawTitle.startsWith("Dockside")).map((l) => [l.language, l.priceCents, l.inStock])).toEqual([
      ["es", 2499, false],
      ["en", 1294, true],
    ]);
  });

  it("Universe TCG: mismas variantes, títulos con [SET-número]", () => {
    const listings = shopify("universe-tcg", "shopify-universetcg-magic-single.json");
    expect(listings).toHaveLength(6);
    expect(listings[0]).toMatchObject({
      rawTitle: "Prismari, the Inspiration - Secrets of Strixhaven: Extras (Mythic) [XSOS-285]",
      priceCents: 1885,
      inStock: true,
      language: "es",
      condition: "NM",
      finish: "nonfoil",
    });
    expect(listings[1]).toMatchObject({ rawTitle: "Super Shredder - Teenage Mutant Ninja Turtles (Mythic) [TMT-83]", inStock: false });
  });

  it("El Nucli: sellado con variantes por idioma; lo que no es idioma va al título", () => {
    const listings = shopify("el-nucli", "shopify-elnucli-magic-sellado.json");
    expect(listings).toHaveLength(10);
    expect(listings.slice(0, 2).map((l) => [l.rawTitle, l.language, l.priceCents])).toEqual([
      ["Magic: The Gathering® | Star Trek™ | Caja de Sobres de Juego", "es", 17500],
      ["Magic: The Gathering® | Star Trek™ | Caja de Sobres de Juego", "en", 17500],
    ]);
    expect(listings.map((l) => l.rawTitle)).toContain("Magic: The Gathering® | Star Trek™ | Scene Box - Enterprise-Q");
    expect(listings.find((l) => l.rawTitle === "Reality Fracture | Mazo de Commander" && l.language === "en")).toMatchObject({ inStock: false });
  });
});

describe("WooCommerce", () => {
  it("MTG Canarias (variations: false): una ficha por producto variable, con el precio mínimo y sin pedir variaciones", () => {
    expect(store("mtg-canarias").woocommerce).toEqual({ categories: ["400"], variations: false });
    const page = parseWooProducts(json("woocommerce-mtgcanarias-cartas-sueltas.json"), {
      storeId: "mtg-canarias",
      scrapedAt: SCRAPED_AT,
      variableAsListing: true,
    });
    expect(page.variableIds).toEqual([]);
    expect(page.listings).toHaveLength(6);
    // price_range.min_amount (95), no prices.price (695, la variación por defecto)
    expect(page.listings.find((l) => l.externalId === "313644")).toEqual({
      storeId: "mtg-canarias",
      externalId: "313644",
      rawTitle: "Tam, la Posibilidad (Borderless)",
      url: "https://mtgcanarias.com/tienda/cartas-sueltas/realidad-fracturada/tam-the-possibility-2/",
      priceCents: 95,
      currency: "EUR",
      inStock: true,
      // el código de "Conjunto" gana a la "Colección" (Realidad fracturada)
      setHint: "FRA",
      // todas sus variaciones son near-mint; idioma y acabado varían, así que no se rellenan
      condition: "NM",
      scrapedAt: SCRAPED_AT,
    });
    // con una sola variación (foil, inglés) sí se sabe todo; sin stock en la ficha → agotado
    expect(page.listings[0]).toMatchObject({
      rawTitle: "Enfrentamiento decisivo (Borderless)",
      setHint: "PMEI",
      condition: "NM",
      finish: "foil",
      language: "en",
      inStock: false,
    });
  });

  it("MTG Canarias con la segunda pasada: los productos variables quedan pendientes", () => {
    const page = parseWooProducts(json("woocommerce-mtgcanarias-cartas-sueltas.json"), { storeId: "mtg-canarias", scrapedAt: SCRAPED_AT });
    expect(page.listings).toEqual([]);
    expect(page.variableIds).toHaveLength(6);
  });

  it("Industria 61: sellado simple con stock y unidades", () => {
    const page = parseWooProducts(json("woocommerce-industria61-sellado.json"), { storeId: "industria-61", scrapedAt: SCRAPED_AT, variableAsListing: true });
    expect(page.listings.map((l) => [l.rawTitle, l.priceCents, l.inStock, l.quantity])).toEqual([
      ["MTG – Fallout Commander Deck – Scrappy Survivors – ING", 5695, true, 1],
      ["MTG – FALLOUT COMMANDER DECK – Hail, Caesar – ING", 5695, false, 0],
      ["MTG Reality Fracture Collector Booster- EN", 3000, false, 0],
      ["MTG Sobre de Juego Realidad Facturada – Castellano", 500, true, undefined],
      ["MTG – Play Booster EL HOBBIT – Cast", 650, true, undefined],
    ]);
    // la marca ("Brand") no es un atributo del listado
    expect(page.listings.every((l) => !l.setHint && !l.condition && !l.language)).toBe(true);
  });
});

describe("HTML", () => {
  it("Magic Barcelona: precio rebajado, el mínimo de un variable y la página siguiente con el filtro", () => {
    const page = html("magic-barcelona", "html-magicbarcelona-sellado.html", store("magic-barcelona").html!.startUrls[0]!);
    expect(page.skipped).toBe(0);
    expect(page.listings).toHaveLength(6);
    expect(page.listings[0]).toEqual({
      storeId: "magic-barcelona",
      externalId: "https://www.magicbarcelona.net/product/magic-the-gathering-star-trek-scene-box/",
      rawTitle: "Magic: The Gathering – Star Trek™ – Scene Box",
      url: "https://www.magicbarcelona.net/product/magic-the-gathering-star-trek-scene-box/",
      priceCents: 3499,
      currency: "EUR",
      inStock: true,
      scrapedAt: SCRAPED_AT,
    });
    expect(page.listings[1]).toMatchObject({ rawTitle: "Commander: Magic: The Gathering – Star Trek™ – Deck (Collector’s Edition)", priceCents: 13999 });
    expect(page.next).toEqual(["https://www.magicbarcelona.net/tienda/page/2/?swoof=1&product_cat=producto-sellado"]);
  });

  it("Magic Barcelona: los agotados del listado (clase outofstock) salen sin stock", () => {
    // la muestra solo tiene productos con stock: se marca agotado el último, como lo pinta WooCommerce
    const soldOut = fixture("html-magicbarcelona-sellado.html").replace(
      "status-publish instock product_cat-booster-box",
      "status-publish outofstock product_cat-booster-box",
    );
    const $ = load(soldOut);
    const { selectors } = store("magic-barcelona").html!;
    const pageUrl = store("magic-barcelona").html!.startUrls[0]!;
    const { listings } = parseHtmlListings($, { storeId: "magic-barcelona", pageUrl, selectors, scrapedAt: SCRAPED_AT });
    expect(listings.map((l) => l.inStock)).toEqual([true, true, true, true, true, false]);
    expect(listings[5]).toMatchObject({ rawTitle: "Magic: The Gathering – Star Trek™ – Draft Night", quantity: 0 });
  });

  // (desactivada: /page/2/ repite los 40 productos de la primera página; ver notes)
  it("inGenio: rango de precios y rebajas; el enlace de la cabecera, por ruta y sin parámetros", () => {
    const page = html("ingenio", "html-ingenio-magic.html", "https://www.ingeniobcn.com/magic-the-gathering/");
    expect(page.listings.map((l) => [l.rawTitle, l.priceCents])).toEqual([
      ["30TH Anniversary Edition", 134995],
      ["Aether Revolt Caja de Sobres", 14995],
      ["Aetherdrift Bundle", 4245],
      ["Aetherdrift Bundle Finish Line", 7220],
      ["Aetherdrift Collector Boosters Box", 23845],
      ["Aetherdrift Commander Deck: Living Energy", 4045],
    ]);
    expect(page.listings[1]!.url).toBe("https://www.ingeniobcn.com/magic-the-gathering/sobres/aether-revolt-caja-de-sobres/");
    expect(page.next).toEqual(["https://www.ingeniobcn.com/magic-the-gathering/page/2/"]);
  });

  it("Dungeon Marvels (desactivada): lee el listado, pero los títulos vienen recortados y no hay página siguiente", () => {
    const page = html("dungeon-marvels", "html-dungeonmarvels-magic.html", "https://dungeonmarvels.com/185-magic");
    expect(page.listings).toHaveLength(5);
    expect(page.listings[0]).toMatchObject({
      rawTitle: "Magic Marvel: Destino del Darkhold - Mazo de Commander Señores de...",
      priceCents: 8395,
      inStock: false,
      quantity: 0,
    });
    expect(page.next).toEqual([]);
  });

  it("El Rincón de Magic: de la categoría de sueltas salen las ediciones (con <base href>)", () => {
    const page = html("el-rincon-de-magic", "html-elrincondemagic-cartas-sueltas.html", "https://www.elrincondemagic.com/Cartas-Sueltas");
    expect(page.listings).toEqual([]);
    expect(page.next).toHaveLength(5);
    expect(page.next[0]).toBe("https://www.elrincondemagic.com/epages/64576138.sf/es_ES/?ObjectPath=/Shops/64576138/Categories/Cartas_Sueltas/Realidad_Fracturada");
  });

  it("El Rincón de Magic: una edición, con el precio 'desde' del atributo itemprop y la página siguiente", () => {
    const pageUrl = "https://www.elrincondemagic.com/epages/64576138.sf/es_ES/?ObjectPath=/Shops/64576138/Categories/Cartas_Sueltas/Lorwyn_Eclipsado";
    const page = html("el-rincon-de-magic", "html-elrincondemagic-lorwyn-eclipsado.html", pageUrl);
    expect(page.skipped).toBe(0);
    expect(page.listings).toHaveLength(12);
    expect(page.listings[0]).toEqual({
      storeId: "el-rincon-de-magic",
      externalId: "https://www.elrincondemagic.com/epages/64576138.sf/es_ES/?ObjectPath=/Shops/64576138/Products/MTGECL001",
      rawTitle: "BUSCACAMINOS CAMBIAFORMAS / CHANGELING WAYFINDER (LORWYN ECLIPSADO)",
      url: "https://www.elrincondemagic.com/epages/64576138.sf/es_ES/?ObjectPath=/Shops/64576138/Products/MTGECL001",
      priceCents: 15,
      currency: "EUR",
      inStock: true,
      scrapedAt: SCRAPED_AT,
    });
    expect(page.listings[11]).toMatchObject({ rawTitle: "COLOSA CURIOSA / CURIOUS COLOSSUS (LORWYN ECLIPSADO)", priceCents: 175 });
    expect(page.next).toEqual([
      "https://www.elrincondemagic.com/epages/64576138.sf/es_ES/?ViewAction=View&ObjectID=262374502&PageSize=48&Page=2&FocusReference=PagerCurrentPageID",
    ]);
  });
});

describe("Rebellion (lector propio, ISO-8859-1)", () => {
  const { selectors, nextPage, encoding } = store("rebellion").html!;
  const parse = (name: string, pageUrl: string) => {
    const $ = load(fixture(name, encoding));
    return { ...parseRebellionPage($, { storeId: "rebellion", pageUrl, selectors, scrapedAt: SCRAPED_AT }), next: nextPageUrls($, pageUrl, nextPage!) };
  };

  it("del índice salen las ediciones del menú de cartas sueltas", () => {
    const page = parse("html-rebellion-index.html", "https://www.rebellion.es/tiendarebel/index.php");
    expect(page.listings).toEqual([]);
    expect(page.next.slice(0, 2)).toEqual([
      "https://www.rebellion.es/tiendarebel/verampliacion.php?idAmpl=544",
      "https://www.rebellion.es/tiendarebel/verampliacion.php?idAmpl=445",
    ]);
    expect(page.next.every((url) => /verampliacion\.php\?idAmpl=\d+$/.test(url))).toBe(true);
  });

  it("una edición: un listado por variante (idioma × estado/foil), con edición y número", () => {
    const pageUrl = "https://www.rebellion.es/tiendarebel/verampliacion.php?idAmpl=543";
    const page = parse("html-rebellion-ampliacion-543.html", pageUrl);
    expect(page.skipped).toBe(0);
    expect(page.listings).toHaveLength(17);
    expect(page.listings[0]).toEqual({
      storeId: "rebellion",
      externalId: "FRA0048_1_1",
      rawTitle: "Acechabrujas alfa / Apex Witchstalker",
      url: pageUrl,
      priceCents: 15,
      currency: "EUR",
      inStock: true,
      language: "es",
      condition: "EX",
      setHint: "FRA",
      collectorNumber: "48",
      kind: "single",
      scrapedAt: SCRAPED_AT,
    });
    expect(page.listings.slice(1, 4).map((l) => [l.externalId, l.language, l.condition, l.finish, l.priceCents])).toEqual([
      ["FRA0048_1_5", "es", undefined, "foil", 25],
      ["FRA0048_2_1", "en", "EX", undefined, 15],
      ["FRA0048_2_5", "en", undefined, "foil", 25],
    ]);
    // mismo nombre en los dos idiomas: sin repetir
    expect(page.listings.find((l) => l.externalId === "FRA0121_1_1")).toMatchObject({ rawTitle: "Aerid Konstrari", priceCents: 399 });
  });

  it("las cartas de la página 2 en adelante se anotan como sin leer (necesitan la sesión)", () => {
    const pageUrl = "https://www.rebellion.es/tiendarebel/verampliacion.php?idAmpl=543";
    expect(parse("html-rebellion-ampliacion-543.html", pageUrl).unread).toEqual([
      { url: pageUrl, error: "solo se leen las 25 primeras cartas de 290: la paginación de Rebellion necesita su cookie de sesión" },
    ]);
  });
});
