import { readFileSync } from "node:fs";
import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import { nextPageUrls, parseHtmlListings } from "../adapters/html";
import type { HtmlSelectors } from "../types";

const SCRAPED_AT = "2026-10-18T10:00:00.000Z";
const PAGE_URL = "https://tierras-basicas.example.com/12-cartas-sueltas";
const html = readFileSync(new URL("./fixtures/prestashop-category.html", import.meta.url), "utf8");

/** Selectores del tema "classic" de PrestaShop 1.7/8 */
const prestashop: HtmlSelectors = {
  item: "article.product-miniature",
  // el tema recorta los nombres largos; el alt de la imagen va entero
  title: ".product-thumbnail img@alt",
  price: ".product-price-and-shipping .price",
  url: ".product-title a",
  stock: ".product-flag.out_of_stock",
};

function parse(selectors: HtmlSelectors, source = html) {
  return parseHtmlListings(load(source), { storeId: "tierras-basicas-sants", pageUrl: PAGE_URL, selectors, scrapedAt: SCRAPED_AT });
}

describe("parseHtmlListings (tema classic de PrestaShop)", () => {
  const { listings, skipped } = parse(prestashop);

  it("un listado por producto con precio; sin precio no cuenta", () => {
    expect(listings).toHaveLength(3);
    expect(skipped).toBe(1);
  });

  it("lee título, precio y enlace absoluto", () => {
    expect(listings[0]).toEqual({
      storeId: "tierras-basicas-sants",
      externalId: "https://tierras-basicas.example.com/cartas-sueltas/1234-lightning-bolt-m11.html",
      rawTitle: "Lightning Bolt (M11)",
      url: "https://tierras-basicas.example.com/cartas-sueltas/1234-lightning-bolt-m11.html",
      priceCents: 150,
      currency: "EUR",
      inStock: true,
      scrapedAt: SCRAPED_AT,
    });
  });

  it("usa el nombre completo del alt, el precio rebajado y quita el #fragmento", () => {
    expect(listings[1]).toMatchObject({
      rawTitle: "Sheoldred, the Apocalypse (DMU) - Foil",
      priceCents: 8096,
      url: "https://tierras-basicas.example.com/cartas-sueltas/1240-sheoldred-the-apocalypse-dmu.html",
    });
  });

  it("la etiqueta Agotado marca el producto sin stock", () => {
    expect(listings[2]).toMatchObject({ rawTitle: "The One Ring (LTR)", priceCents: 123456, inStock: false, quantity: 0 });
  });

  it("encuentra la página siguiente", () => {
    expect(nextPageUrls(load(html), PAGE_URL, ".pagination a[rel=next]")).toEqual(["https://tierras-basicas.example.com/12-cartas-sueltas?page=2"]);
  });

  it("sin selector de foto no hay imageUrl; con él, la de la miniatura", () => {
    expect(listings.every((l) => !("imageUrl" in l))).toBe(true);
    const withImage = parse({ ...prestashop, image: ".product-thumbnail img" }).listings;
    expect(withImage.map((l) => l.imageUrl)).toEqual([
      "https://tierras-basicas.example.com/5678-home_default/lightning-bolt-m11.jpg",
      "https://tierras-basicas.example.com/5690-home_default/sheoldred.jpg",
      "https://tierras-basicas.example.com/5701-home_default/the-one-ring.jpg",
    ]);
  });
});

describe("parseHtmlListings (foto del producto)", () => {
  const item = (img: string, n: number) =>
    `<div class="p"><a href="/p/${n}">Producto ${n}</a><span class="price">1,00 €</span>${img}</div>`;
  const page = [
    // carga diferida: en src un marcador data:…, la foto en data-src
    `<img src="data:image/svg+xml,%3Csvg%2F%3E" data-src="/wp-content/uploads/caja-300x300.png">`,
    // solo srcset (la primera URL), con protocolo relativo
    `<img data-srcset="//cdn.example.com/bundle-300.jpg 300w, //cdn.example.com/bundle-600.jpg 600w">`,
    // http o javascript: no valen
    `<img src="http://tierras-basicas.example.com/inseguro.jpg">`,
    `<img src="javascript:alert(1)">`,
    // sin imagen
    "",
    // una ruta relativa a la página
    `<img src="fotos/sobre.jpg#zoom" data-full="https://tierras-basicas.example.com/fotos/sobre-grande.jpg">`,
  ]
    .map(item)
    .join("");
  const selectors: HtmlSelectors = { item: ".p", title: "a", price: ".price", image: "img" };

  it("prueba data-src, src y srcset; resuelve rutas relativas y solo deja https", () => {
    const { listings } = parse(selectors, page);
    expect(listings.map((l) => l.imageUrl)).toEqual([
      "https://tierras-basicas.example.com/wp-content/uploads/caja-300x300.png",
      "https://cdn.example.com/bundle-300.jpg",
      undefined,
      undefined,
      undefined,
      "https://tierras-basicas.example.com/fotos/sobre.jpg",
    ]);
    expect(listings[2]).not.toHaveProperty("imageUrl");
  });

  it("con img@atributo lee solo ese atributo", () => {
    const { listings } = parse({ ...selectors, image: "img@data-full" }, page);
    expect(listings.map((l) => l.imageUrl ?? null)).toEqual([null, null, null, null, null, "https://tierras-basicas.example.com/fotos/sobre-grande.jpg"]);
  });
});

describe("parseHtmlListings (web a medida)", () => {
  const custom = `
    <table>
      <tr class="card-row">
        <td><a class="card-link" href="/carta/relampago-m10"><span class="card-name">Relámpago</span></a></td>
        <td class="card-set">Magic 2010</td>
        <td class="card-condition">Excelente</td>
        <td class="card-language">Español</td>
        <td class="card-price" data-price="0.80">0,80 €</td>
        <td class="card-stock">Quedan 3</td>
      </tr>
      <tr class="card-row">
        <td><a class="card-link" href="javascript:void(0)"><span class="card-name">Sin enlace</span></a></td>
        <td class="card-price" data-price="1.00">1,00 €</td>
      </tr>
    </table>
    <a class="next-page" href="https://otra-web.example.com/pagina-2">Siguiente</a>`;
  const selectors: HtmlSelectors = {
    item: ".card-row",
    title: ".card-name",
    price: ".card-price@data-price",
    url: "a.card-link",
    stock: ".card-stock",
    condition: ".card-condition",
    language: ".card-language",
    set: ".card-set",
  };

  it("lee atributos, estado, idioma, edición y cantidad", () => {
    const { listings, skipped } = parse(selectors, custom);
    expect(skipped).toBe(1);
    expect(listings).toEqual([
      {
        storeId: "tierras-basicas-sants",
        externalId: "https://tierras-basicas.example.com/carta/relampago-m10",
        rawTitle: "Relámpago",
        url: "https://tierras-basicas.example.com/carta/relampago-m10",
        priceCents: 80,
        currency: "EUR",
        inStock: true,
        quantity: 3,
        condition: "EX",
        language: "es",
        setHint: "Magic 2010",
        scrapedAt: SCRAPED_AT,
      },
    ]);
  });

  it("no sigue enlaces a otras webs", () => {
    expect(nextPageUrls(load(custom), PAGE_URL, "a.next-page")).toEqual([]);
  });

  it("sin selector de enlace usa el primer a[href] del producto", () => {
    const { listings } = parse({ item: ".card-row", title: ".card-name", price: ".card-price" }, custom);
    expect(listings[0]?.url).toBe("https://tierras-basicas.example.com/carta/relampago-m10");
  });
});
