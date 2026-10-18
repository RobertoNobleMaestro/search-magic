import { describe, expect, it } from "vitest";
import { parseWooProducts, wooCommerceAdapter } from "../adapters/woocommerce";
import type { WebStoreConfig } from "../types";
import products from "./fixtures/woocommerce-products.json";
import variations from "./fixtures/woocommerce-variations.json";

const SCRAPED_AT = "2026-10-18T10:00:00.000Z";
const opts = { storeId: "bazar-arcano-eixample", scrapedAt: SCRAPED_AT };

describe("parseWooProducts", () => {
  const page = parseWooProducts(products, opts);

  it("un listado por producto simple; los variables se apuntan para la segunda pasada", () => {
    expect(page.listings.map((l) => l.externalId)).toEqual(["101", "102"]);
    expect(page.variableIds).toEqual([103]);
    expect(page.count).toBe(4);
  });

  it("precio en unidades mínimas, stock, cantidad y atributos", () => {
    expect(page.listings[0]).toEqual({
      storeId: "bazar-arcano-eixample",
      externalId: "101",
      rawTitle: "Lightning Bolt (M11)",
      url: "https://bazar-arcano.example.com/producto/lightning-bolt-m11/",
      priceCents: 150,
      currency: "EUR",
      inStock: true,
      quantity: 2,
      language: "en",
      condition: "NM",
      scrapedAt: SCRAPED_AT,
    });
  });

  it("decodifica las entidades HTML del nombre y respeta el agotado", () => {
    expect(page.listings[1]).toMatchObject({ rawTitle: "Urza’s Saga (MH2) – Foil", priceCents: 4200, inStock: false });
    expect(page.listings[1]).not.toHaveProperty("quantity");
  });

  it("las variaciones traen su propio precio, stock y atributos; solo las de productos vistos", () => {
    const second = parseWooProducts(variations, { ...opts, parents: new Set(page.variableIds) });
    expect(second.listings).toEqual([
      {
        storeId: "bazar-arcano-eixample",
        externalId: "501",
        rawTitle: "Counterspell",
        url: "https://bazar-arcano.example.com/producto/counterspell/?attribute_pa_idioma=espanol&attribute_pa_acabado=normal",
        priceCents: 95,
        currency: "EUR",
        inStock: true,
        language: "es",
        finish: "nonfoil",
        scrapedAt: SCRAPED_AT,
      },
      expect.objectContaining({ externalId: "502", priceCents: 350, inStock: false, language: "en", finish: "foil" }),
    ]);
    expect(second.count).toBe(3);
  });

  it("descarta otras monedas y productos sin precio", () => {
    const [simple] = products;
    const usd = { ...simple, id: 900, prices: { ...simple!.prices, currency_code: "USD" } };
    const free = { ...simple, id: 901, prices: { ...simple!.prices, price: "0" } };
    expect(parseWooProducts([usd, free, { id: 902, name: "roto" }], opts).listings).toEqual([]);
  });

  it("falla si la respuesta no es una lista de productos", () => {
    expect(() => parseWooProducts({ code: "rest_no_route" }, opts)).toThrow();
  });
});

describe("wooCommerceAdapter.startUrls", () => {
  const store: WebStoreConfig = {
    id: "bazar-arcano-eixample",
    name: "Bazar Arcano",
    city: "Barcelona",
    province: "Barcelona",
    local: true,
    address: "Carrer del Consell de Cent, 215, 08011 Barcelona",
    website: "https://bazar-arcano.example.com",
    platform: "woocommerce",
    cardmarketUser: null,
    enabled: true,
  };

  it("todo el catálogo o las categorías configuradas, 100 por página", () => {
    expect(wooCommerceAdapter.startUrls(store)).toEqual([
      "https://bazar-arcano.example.com/wp-json/wc/store/v1/products?per_page=100&page=1",
    ]);
    expect(wooCommerceAdapter.startUrls({ ...store, website: "https://bazar-arcano.example.com/tienda/", woocommerce: { categories: ["15"] } })).toEqual([
      "https://bazar-arcano.example.com/tienda/wp-json/wc/store/v1/products?category=15&per_page=100&page=1",
    ]);
  });
});
