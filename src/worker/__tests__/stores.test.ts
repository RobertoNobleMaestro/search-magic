import { readFileSync } from "node:fs";
import { load } from "cheerio";
import { RobotsTxtFile } from "crawlee";
import { describe, expect, it } from "vitest";
import { adapterFor } from "../adapters";
import { nextPageUrls } from "../adapters/html";
import { LOCAL_CITIES, parseStoreConfigs } from "../config";
import { isCardmarketUrl } from "../fetch";
import { crawlDelaySecs, ROBOTS_AGENT } from "../robots";
import { STORES } from "../stores.config";
import type { WebStoreConfig } from "../types";

/** Tiendas reales de stores.config.ts, contra los robots.txt y las páginas guardados el 18/10/2026 */

const stores = parseStoreConfigs(STORES);
const byId = new Map(stores.map((s) => [s.id, s]));
const fixture = (name: string) => readFileSync(new URL(`./fixtures/stores/${name}`, import.meta.url), "utf8");
const robotsOf = (store: WebStoreConfig) => {
  const content = fixture(`robots/${store.id}.txt`);
  return { file: RobotsTxtFile.from(new URL("/robots.txt", store.website).href, content), delay: crawlDelaySecs(content) };
};
const webStore = (id: string) => byId.get(id) as WebStoreConfig;

describe("stores.config.ts", () => {
  it("activa solo las tiendas con un adaptador comprobado y robots.txt a favor", () => {
    expect(stores.filter((s) => s.enabled).map((s) => s.id)).toEqual([
      "magic-barcelona",
      "industria-61",
      "el-nucli",
      "el-duelista",
      "universe-tcg",
      "mtg-canarias",
      "el-rincon-de-magic",
    ]);
    for (const store of stores.filter((s) => !s.enabled)) expect(store.notes, store.id).toBeTruthy();
  });

  it("tiendas físicas de la zona: las de docs/tiendas.md, con su usuario de Cardmarket si lo tienen", () => {
    const local = stores.filter((s) => s.local);
    expect(local.map((s) => s.id).sort()).toEqual(
      ["arco-tcg", "dungeon-marvels", "el-nucli", "el-tesoro-del-dragon-blanco", "gameria", "industria-61", "ingenio", "kaburi", "magic-barcelona"].sort(),
    );
    for (const store of local) {
      expect(LOCAL_CITIES).toContain(store.city);
      expect(store.province).toBe("Barcelona");
    }
    expect(Object.fromEntries(stores.filter((s) => s.cardmarketUser).map((s) => [s.id, s.cardmarketUser]))).toEqual({
      "magic-barcelona": "MagicBarcelona",
      ingenio: "inGenio",
      "industria-61": "Magic-Industria-61",
      gameria: "GAMERIA",
    });
    // su CSV de Cardmarket, cuando lo manden, va a data/cardmarket/<id>.csv
    for (const store of stores.filter((s) => s.cardmarketUser)) {
      expect(store.cardmarketCsv).toEqual({ file: `data/cardmarket/${store.id}.csv` });
    }
    expect(byId.has("nuncaesdemasiado-tcg")).toBe(false);
  });

  it("tiendas online: las de docs/tiendas-online.json; las pendientes de permiso, desactivadas y sin rastreo", () => {
    expect(stores.filter((s) => !s.local).map((s) => s.id).sort()).toEqual(
      ["disfrutalo-tcg", "el-duelista", "el-rincon-de-magic", "itaca", "mtg-canarias", "rebellion", "universe-tcg"].sort(),
    );
    for (const id of ["itaca", "disfrutalo-tcg"]) {
      const store = byId.get(id)!;
      expect(store.enabled).toBe(false);
      expect(store.platform).toBeNull();
      expect(store.notes).toMatch(/^Pendiente de permiso del propietario/);
    }
  });

  it("sin web rastreable: Kaburi (robots.txt Disallow: /), Arco TCG (solo Pokémon), Gameria y El Tesoro (sin web)", () => {
    for (const id of ["kaburi", "arco-tcg", "gameria", "el-tesoro-del-dragon-blanco"]) expect(byId.get(id)!.platform, id).toBeNull();
    expect(byId.get("gameria")!.website).toBeNull();
    expect(byId.get("el-tesoro-del-dragon-blanco")!.website).toBeNull();
  });

  it("nada apunta a cardmarket.com", () => {
    for (const store of stores) {
      const urls = [store.website, store.cardmarketCsv?.url, ...(store.html?.startUrls ?? [])].filter((u): u is string => Boolean(u));
      for (const url of urls) expect(isCardmarketUrl(url), url).toBe(false);
    }
  });
});

describe("robots.txt reales", () => {
  const withWeb = stores.filter((s) => s.website && s.platform) as WebStoreConfig[];

  it("permiten las URLs de inicio de todas las tiendas con platform", () => {
    expect(withWeb.length).toBeGreaterThan(0);
    for (const store of withWeb) {
      const { file } = robotsOf(store);
      for (const url of adapterFor(store.platform).startUrls(store)) expect(file.isAllowed(url, ROBOTS_AGENT), url).toBe(true);
    }
  });

  it("permiten los enlaces que se siguen en las webs HTML", () => {
    const cases: Array<[string, string, string]> = [
      ["el-rincon-de-magic", "html-elrincondemagic-cartas-sueltas.html", "https://www.elrincondemagic.com/Cartas-Sueltas"],
      ["el-rincon-de-magic", "html-elrincondemagic-lorwyn-eclipsado.html", "https://www.elrincondemagic.com/epages/64576138.sf/es_ES/?ObjectPath=/Shops/64576138/Categories/Cartas_Sueltas/Lorwyn_Eclipsado"],
      ["ingenio", "html-ingenio-magic.html", "https://www.ingeniobcn.com/magic-the-gathering/"],
      ["magic-barcelona", "html-magicbarcelona-sellado.html", "https://www.magicbarcelona.net/tienda/?swoof=1&product_cat=producto-sellado"],
    ];
    for (const [id, page, pageUrl] of cases) {
      const store = webStore(id);
      const links = nextPageUrls(load(fixture(page)), pageUrl, store.html!.nextPage!);
      expect(links.length, page).toBeGreaterThan(0);
      for (const url of links) expect(robotsOf(store).file.isAllowed(url, ROBOTS_AGENT), url).toBe(true);
    }
  });

  it("inGenio (desactivada) no quiere URLs con parámetros: ni la de inicio ni la paginación los llevan", () => {
    const store = webStore("ingenio");
    const links = nextPageUrls(load(fixture("html-ingenio-magic.html")), store.html!.startUrls[0]!, store.html!.nextPage!);
    expect([...store.html!.startUrls, ...links]).toEqual([
      "https://www.ingeniobcn.com/magic-the-gathering/",
      "https://www.ingeniobcn.com/magic-the-gathering/page/2/",
    ]);
  });

  it("El Rincón de Magic pide Crawl-delay 10 solo a 'pricebot': lo aplicamos con crawlDelaySeconds", () => {
    const store = webStore("el-rincon-de-magic");
    expect(robotsOf(store).delay).toBeUndefined();
    expect(store.crawlDelaySeconds).toBe(10);
    // las búsquedas y facetas, no
    expect(robotsOf(store).file.isAllowed("https://www.elrincondemagic.com/epages/64576138.sf/es_ES/?ViewAction=FacetedSearchProducts", ROBOTS_AGENT)).toBe(false);
  });

  it("Rebellion no tiene grupo para '*' ni nos bloquea", () => {
    const store = webStore("rebellion");
    expect(robotsOf(store).file.isAllowed("https://www.rebellion.es/tiendarebel/verampliacion.php?idAmpl=543", ROBOTS_AGENT)).toBe(true);
  });
});
