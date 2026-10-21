import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrapeStatus, StoreInfo } from "@/lib/data/types";
import { main } from "../cli";
import type { ScrapeOptions, StoreResult } from "../scrape";
import type { StoreConfig } from "../types";

/** La orquestación de la línea de órdenes, con tiendas, repositorio y rastreo falsos. */

const state = vi.hoisted(() => ({
  stores: [] as StoreConfig[],
  status: {} as Record<string, ScrapeStatus>,
  upserted: [] as string[][],
  upsertedInfo: [] as StoreInfo[],
  catalogLoads: 0,
  scraped: [] as Array<{ id: string; source?: string; csvFile?: string; dryRun?: boolean; limit?: number }>,
  signals: [] as Array<AbortSignal | undefined>,
}));

vi.mock("../stores.config", () => ({ STORES: state.stores }));
vi.mock("@/db/env", () => ({ loadLocalEnv: () => {} }));
vi.mock("@/lib/data", () => ({
  getRepository: async () => ({
    upsertStores: async (stores: StoreInfo[]) => {
      state.upserted.push(stores.map((s) => s.id));
      state.upsertedInfo = stores;
    },
    loadCatalog: async () => {
      state.catalogLoads++;
    },
  }),
}));
vi.mock("../scrape", () => ({
  scrapeStore: async (store: StoreConfig, options: ScrapeOptions): Promise<StoreResult> => {
    state.scraped.push({
      id: store.id,
      ...(options.source !== "web" ? { source: options.source } : {}),
      ...(options.csvFile ? { csvFile: options.csvFile } : {}),
      dryRun: options.dryRun,
      limit: options.limit,
    });
    state.signals.push(options.signal);
    return {
      storeId: store.id,
      source: options.source ?? "web",
      status: state.status[store.id] ?? "ok",
      stats: { found: 1, matched: 1, unmatched: 0 },
      pages: { ok: 1, failed: 0 },
      sample: [],
      durationMs: 10,
    };
  },
}));

const CSV_FIXTURE = fileURLToPath(new URL("./fixtures/cardmarket-stock-semicolon.csv", import.meta.url));

function config(id: string, enabled: boolean, extra: Partial<StoreConfig> = {}): StoreConfig {
  return {
    id,
    name: id,
    city: "Barcelona",
    province: "Barcelona",
    local: true,
    address: "Carrer Fals, 1, 08001 Barcelona",
    website: `https://${id}.example.com`,
    platform: "shopify",
    cardmarketUser: null,
    enabled,
    notes: "nota interna",
    ...extra,
  };
}

let output: string[];

beforeEach(() => {
  state.stores.splice(0, Infinity, config("tienda-a", true), config("tienda-b", false), config("tienda-c", true));
  state.status = {};
  state.upserted = [];
  state.upsertedInfo = [];
  state.catalogLoads = 0;
  state.scraped = [];
  state.signals = [];
  output = [];
  vi.stubEnv("SEARCH_MAGIC_CONTACT", "pruebas@search-magic.example");
  const capture = (...args: unknown[]) => void output.push(args.join(" "));
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("main", () => {
  it("rastrea las tiendas activadas después de sincronizarlas", async () => {
    expect(await main([])).toBe(0);
    expect(state.upserted).toEqual([["tienda-a", "tienda-c"]]);
    expect(state.catalogLoads).toBe(1);
    expect(state.scraped).toEqual([
      { id: "tienda-a", dryRun: false, limit: undefined },
      { id: "tienda-c", dryRun: false, limit: undefined },
    ]);
    expect(output.join("\n")).toContain("Resumen");
  });

  it("con --store sincroniza igualmente todas las activadas (si no, la BD desactivaría las demás)", async () => {
    expect(await main(["--store", "tienda-c", "--limit", "5"])).toBe(0);
    expect(state.upserted).toEqual([["tienda-a", "tienda-c"]]);
    expect(state.scraped).toEqual([{ id: "tienda-c", dryRun: false, limit: 5 }]);
  });

  it("en seco con --all no escribe en la BD y lee como mucho 50 listados por web", async () => {
    expect(await main(["--dry-run", "--all"])).toBe(0);
    expect(state.upserted).toEqual([]);
    expect(state.scraped).toEqual([
      { id: "tienda-a", dryRun: true, limit: 50 },
      { id: "tienda-c", dryRun: true, limit: 50 },
    ]);
    expect(await main(["--dry-run", "--all", "--limit", "500"])).toBe(0);
    expect(state.scraped.slice(2).map((s) => s.limit)).toEqual([500, 500]);
  });

  it("en seco sin --store ni --all no contacta con ninguna tienda: valida y enseña el plan", async () => {
    expect(await main(["--dry-run"])).toBe(0);
    expect(state.scraped).toEqual([]);
    expect(state.upserted).toEqual([]);
    expect(state.catalogLoads).toBe(0);
    expect(output.join("\n")).toContain("no se contacta con ninguna tienda");
    expect(output.join("\n")).toContain("tienda-a [web], tienda-c [web]");
  });

  it("sin SEARCH_MAGIC_CONTACT rastrea igual, con la página del repositorio como contacto", async () => {
    vi.stubEnv("SEARCH_MAGIC_CONTACT", "");
    expect(await main([])).toBe(0);
    expect(output.join("\n")).toContain("Sin SEARCH_MAGIC_CONTACT: el User-Agent lleva como contacto https://github.com/");
    expect(state.scraped.map((s) => s.id)).toEqual(["tienda-a", "tienda-c"]);

    state.stores.push(config("tienda-csv", true, { website: null, platform: null, cardmarketUser: "TiendaCsv" }));
    expect(await main(["--store", "tienda-csv", "--file", CSV_FIXTURE])).toBe(0);
    expect(state.scraped).toMatchObject([{ id: "tienda-a" }, { id: "tienda-c" }, { id: "tienda-csv", source: "cardmarket_csv" }]);
  });

  it("las tiendas lentas solo van con --slow (o con --store), pero siempre se sincronizan", async () => {
    state.stores.push(config("tienda-lenta", true, { slow: true }));
    expect(await main([])).toBe(0);
    expect(state.scraped.map((s) => s.id)).toEqual(["tienda-a", "tienda-c"]);
    expect(state.upserted).toEqual([["tienda-a", "tienda-c", "tienda-lenta"]]);

    state.scraped = [];
    expect(await main(["--slow"])).toBe(0);
    expect(state.scraped.map((s) => s.id)).toEqual(["tienda-lenta"]);

    state.scraped = [];
    expect(await main(["--store", "tienda-lenta"])).toBe(0);
    expect(state.scraped.map((s) => s.id)).toEqual(["tienda-lenta"]);
  });

  it("pasa una señal de parada a cada ejecución y valida --max-minutes", async () => {
    expect(await main(["--max-minutes", "50"])).toBe(0);
    expect(state.signals).toHaveLength(2);
    expect(state.signals.every((signal) => signal instanceof AbortSignal && !signal.aborted)).toBe(true);
    expect(await main(["--max-minutes", "0"])).toBe(1);
    expect(await main(["--max-minutes", "mucho"])).toBe(1);
  });

  it("una tienda desactivada solo se rastrea en seco", async () => {
    expect(await main(["--store", "tienda-b"])).toBe(0);
    expect(state.scraped).toEqual([]);
    expect(output.join("\n")).toContain("desactivada");

    expect(await main(["--store", "tienda-b", "--dry-run"])).toBe(0);
    expect(state.scraped).toEqual([{ id: "tienda-b", dryRun: true, limit: 50 }]);
    expect(state.upserted).toEqual([]);
  });

  it("sin tiendas activadas explica cómo añadir una y no toca la BD", async () => {
    state.stores.splice(0, Infinity, config("tienda-b", false));
    expect(await main([])).toBe(0);
    expect(output.join("\n")).toContain("No hay ninguna tienda activada");
    expect(state.upserted).toEqual([]);
    expect(state.catalogLoads).toBe(0);
  });

  it("sale con 1 solo si fallan todas las tiendas", async () => {
    state.status = { "tienda-a": "error", "tienda-c": "partial" };
    expect(await main([])).toBe(0);
    state.status = { "tienda-a": "error", "tienda-c": "error" };
    expect(await main([])).toBe(1);
  });

  it("rechaza argumentos y tiendas que no existen", async () => {
    expect(await main(["--store", "no-existe"])).toBe(1);
    expect(await main(["--limit", "0"])).toBe(1);
    expect(await main(["--otra-cosa"])).toBe(1);
    expect(state.scraped).toEqual([]);
  });

  it("no arranca con una configuración no válida", async () => {
    state.stores.push(config("tienda-a", true));
    await expect(main([])).rejects.toThrow('id repetido: "tienda-a"');
    expect(state.scraped).toEqual([]);
  });
  it("sincroniza solo los campos de StoreInfo", async () => {
    expect(await main([])).toBe(0);
    expect(state.upsertedInfo[0]).toEqual({
      id: "tienda-a",
      name: "tienda-a",
      city: "Barcelona",
      province: "Barcelona",
      local: true,
      address: "Carrer Fals, 1, 08001 Barcelona",
      website: "https://tienda-a.example.com",
      platform: "shopify",
      cardmarketUser: null,
    });
  });

  it("recorre cada tienda × fuente: web y, si hay CSV, cardmarket_csv", async () => {
    const csvOnly = config("tienda-d", true, {
      website: null,
      platform: null,
      cardmarketUser: "TiendaD",
      cardmarketCsv: { file: CSV_FIXTURE },
    });
    state.stores.push(csvOnly, config("tienda-e", true, { cardmarketUser: "TiendaE", cardmarketCsv: { file: CSV_FIXTURE } }));
    // tienda-f tiene usuario de Cardmarket, pero no hay CSV en data/cardmarket/tienda-f.csv
    state.stores.push(config("tienda-f", true, { cardmarketUser: "TiendaF" }));
    expect(await main([])).toBe(0);
    expect(state.scraped.map((s) => `${s.id}:${s.source ?? "web"}`)).toEqual([
      "tienda-a:web",
      "tienda-c:web",
      "tienda-d:cardmarket_csv",
      "tienda-e:web",
      "tienda-e:cardmarket_csv",
      "tienda-f:web",
    ]);
    expect(output.join("\n")).toMatch(/tienda-e\s+cardmarket_csv\s+ok/);
  });

  it("--source elige una fuente, pero se sincronizan igualmente todas las activadas", async () => {
    state.stores.push(config("tienda-e", true, { cardmarketUser: "TiendaE", cardmarketCsv: { file: CSV_FIXTURE } }));
    expect(await main(["--source", "cardmarket_csv"])).toBe(0);
    expect(state.upserted).toEqual([["tienda-a", "tienda-c", "tienda-e"]]);
    expect(state.scraped).toEqual([{ id: "tienda-e", source: "cardmarket_csv", dryRun: false, limit: undefined }]);
  });

  it("sin nada que hacer con --source, lo dice y no carga el catálogo", async () => {
    expect(await main(["--source", "cardmarket_csv"])).toBe(0);
    expect(output.join("\n")).toContain("Nada que hacer");
    expect(state.upserted).toEqual([["tienda-a", "tienda-c"]]);
    expect(state.catalogLoads).toBe(0);
    expect(state.scraped).toEqual([]);
  });

  it("--file importa un CSV para la tienda de --store", async () => {
    state.stores.push(config("tienda-csv", false, { website: null, platform: null, cardmarketUser: "TiendaCsv" }));
    expect(await main(["--store", "tienda-csv", "--file", CSV_FIXTURE, "--dry-run"])).toBe(0);
    expect(state.scraped).toEqual([{ id: "tienda-csv", source: "cardmarket_csv", csvFile: CSV_FIXTURE, dryRun: true, limit: undefined }]);
    expect(state.upserted).toEqual([]);
  });

  it("--file exige --store, un fichero que exista y una tienda con cardmarketUser", async () => {
    expect(await main(["--file", CSV_FIXTURE])).toBe(1);
    expect(await main(["--store", "tienda-a", "--file", "no-existe.csv"])).toBe(1);
    expect(await main(["--store", "tienda-a", "--file", CSV_FIXTURE, "--source", "web"])).toBe(1);
    expect(await main(["--store", "tienda-a", "--file", CSV_FIXTURE])).toBe(1);
    expect(output.join("\n")).toContain("no tiene cardmarketUser");
    expect(state.scraped).toEqual([]);
  });

  it("rechaza fuentes que no existen", async () => {
    expect(await main(["--source", "ftp"])).toBe(1);
    expect(state.scraped).toEqual([]);
  });
});
