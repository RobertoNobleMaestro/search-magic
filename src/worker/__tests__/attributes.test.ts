import { describe, expect, it } from "vitest";
import { parseAttributes, parseStock } from "../attributes";

describe("parseAttributes", () => {
  it("lee las opciones con nombre (Shopify, WooCommerce)", () => {
    expect(
      parseAttributes([
        { name: "Condition", value: "Lightly Played" },
        { name: "Language", value: "Spanish" },
        { name: "Finish", value: "Foil" },
      ]),
    ).toEqual({ attrs: { condition: "LP", language: "es", finish: "foil" }, unrecognized: false });
    expect(
      parseAttributes([
        { name: "Estado", value: "Casi nueva" },
        { name: "Idioma", value: "Japonés" },
        { name: "Edición", value: "Magic 2010" },
      ]),
    ).toEqual({ attrs: { condition: "NM", language: "ja", setHint: "Magic 2010" }, unrecognized: false });
  });

  it("separa una variante con todo junto", () => {
    expect(parseAttributes([{ name: "Title", value: "NM / Español / Foil" }]).attrs).toEqual({
      condition: "NM",
      language: "es",
      finish: "foil",
    });
    expect(parseAttributes([{ value: "Near Mint - English" }]).attrs).toEqual({ condition: "NM", language: "en" });
    expect(parseAttributes([{ value: "Lightly Played Foil" }]).attrs).toEqual({ condition: "LP", finish: "foil" });
    expect(parseAttributes([{ value: "EX / Inglés / Normal" }]).attrs).toEqual({ condition: "EX", language: "en", finish: "nonfoil" });
  });

  it("no confunde 'mint' con 'near mint' ni 'played' con 'lightly played'", () => {
    expect(parseAttributes([{ value: "Mint" }]).attrs.condition).toBe("MT");
    expect(parseAttributes([{ value: "Near Mint" }]).attrs.condition).toBe("NM");
    expect(parseAttributes([{ value: "Played" }]).attrs.condition).toBe("PL");
    expect(parseAttributes([{ value: "Heavily Played" }]).attrs.condition).toBe("PL");
    expect(parseAttributes([{ value: "Moderately Played" }]).attrs.condition).toBe("GD");
  });

  it("distingue foil, etched y no foil", () => {
    expect(parseAttributes([{ value: "Foil Etched" }]).attrs.finish).toBe("etched");
    expect(parseAttributes([{ value: "Non-Foil" }]).attrs.finish).toBe("nonfoil");
    expect(parseAttributes([{ name: "Foil", value: "Sí" }]).attrs.finish).toBe("foil");
    expect(parseAttributes([{ name: "Foil", value: "No" }]).attrs.finish).toBe("nonfoil");
  });

  it("en texto libre solo cuenta las abreviaturas en mayúsculas", () => {
    expect(parseAttributes([{ value: "NM / ES" }]).attrs).toEqual({ condition: "NM", language: "es" });
    expect(parseAttributes([{ value: "es de oferta" }]).attrs).toEqual({});
    // con el nombre de la opción ya se sabe qué es
    expect(parseAttributes([{ name: "Idioma", value: "es" }]).attrs).toEqual({ language: "es" });
    expect(parseAttributes([{ name: "Estado", value: "nm" }]).attrs).toEqual({ condition: "NM" });
  });

  it("avisa cuando una variante lleva algo más que estado, idioma o acabado", () => {
    expect(parseAttributes([{ value: "M10 / NM" }])).toEqual({ attrs: { condition: "NM" }, unrecognized: true });
    expect(parseAttributes([{ name: "Title", value: "Default Title" }])).toEqual({ attrs: {}, unrecognized: false });
  });

  it("ignora valores vacíos y se queda con el primero de cada tipo", () => {
    expect(
      parseAttributes([
        { name: "Idioma", value: "" },
        { name: "Idioma", value: null },
        { name: "Idioma", value: "Francés" },
        { name: "Language", value: "German" },
      ]).attrs,
    ).toEqual({ language: "fr" });
  });
});

describe("parseStock", () => {
  it.each([
    ["Agotado", { inStock: false, quantity: 0 }],
    ["Esgotat", { inStock: false, quantity: 0 }],
    ["Out of stock", { inStock: false, quantity: 0 }],
    ["No disponible", { inStock: false, quantity: 0 }],
    ["Quedan 3 unidades", { inStock: true, quantity: 3 }],
    ["0 disponibles", { inStock: false, quantity: 0 }],
    ["Stock: 5", { inStock: true, quantity: 5 }],
    ["2", { inStock: true, quantity: 2 }],
    // la clase de un producto de WooCommerce: ni el id es una cantidad ni "instock" dice nada más
    ["post-119455 product type-product status-publish instock", { inStock: true }],
    ["post-119456 product type-product status-publish outofstock", { inStock: false, quantity: 0 }],
    ["En stock", { inStock: true }],
    ["Envío en 24h", { inStock: true }],
    ["", { inStock: true }],
  ])("%j", (text, expected) => {
    expect(parseStock(text)).toEqual(expected);
  });
});
