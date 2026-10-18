import { describe, expect, it } from "vitest";
import { parseStoreConfigs } from "../config";
import { STORES } from "../stores.config";
import type { StoreConfig } from "../types";

const shopify: StoreConfig = {
  id: "tienda-shopify",
  name: "Tienda Shopify",
  city: "Barcelona",
  province: "Barcelona",
  local: true,
  address: "Carrer Fals, 1, 08001 Barcelona",
  website: "https://shopify.example.com",
  platform: "shopify",
  cardmarketUser: null,
  enabled: true,
};

const prestashop: StoreConfig = {
  id: "tienda-prestashop",
  name: "Tienda PrestaShop",
  city: "L'Hospitalet de Llobregat",
  province: "Barcelona",
  local: true,
  address: "Carrer Fals, 2, 08901 L'Hospitalet de Llobregat",
  website: "https://prestashop.example.com",
  platform: "prestashop",
  cardmarketUser: null,
  enabled: true,
  html: {
    startUrls: ["https://prestashop.example.com/12-cartas-sueltas"],
    selectors: { item: "article.product-miniature", title: ".product-thumbnail img@alt", price: ".price" },
    nextPage: "a[rel=next]",
  },
};

/** Tienda física que solo nos manda su CSV de Cardmarket */
const csvOnly: StoreConfig = {
  id: "tienda-csv",
  name: "Tienda CSV",
  city: "Barcelona",
  province: "Barcelona",
  local: true,
  address: "Carrer Fals, 3, 08001 Barcelona",
  website: null,
  platform: null,
  cardmarketUser: "TiendaCsv",
  enabled: true,
};

/** Tienda online de fuera de la zona */
const online: StoreConfig = {
  id: "tienda-online",
  name: "Tienda Online",
  city: "Madrid",
  province: "Madrid",
  local: false,
  address: null,
  website: "https://online.example.com",
  platform: "woocommerce",
  cardmarketUser: null,
  enabled: true,
  crawlDelaySeconds: 5,
};

function problems(stores: unknown): string {
  try {
    parseStoreConfigs(stores);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("se esperaba un error de validación");
}

describe("parseStoreConfigs", () => {
  it("acepta las tiendas de stores.config.ts (las comprueba en detalle stores.test.ts)", () => {
    expect(parseStoreConfigs(STORES)).toHaveLength(STORES.length);
  });

  it("acepta tiendas mínimas: con web, solo Cardmarket y online", () => {
    expect(parseStoreConfigs([shopify, prestashop, csvOnly, online])).toEqual([shopify, prestashop, csvOnly, online]);
  });

  it("acepta las opciones del CSV de Cardmarket y la codificación del HTML", () => {
    const csv = { ...csvOnly, cardmarketCsv: { file: "data/cardmarket/otra.csv", encoding: "windows-1252", columns: { price: "Preu" } } };
    const html = { ...prestashop, html: { ...prestashop.html!, encoding: "ISO-8859-1" } };
    expect(parseStoreConfigs([csv, html])).toEqual([csv, html]);
  });

  it("rechaza ids repetidos", () => {
    expect(problems([shopify, { ...prestashop, id: shopify.id }])).toContain('id repetido: "tienda-shopify"');
  });

  it("exige URLs https", () => {
    const message = problems([{ ...shopify, website: "http://shopify.example.com" }]);
    expect(message).toContain("tienda-shopify.website");
    expect(message).toContain("https://");
    expect(problems([{ ...shopify, website: "shopify.example.com" }])).toContain("tienda-shopify.website");
    expect(problems([{ ...csvOnly, cardmarketCsv: { url: "http://tienda.example.com/stock.csv" } }])).toContain("tienda-csv.cardmarketCsv.url");
  });

  it("exige un slug como id", () => {
    expect(problems([{ ...shopify, id: "Tienda Shopify" }])).toContain("slug");
  });

  it("exige todos los campos de StoreInfo (null si no hay)", () => {
    const { cardmarketUser: _, ...withoutUser } = shopify;
    expect(problems([withoutUser])).toContain("tienda-shopify.cardmarketUser");
  });

  it("platform necesita website; una tienda local, dirección y una ciudad de la zona", () => {
    expect(problems([{ ...shopify, website: null }])).toContain('tienda-shopify.website: con platform "shopify" hace falta la web');
    expect(problems([{ ...shopify, address: null }])).toContain("tienda-shopify.address");
    expect(problems([{ ...shopify, city: "barcelona" }])).toContain('tienda-shopify.city: una tienda local tiene que estar en "Barcelona"');
    expect(problems([{ ...online, city: "Madrid", local: true, address: "Gran Vía, 1" }])).toContain("tienda-online.city");
  });

  it("exige las opciones html en PrestaShop y en webs a medida", () => {
    const { html: _, ...withoutHtml } = prestashop;
    expect(problems([withoutHtml])).toContain("tienda-prestashop.html: una tienda prestashop necesita html");
    expect(problems([{ ...prestashop, html: { ...prestashop.html, selectors: { item: "article" } } }])).toContain(
      "tienda-prestashop.html.selectors.title",
    );
    expect(problems([{ ...prestashop, html: { ...prestashop.html!, startUrls: [] } }])).toContain("html.startUrls");
  });

  it("no deja poner opciones de otra plataforma ni de una web que no hay", () => {
    expect(problems([{ ...shopify, html: prestashop.html }])).toContain("tienda-shopify.html: no sirve para una tienda shopify");
    expect(problems([{ ...shopify, woocommerce: { categories: ["singles"] } }])).toContain("tienda-shopify.woocommerce");
    expect(problems([{ ...csvOnly, shopify: {} }])).toContain("tienda-csv.shopify: no sirve para una tienda sin platform");
    expect(problems([{ ...csvOnly, crawlDelaySeconds: 2 }])).toContain("tienda-csv.crawlDelaySeconds");
  });

  it("exige que las startUrls sean del dominio de la tienda", () => {
    const html = { ...prestashop.html!, startUrls: ["https://otra-tienda.example.com/magic"] };
    expect(problems([{ ...prestashop, html }])).toContain("tienda-prestashop.html.startUrls.0: tiene que ser de https://prestashop.example.com");
  });

  it("detecta selectores CSS rotos y codificaciones desconocidas", () => {
    const html = { ...prestashop.html!, selectors: { ...prestashop.html!.selectors, price: "span[class=" } };
    expect(problems([{ ...prestashop, html }])).toContain("tienda-prestashop.html.selectors.price: no es un selector CSS válido");
    expect(problems([{ ...prestashop, html: { ...prestashop.html!, encoding: "klingon" } }])).toContain("html.encoding: codificación desconocida");
  });

  it("el CSV de Cardmarket necesita cardmarketUser y nunca un enlace de cardmarket.com", () => {
    expect(problems([{ ...shopify, cardmarketCsv: {} }])).toContain("tienda-shopify.cardmarketCsv: hace falta cardmarketUser");
    expect(problems([{ ...csvOnly, cardmarketCsv: { url: "https://www.cardmarket.com/es/Magic/Users/TiendaCsv" } }])).toContain(
      "no se descarga nada de cardmarket.com",
    );
    expect(problems([{ ...csvOnly, cardmarketUser: "https://www.cardmarket.com/es/Magic/Users/TiendaCsv" }])).toContain(
      "tienda-csv.cardmarketUser: solo el nombre de usuario",
    );
    expect(problems([{ ...csvOnly, cardmarketCsv: { columns: { precio: "Preu" } } }])).toContain("cardmarketCsv.columns");
  });

  it("acota crawlDelaySeconds", () => {
    expect(problems([{ ...online, crawlDelaySeconds: 0 }])).toContain("tienda-online.crawlDelaySeconds");
    expect(problems([{ ...online, crawlDelaySeconds: 120 }])).toContain("más de 60 s");
  });

  it("detecta claves mal escritas", () => {
    expect(problems([{ ...shopify, enable: true }])).toContain("enable");
    expect(problems([{ ...shopify, shopify: { colections: ["magic"] } }])).toContain("colections");
    expect(problems([{ ...csvOnly, cardmarketCsv: { path: "x.csv" } }])).toContain("path");
  });
});
