import { describe, expect, it } from "vitest";
import { parseShopifyProducts, shopifyAdapter } from "../adapters/shopify";
import type { WebStoreConfig } from "../types";
import fixture from "./fixtures/shopify-products.json";

const SCRAPED_AT = "2026-10-18T10:00:00.000Z";
const base = { storeId: "cofre-mana-gracia", baseUrl: "https://cofre-mana.example.com", scrapedAt: SCRAPED_AT };

describe("parseShopifyProducts", () => {
  const { listings, productIds } = parseShopifyProducts(fixture, base);
  const byId = new Map(listings.map((l) => [l.externalId, l]));

  it("saca un listado por variante, incluido el producto sellado si no se filtra", () => {
    expect(listings).toHaveLength(10);
    expect(productIds).toEqual(["8012345678901", "8012345678902", "8012345678903", "8012345678904", "8012345678905"]);
  });

  it("lee precio, stock, enlace y opciones de estado e idioma", () => {
    expect(byId.get("44123456789001")).toEqual({
      storeId: "cofre-mana-gracia",
      externalId: "44123456789001",
      rawTitle: "Lightning Bolt [M11]",
      url: "https://cofre-mana.example.com/products/lightning-bolt-m11?variant=44123456789001",
      priceCents: 150,
      currency: "EUR",
      inStock: true,
      condition: "NM",
      language: "en",
      scrapedAt: SCRAPED_AT,
    });
    expect(byId.get("44123456789002")).toMatchObject({ priceCents: 125, condition: "NM", language: "es", inStock: true });
  });

  it("las variantes agotadas salen sin stock", () => {
    expect(byId.get("44123456789003")).toMatchObject({ priceCents: 100, condition: "LP", inStock: false });
    expect(byId.get("44123456789013")).toMatchObject({ condition: "EX", language: "es", finish: "nonfoil", inStock: false });
  });

  it("separa estado, idioma y acabado de una variante con todo junto", () => {
    expect(byId.get("44123456789011")).toMatchObject({
      rawTitle: "Sheoldred, the Apocalypse (DMU)",
      priceCents: 8495,
      condition: "NM",
      language: "es",
      finish: "foil",
    });
    expect(byId.get("44123456789012")).toMatchObject({ priceCents: 6250, language: "en", finish: "nonfoil" });
  });

  it("toma la edición de la opción Edición", () => {
    expect(byId.get("44123456789021")).toMatchObject({ rawTitle: "Birds of Paradise", setHint: "Magic 2010", condition: "NM" });
    expect(byId.get("44123456789022")).toMatchObject({ setHint: "Ravnica Remastered", priceCents: 450 });
  });

  it("no inventa atributos en los productos sin variantes", () => {
    const counterspell = byId.get("44123456789031")!;
    expect(counterspell).toMatchObject({ rawTitle: "Counterspell (Tempest Remastered)", priceCents: 95 });
    expect(counterspell).not.toHaveProperty("condition");
    expect(counterspell).not.toHaveProperty("language");
    expect(counterspell).not.toHaveProperty("finish");
  });

  it("filtra por product_type sin distinguir mayúsculas", () => {
    const filtered = parseShopifyProducts(fixture, { ...base, productTypes: ["mtg single"] });
    expect(filtered.listings).toHaveLength(9);
    expect(filtered.listings.some((l) => l.rawTitle.startsWith("Bloomburrow"))).toBe(false);
    // los ids de producto incluyen los filtrados: sirven para saber cuándo se acaba la paginación
    expect(filtered.productIds).toHaveLength(5);
  });

  it("añade al título lo que la variante tiene de más", () => {
    const product = {
      id: 1,
      title: "Lightning Bolt",
      handle: "lightning-bolt",
      options: [{ name: "Title" }],
      variants: [{ id: 2, title: "M10 / NM", option1: "M10 / NM", price: "2.00", available: true }],
    };
    const [listing] = parseShopifyProducts({ products: [product] }, base).listings;
    expect(listing).toMatchObject({ rawTitle: "Lightning Bolt - M10 / NM", condition: "NM" });
  });

  it("descarta productos mal formados y variantes sin precio", () => {
    const products = [
      { id: 1, title: "Sin handle", variants: [] },
      { id: 2, title: "Gratis", handle: "gratis", variants: [{ id: 3, price: "0.00", available: true }] },
    ];
    expect(parseShopifyProducts({ products }, base)).toEqual({ listings: [], productIds: ["2"] });
  });

  it("falla si la respuesta no es un products.json", () => {
    expect(() => parseShopifyProducts({ error: "Not found" }, base)).toThrow();
  });
});

describe("shopifyAdapter.startUrls", () => {
  const store: WebStoreConfig = {
    id: "cofre-mana-gracia",
    name: "El Cofre del Maná",
    city: "Barcelona",
    province: "Barcelona",
    local: true,
    address: "Carrer de Verdi, 42, 08012 Barcelona",
    website: "https://cofre-mana.example.com/",
    platform: "shopify",
    cardmarketUser: null,
    enabled: true,
  };

  it("todo el catálogo o las colecciones configuradas, 250 por página", () => {
    expect(shopifyAdapter.startUrls(store)).toEqual(["https://cofre-mana.example.com/products.json?limit=250&page=1"]);
    expect(shopifyAdapter.startUrls({ ...store, shopify: { collections: ["magic-singles", "ofertas"] } })).toEqual([
      "https://cofre-mana.example.com/collections/magic-singles/products.json?limit=250&page=1",
      "https://cofre-mana.example.com/collections/ofertas/products.json?limit=250&page=1",
    ]);
  });
});
