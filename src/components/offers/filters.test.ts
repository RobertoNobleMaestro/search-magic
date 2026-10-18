import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  cityOptions,
  countActiveFilters,
  filtersHref,
  filtersToSearchParams,
  languageOptions,
  parseFilters,
  sealedFilterState,
  toOfferFilters,
  toSealedOfferFilters,
} from "./filters";

describe("parseFilters", () => {
  it("sin parámetros devuelve los valores por defecto (todas las tiendas, solo con stock)", () => {
    expect(parseFilters({})).toEqual(DEFAULT_FILTERS);
    expect(DEFAULT_FILTERS.localOnly).toBe(false);
  });

  it("lee todos los filtros", () => {
    expect(
      parseFilters({
        fisicas: "1",
        ciudad: ["L'Hospitalet de Llobregat", "Barcelona"],
        stock: "todo",
        acabado: "foil",
        idioma: ["es", "EN"],
        estado: "ex",
        edicion: "M11",
      }),
    ).toEqual({
      localOnly: true,
      cities: ["L'Hospitalet de Llobregat", "Barcelona"],
      inStockOnly: false,
      finish: "foil",
      languages: ["es", "en"],
      minCondition: "EX",
      setCode: "m11",
    });
  });

  it("las ciudades son texto libre: se limpian, sin vacías ni repetidas", () => {
    expect(parseFilters({ ciudad: [" Madrid ", "Madrid", "", "San  Sebastián"] }).cities).toEqual(["Madrid", "San Sebastián"]);
    expect(parseFilters({ ciudad: ["<script>", "x".repeat(61)] }).cities).toEqual([]);
  });

  it("entiende el campo oculto de la casilla 'solo en stock'", () => {
    // casilla marcada: llegan los dos valores
    expect(parseFilters({ stock: ["todo", "solo"] }).inStockOnly).toBe(true);
    // casilla desmarcada: solo el campo oculto
    expect(parseFilters({ stock: "todo" }).inStockOnly).toBe(false);
    expect(parseFilters({ stock: "otra-cosa" }).inStockOnly).toBe(true);
  });

  it("ignora valores no válidos y vacíos", () => {
    expect(
      parseFilters({
        fisicas: "si",
        acabado: "",
        idioma: ["", "español", "es", "es"],
        estado: "XX",
        edicion: "<script>",
      }),
    ).toEqual({ ...DEFAULT_FILTERS, languages: ["es"] });
  });
});

describe("filtersToSearchParams", () => {
  it("omite los valores por defecto", () => {
    expect(filtersToSearchParams(DEFAULT_FILTERS).toString()).toBe("");
    expect(filtersHref("/carta/x", DEFAULT_FILTERS)).toBe("/carta/x");
  });

  it("es la inversa de parseFilters", () => {
    const state = parseFilters({
      fisicas: "1",
      ciudad: "L'Hospitalet de Llobregat",
      stock: "todo",
      idioma: ["es", "ja"],
      estado: "NM",
      edicion: "sld",
    });
    const query = filtersToSearchParams(state).toString();
    expect(query).toBe("fisicas=1&ciudad=L%27Hospitalet+de+Llobregat&stock=todo&idioma=es&idioma=ja&estado=NM&edicion=sld");
    const params = new URLSearchParams(query);
    const back = parseFilters({
      fisicas: params.getAll("fisicas"),
      ciudad: params.getAll("ciudad"),
      stock: params.getAll("stock"),
      idioma: params.getAll("idioma"),
      estado: params.get("estado") ?? undefined,
      edicion: params.get("edicion") ?? undefined,
    });
    expect(back).toEqual(state);
  });
});

describe("countActiveFilters", () => {
  it("cuenta los filtros que no están en su valor por defecto", () => {
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
    expect(countActiveFilters({ ...DEFAULT_FILTERS, inStockOnly: false, languages: ["es", "en"] })).toBe(2);
    expect(countActiveFilters({ ...DEFAULT_FILTERS, localOnly: true, cities: ["Barcelona"] })).toBe(2);
  });
});

describe("toOfferFilters", () => {
  it("convierte las listas vacías y el 'no' en 'sin filtro'", () => {
    expect(toOfferFilters(DEFAULT_FILTERS)).toEqual({
      localOnly: undefined,
      cities: undefined,
      inStockOnly: true,
      finish: undefined,
      languages: undefined,
      minCondition: undefined,
      setCode: undefined,
    });
    expect(toOfferFilters({ ...DEFAULT_FILTERS, localOnly: true, cities: ["Madrid"], finish: "foil" })).toMatchObject({
      localOnly: true,
      cities: ["Madrid"],
      finish: "foil",
    });
  });
});

describe("sellado", () => {
  it("se queda solo con tienda, ciudad, stock e idioma", () => {
    const state = parseFilters({ fisicas: "1", ciudad: "Barcelona", acabado: "foil", estado: "NM", edicion: "blb", idioma: "es" });
    expect(sealedFilterState(state)).toEqual({ ...state, finish: null, minCondition: null, setCode: null });
    expect(toSealedOfferFilters(state)).toEqual({ localOnly: true, cities: ["Barcelona"], inStockOnly: true, languages: ["es"] });
  });
});

describe("cityOptions", () => {
  it("primero las ciudades con tiendas físicas, después el resto; sin repetir", () => {
    expect(
      cityOptions([
        { city: "Madrid", local: false },
        { city: "L'Hospitalet de Llobregat", local: true },
        { city: "Barcelona", local: true },
        { city: "Barcelona", local: false },
        { city: "", local: false },
      ]),
    ).toEqual([
      { city: "Barcelona", local: true },
      { city: "L'Hospitalet de Llobregat", local: true },
      { city: "Madrid", local: false },
    ]);
  });

  it("incluye las elegidas aunque no tengan ofertas", () => {
    expect(cityOptions([], ["Sevilla"])).toEqual([{ city: "Sevilla", local: false }]);
  });
});

describe("languageOptions", () => {
  it("español e inglés primero y después el resto por nombre", () => {
    const labels: Record<string, string> = { es: "Español", en: "Inglés", ja: "Japonés", de: "Alemán" };
    expect(languageOptions(["ja", null, "de", "es"], [], (l) => labels[l] ?? l)).toEqual(["es", "en", "de", "ja"]);
  });
});
