import { describe, expect, it } from "vitest";
import { compareStores, storeHealth, storeOfferings } from "./stores";

const now = new Date("2026-10-18T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

describe("storeOfferings", () => {
  it("tienda física con web y Cardmarket: sellado en su web y sueltas vía Cardmarket", () => {
    expect(storeOfferings({ local: true, website: "https://a.example", platform: "shopify", cardmarketUser: "A" })).toEqual([
      "singles_cardmarket",
      "sealed_web",
    ]);
  });

  it("tienda física sin web: solo sueltas vía Cardmarket", () => {
    expect(storeOfferings({ local: true, website: null, platform: null, cardmarketUser: "B" })).toEqual(["singles_cardmarket"]);
  });

  it("tienda online: sueltas y sellado en su web", () => {
    expect(storeOfferings({ local: false, website: "https://c.example", platform: "woocommerce", cardmarketUser: null })).toEqual([
      "singles_web",
      "sealed_web",
    ]);
  });

  it("las ejecuciones también cuentan, aunque falte la configuración", () => {
    expect(
      storeOfferings({ local: true, website: null, platform: null, cardmarketUser: null }, [{ source: "cardmarket_csv" }]),
    ).toEqual(["singles_cardmarket"]);
    expect(storeOfferings({ local: true, website: null, platform: null, cardmarketUser: null })).toEqual([]);
  });
});

describe("storeHealth", () => {
  it("al día, parcial, error, datos viejos y sin datos", () => {
    expect(storeHealth({ lastStatus: "ok", lastScrapedAt: hoursAgo(2) }, now)).toMatchObject({ tone: "good", label: "Al día · hace 2 h" });
    expect(storeHealth({ lastStatus: "partial", lastScrapedAt: hoursAgo(15) }, now)).toMatchObject({ tone: "warn" });
    expect(storeHealth({ lastStatus: "error", lastScrapedAt: hoursAgo(31) }, now)).toMatchObject({
      tone: "bad",
      label: "Datos de hace 1 día",
    });
    expect(storeHealth({ lastStatus: "ok", lastScrapedAt: hoursAgo(26) }, now)).toMatchObject({ tone: "warn" });
    expect(storeHealth({ lastStatus: null, lastScrapedAt: null }, now)).toMatchObject({ tone: "warn", label: "Sin datos todavía" });
  });

  it("si falla una fuente pero la otra está al día, aviso con el estado de cada una (no error)", () => {
    const runs = [
      { source: "web" as const, status: "error" as const, finishedAt: hoursAgo(1) },
      { source: "cardmarket_csv" as const, status: "ok" as const, finishedAt: hoursAgo(4) },
    ];
    expect(storeHealth({ lastStatus: "error", lastScrapedAt: hoursAgo(4) }, now, runs)).toEqual({
      tone: "warn",
      label: "Datos de hace 4 h",
      note: "Web: falló la última revisión · Cardmarket: al día",
    });
    // si fallan todas, sigue siendo un error
    const allFailed = runs.map((r) => ({ ...r, status: "error" as const }));
    expect(storeHealth({ lastStatus: "error", lastScrapedAt: hoursAgo(30) }, now, allFailed)).toMatchObject({ tone: "bad" });
    // con una sola fuente, como siempre
    expect(storeHealth({ lastStatus: "error", lastScrapedAt: hoursAgo(4) }, now, runs.slice(0, 1))).toMatchObject({ tone: "bad" });
  });
});

describe("compareStores", () => {
  it("físicas primero, luego por ciudad y nombre", () => {
    const stores = [
      { local: false, city: "Madrid", name: "Z" },
      { local: true, city: "L'Hospitalet de Llobregat", name: "B" },
      { local: true, city: "Barcelona", name: "C" },
      { local: true, city: "Barcelona", name: "A" },
    ];
    expect([...stores].sort(compareStores).map((s) => s.name)).toEqual(["A", "C", "B", "Z"]);
  });
});
