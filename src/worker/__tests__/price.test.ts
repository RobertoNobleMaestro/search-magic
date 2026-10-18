import { describe, expect, it } from "vitest";
import { decimalToCents, isPlausiblePrice, minorUnitsToCents, parsePrice } from "../price";

describe("parsePrice", () => {
  it.each([
    ["1,50 €", 150],
    ["€1.50", 150],
    ["1.234,56 €", 123456],
    ["12 €", 1200],
    ["0,95€", 95],
    ["1,5 €", 150],
    ["1.50", 150],
    ["15", 1500],
    ["1,234.56", 123456],
    ["1.234 €", 123400],
    ["1.234.567,89 €", 123456789],
    ["0,950 €", 95],
    ["1 234,56 €", 123456],
    ["  3,00 € ", 300],
    ["Desde 2,50 €", 250],
    ["EUR 7.5", 750],
    ["Precio: 10,00 € IVA incl.", 1000],
    ["1,50 € 2,00 €", 150],
  ])("%s → %i céntimos", (text, cents) => {
    expect(parsePrice(text)).toBe(cents);
  });

  it.each(["", "Agotado", "Consultar precio", "€"])("sin importe: %j → null", (text) => {
    expect(parsePrice(text)).toBeNull();
  });
});

describe("decimalToCents", () => {
  it("convierte los precios de Shopify", () => {
    expect(decimalToCents("1.50")).toBe(150);
    expect(decimalToCents("0.95")).toBe(95);
    expect(decimalToCents("1234.56")).toBe(123456);
    expect(decimalToCents("12")).toBe(1200);
    expect(decimalToCents(1.1)).toBe(110);
  });

  it("rechaza lo que no es un decimal con punto", () => {
    expect(decimalToCents("1,50")).toBeNull();
    expect(decimalToCents("")).toBeNull();
    expect(decimalToCents("abc")).toBeNull();
  });
});

describe("isPlausiblePrice", () => {
  it("acepta precios normales, también los caros", () => {
    expect(isPlausiblePrice(10)).toBe(true);
    expect(isPlausiblePrice(18500)).toBe(true);
    expect(isPlausiblePrice(4_500_000)).toBe(true);
  });

  it("descarta 0 € y los precios de relleno", () => {
    expect(isPlausiblePrice(0)).toBe(false);
    expect(isPlausiblePrice(-150)).toBe(false);
    expect(isPlausiblePrice(99_999_900)).toBe(false); // 999.999 € en una carta agotada de Universe TCG
    expect(isPlausiblePrice(Number.NaN)).toBe(false);
  });
});

describe("minorUnitsToCents", () => {
  it("tiene en cuenta los decimales de la moneda", () => {
    expect(minorUnitsToCents("150", 2)).toBe(150);
    expect(minorUnitsToCents(4200, 2)).toBe(4200);
    expect(minorUnitsToCents("2", 0)).toBe(200);
    expect(minorUnitsToCents("1500", 3)).toBe(150);
  });

  it("rechaza importes vacíos o con formato", () => {
    expect(minorUnitsToCents("", 2)).toBeNull();
    expect(minorUnitsToCents("1,50", 2)).toBeNull();
    expect(minorUnitsToCents("150", -1)).toBeNull();
  });
});
