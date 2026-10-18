import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { log as crawleeLog, LogLevel } from "crawlee";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type {
  ListingSource,
  MatchedListing,
  MatchResult,
  NormalizedListing,
  Repository,
  ScrapeRun,
  ScrapeRunStats,
  ScrapeStatus,
} from "@/lib/data/types";
import { scrapeStore, type ScrapeOptions } from "../scrape";
import type { StoreConfig } from "../types";
import shopifyFixture from "./fixtures/shopify-products.json";
import wooProducts from "./fixtures/woocommerce-products.json";
import wooVariations from "./fixtures/woocommerce-variations.json";

/**
 * De principio a fin contra un servidor HTTP local (sin salir a internet): robots.txt, paginación,
 * reintentos, cabeceras y estados de la ejecución, con un repositorio y un emparejador falsos.
 */

type Route = object | string | ((req: IncomingMessage, res: ServerResponse) => void);

interface TestServer {
  url: string;
  requests: Array<{ url: string; headers: IncomingHttpHeaders; at: number }>;
  close(): Promise<void>;
}

const servers: TestServer[] = [];

async function serve(routes: Record<string, Route>): Promise<TestServer> {
  const requests: TestServer["requests"] = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url ?? "", headers: req.headers, at: Date.now() });
    const route = routes[req.url ?? ""];
    if (typeof route === "function") return route(req, res);
    if (route === undefined) {
      res.writeHead(404, { "content-type": "text/html" }).end("<h1>404</h1>");
    } else if (typeof route === "string") {
      const type = req.url === "/robots.txt" ? "text/plain" : "text/html; charset=utf-8";
      res.writeHead(200, { "content-type": type }).end(route);
    } else {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(route));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const handle = {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  servers.push(handle);
  return handle;
}

function fakeRepo(latestRuns: ScrapeRun[] = []) {
  const calls = {
    started: [] as string[],
    sources: [] as Array<ListingSource | undefined>,
    saved: [] as MatchedListing[][],
    finished: [] as Array<{ runId: string; status: ScrapeStatus; stats: ScrapeRunStats; error?: string }>,
  };
  const repo = {
    async startRun(storeId: string, source?: ListingSource) {
      calls.started.push(storeId);
      calls.sources.push(source);
      return `run-${calls.started.length}`;
    },
    async saveListings(_runId: string, items: MatchedListing[]) {
      calls.saved.push(items);
    },
    async finishRun(runId: string, result: { status: ScrapeStatus; stats: ScrapeRunStats; error?: string }) {
      calls.finished.push({ runId, ...result });
    },
    async listLatestRuns() {
      return latestRuns;
    },
  };
  return { repo: repo as unknown as Repository, calls };
}

const BOLT: MatchResult = { oracleId: "bolt", scryfallId: null, confidence: 1, method: "exact_en" };
const match = async (listing: NormalizedListing) => (listing.rawTitle.startsWith("Lightning Bolt") ? BOLT : null);
const enrich = (listing: NormalizedListing) => listing;
const FAST = { delaySecs: 0.01, backoffMs: 5, timeoutSecs: 5 };

function store(website: string, extra: Partial<StoreConfig> = {}): StoreConfig {
  return {
    id: "tienda-prueba",
    name: "Tienda de prueba",
    city: "Barcelona",
    province: "Barcelona",
    local: true,
    address: "Carrer Fals, 1, 08001 Barcelona",
    website,
    platform: "shopify",
    cardmarketUser: null,
    enabled: true,
    ...extra,
  };
}

function run(config: StoreConfig, repo: Repository, extra: Partial<ScrapeOptions> = {}) {
  return scrapeStore(config, { repo, match, enrich, settings: FAST, log: () => {}, ...extra });
}

const playwrightInstalled = (() => {
  try {
    createRequire(import.meta.url).resolve("playwright");
    return true;
  } catch {
    return false;
  }
})();

const page = (n: number) => `/products.json?limit=250&page=${n}`;
const [p1, p2, p3, p4, p5] = shopifyFixture.products;

const previousContact = process.env.SEARCH_MAGIC_CONTACT;
beforeAll(() => {
  process.env.SEARCH_MAGIC_CONTACT = "pruebas@search-magic.example";
  crawleeLog.setLevel(LogLevel.OFF);
});
afterAll(async () => {
  process.env.SEARCH_MAGIC_CONTACT = previousContact;
  await Promise.all(servers.map((s) => s.close()));
});

describe("scrapeStore", { timeout: 30_000 }, () => {
  it("Shopify: pagina hasta la página vacía, empareja, guarda y cierra como ok", async () => {
    const server = await serve({
      "/robots.txt": "User-agent: *\nDisallow: /checkout\n",
      [page(1)]: { products: [p1, p2] },
      [page(2)]: { products: [p3, p4, p5] },
      [page(3)]: { products: [] },
    });
    const { repo, calls } = fakeRepo();
    const result = await run(store(server.url), repo);

    expect(result).toMatchObject({ status: "ok", stats: { found: 10, matched: 3, unmatched: 7 }, pages: { ok: 3, failed: 0 } });
    expect(result.message).toBeUndefined();
    expect(server.requests.map((r) => r.url)).toEqual(["/robots.txt", page(1), page(2), page(3)]);
    expect(calls.started).toEqual(["tienda-prueba"]);
    expect(calls.sources).toEqual(["web"]);
    expect(calls.saved.map((batch) => batch.length)).toEqual([6, 4]);
    expect(calls.saved[0]!.filter((l) => l.match).map((l) => l.externalId)).toEqual(["44123456789001", "44123456789002", "44123456789003"]);
    expect(calls.finished).toEqual([{ runId: "run-1", status: "ok", stats: { found: 10, matched: 3, unmatched: 7 } }]);
  });

  it("se identifica con su User-Agent y sin cabeceras de navegador inventadas", async () => {
    const server = await serve({ "/robots.txt": "", [page(1)]: { products: [p4] }, [page(2)]: { products: [] } });
    await run(store(server.url), fakeRepo().repo);
    expect(server.requests).toHaveLength(3);
    for (const { headers } of server.requests) {
      expect(headers["user-agent"]).toBe("search-magic/0.1 (+pruebas@search-magic.example)");
    }
    // robots.txt va con fetch (que siempre manda sec-fetch-mode); las páginas, sin el generador de
    // cabeceras de got-scraping, que añadiría sec-ch-ua, sec-fetch-site… de un Chrome inventado
    for (const { headers } of server.requests.slice(1)) {
      expect(Object.keys(headers).filter((h) => h.startsWith("sec-"))).toEqual([]);
      expect(headers.accept).toBe("application/json");
    }
  });

  it("si robots.txt no lo permite, salta la tienda sin pedir nada más", async () => {
    const server = await serve({ "/robots.txt": "User-agent: search-magic\nDisallow: /products.json\n", [page(1)]: { products: [p1] } });
    const { repo, calls } = fakeRepo();
    const result = await run(store(server.url), repo);

    expect(result.status).toBe("skipped");
    expect(result.message).toContain("robots.txt no permite rastrear");
    expect(server.requests.map((r) => r.url)).toEqual(["/robots.txt"]);
    expect(calls.finished).toMatchObject([{ status: "skipped" }]);
  });

  it("si robots.txt falla (5xx), no rastrea", async () => {
    const server = await serve({ "/robots.txt": (_req, res) => res.writeHead(503).end() });
    const result = await run(store(server.url), fakeRepo().repo);
    expect(result.status).toBe("error");
    expect(result.message).toContain("503");
    expect(server.requests).toHaveLength(1);
  });

  it("los 404 no se reintentan y sin ningún listado la tienda queda en error", async () => {
    const server = await serve({ "/robots.txt": "" });
    const { repo, calls } = fakeRepo();
    const result = await run(store(server.url), repo);

    expect(result).toMatchObject({ status: "error", pages: { ok: 0, failed: 1 } });
    expect(result.message).toContain("HTTP 404");
    expect(server.requests.map((r) => r.url)).toEqual(["/robots.txt", page(1)]);
    expect(calls.finished).toMatchObject([{ status: "error", stats: { found: 0, matched: 0, unmatched: 0 } }]);
  });

  it("si una página falla tras los reintentos, guarda lo leído y cierra como partial", async () => {
    const server = await serve({
      "/robots.txt": "",
      [page(1)]: { products: [p1] },
      [page(2)]: (_req, res) => res.writeHead(500, { "content-type": "text/plain" }).end("Internal error"),
    });
    const { repo, calls } = fakeRepo();
    const result = await run(store(server.url), repo);

    expect(result).toMatchObject({ status: "partial", stats: { found: 3 }, pages: { ok: 1, failed: 1 } });
    expect(result.message).toContain("1 página(s) sin leer");
    // la primera vez y 3 reintentos
    expect(server.requests.filter((r) => r.url === page(2))).toHaveLength(4);
    expect(calls.saved.flat()).toHaveLength(3);
    expect(calls.finished).toMatchObject([{ status: "partial" }]);
  });

  it("las páginas que robots.txt no permite cuentan como no leídas", async () => {
    const server = await serve({
      "/robots.txt": "User-agent: *\nDisallow: /products.json?limit=250&page=2\n",
      [page(1)]: { products: [p1] },
      [page(2)]: { products: [p2] },
    });
    const result = await run(store(server.url), fakeRepo().repo);

    expect(result.status).toBe("partial");
    expect(result.message).toContain("robots.txt no lo permite");
    expect(server.requests.map((r) => r.url)).toEqual(["/robots.txt", page(1)]);
  });

  it("en seco no escribe nada en la BD, pero devuelve una muestra", async () => {
    const server = await serve({ "/robots.txt": "", [page(1)]: { products: [p1, p2] }, [page(2)]: { products: [] } });
    const { repo, calls } = fakeRepo();
    const result = await run(store(server.url), repo, { dryRun: true });

    expect(result).toMatchObject({ status: "ok", stats: { found: 6, matched: 3 } });
    expect(result.sample).toHaveLength(6);
    expect(result.sample[0]).toMatchObject({ externalId: "44123456789001", match: BOLT });
    expect(calls).toEqual({ started: [], sources: [], saved: [], finished: [] });
  });

  it("con --limit se para y no cierra como ok (no se marcaría nada sin stock por error)", async () => {
    const server = await serve({ "/robots.txt": "", [page(1)]: { products: [p1, p2] }, [page(2)]: { products: [p3] } });
    const { repo, calls } = fakeRepo();
    const result = await run(store(server.url), repo, { limit: 2 });

    expect(result).toMatchObject({ status: "partial", stats: { found: 2 } });
    expect(result.message).toContain("--limit 2");
    expect(calls.saved.flat()).toHaveLength(2);
  });

  it("si se interrumpe (Ctrl+C, cancelar en CI), no cierra como ok aunque Crawlee termine sin errores", async () => {
    const server = await serve({
      "/robots.txt": "",
      [page(1)]: (_req, res) => {
        // Crawlee atiende el SIGINT parando la cola cuando acaba la petición en curso
        process.emit("SIGINT");
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ products: [p1] }));
      },
      [page(2)]: { products: [p2] },
    });
    const { repo, calls } = fakeRepo();
    const result = await run(store(server.url), repo);

    expect(result).toMatchObject({ status: "partial", stats: { found: 3 }, pages: { ok: 1, failed: 1 } });
    expect(result.message).toContain(`${page(2)}: el rastreo se interrumpió`);
    expect(calls.finished).toMatchObject([{ status: "partial" }]);
  });

  it("si Retry-After pide más de un minuto, no insiste: la página queda sin leer", async () => {
    const server = await serve({
      "/robots.txt": "",
      [page(1)]: { products: [p1] },
      [page(2)]: (_req, res) => res.writeHead(429, { "retry-after": "3600" }).end(),
    });
    const { repo, calls } = fakeRepo();
    const result = await run(store(server.url), repo);

    expect(result).toMatchObject({ status: "partial", stats: { found: 3 }, pages: { ok: 1, failed: 1 } });
    expect(server.requests.filter((r) => r.url === page(2))).toHaveLength(1);
    expect(calls.finished).toMatchObject([{ status: "partial" }]);
  });

  it("al abortarse deja de leer y cierra como partial sin esperar a la página en curso", async () => {
    const controller = new AbortController();
    const server = await serve({
      "/robots.txt": "",
      [page(1)]: { products: [p1] },
      // la segunda página no responde nunca: abortar no puede esperar a que acabe
      [page(2)]: () => controller.abort("--max-minutes 1 agotado"),
    });
    const { repo, calls } = fakeRepo();
    const result = await run(store(server.url), repo, { signal: controller.signal });

    expect(result).toMatchObject({ status: "partial", stats: { found: 3 } });
    expect(result.message).toContain("--max-minutes 1 agotado: no se ha leído todo");
    expect(calls.saved.flat()).toHaveLength(3);
    expect(calls.finished).toMatchObject([{ status: "partial", stats: { found: 3 } }]);
  });

  it("webKind marca el tipo de todo lo que se rastrea de la web", async () => {
    const server = await serve({ "/robots.txt": "", [page(1)]: { products: [p1] }, [page(2)]: { products: [] } });
    const { repo, calls } = fakeRepo();
    await run(store(server.url, { webKind: "single" }), repo);
    expect(calls.saved.flat().map((l) => l.kind)).toEqual(["single", "single", "single"]);
  });

  it("un fallo del emparejador deja el listado sin emparejar, pero no tumba la tienda", async () => {
    const server = await serve({ "/robots.txt": "", [page(1)]: { products: [p4] }, [page(2)]: { products: [] } });
    const { repo, calls } = fakeRepo();
    const broken = async (): Promise<MatchResult | null> => {
      throw new Error("matchListing: pendiente de implementar");
    };
    const result = await run(store(server.url), repo, { match: broken });

    expect(result).toMatchObject({ status: "ok", stats: { found: 1, matched: 0, unmatched: 1 } });
    expect(result.message).toContain("pendiente de implementar");
    expect(calls.saved.flat()).toMatchObject([{ externalId: "44123456789031", match: null }]);
  });

  it("WooCommerce: productos simples y, en una segunda pasada, las variaciones", async () => {
    const api = "/wp-json/wc/store/v1/products";
    const json = (body: unknown) => (_req: IncomingMessage, res: ServerResponse) =>
      res.writeHead(200, { "content-type": "application/json", "x-wp-totalpages": "1" }).end(JSON.stringify(body));
    const server = await serve({
      "/robots.txt": "User-agent: *\nDisallow: /wp-admin/\n",
      [`${api}?per_page=100&page=1`]: json(wooProducts),
      [`${api}?type=variation&per_page=100&page=1`]: json(wooVariations),
    });
    const { repo, calls } = fakeRepo();
    const result = await run(store(server.url, { platform: "woocommerce" }), repo);

    expect(result).toMatchObject({ status: "ok", stats: { found: 4 }, pages: { ok: 2, failed: 0 } });
    expect(calls.saved.flat().map((l) => l.externalId)).toEqual(["101", "102", "501", "502"]);
  });

  it("HTML: lee las páginas con los selectores y sigue el enlace a la siguiente", async () => {
    const item = (name: string, price: string) =>
      `<article class="product-miniature"><a class="product-thumbnail" href="/p/${encodeURIComponent(name)}"><img alt="${name}"></a>` +
      `<h2 class="product-title"><a href="/p/${encodeURIComponent(name)}">${name}</a></h2>` +
      `<div class="product-price-and-shipping"><span class="price">${price}</span></div></article>`;
    const server = await serve({
      "/robots.txt": "",
      "/12-cartas-sueltas": `<html><body>${item("Lightning Bolt (M11)", "1,50 €")}${item("Counterspell", "0,95 €")}` +
        `<nav class="pagination"><a rel="next" href="/12-cartas-sueltas?page=2">Siguiente</a></nav></body></html>`,
      "/12-cartas-sueltas?page=2": `<html><body>${item("Birds of Paradise", "6,00 €")}</body></html>`,
    });
    const { repo, calls } = fakeRepo();
    const config = store(server.url, {
      platform: "prestashop",
      html: {
        startUrls: [`${server.url}/12-cartas-sueltas`],
        selectors: { item: "article.product-miniature", title: ".product-thumbnail img@alt", price: ".price", url: ".product-title a" },
        nextPage: ".pagination a[rel=next]",
      },
    });
    const result = await run(config, repo);

    expect(result).toMatchObject({ status: "ok", stats: { found: 3, matched: 1 }, pages: { ok: 2, failed: 0 } });
    expect(calls.saved.flat().map((l) => [l.rawTitle, l.priceCents])).toEqual([
      ["Lightning Bolt (M11)", 150],
      ["Counterspell", 95],
      ["Birds of Paradise", 600],
    ]);
    expect(server.requests.map((r) => r.url)).toEqual(["/robots.txt", "/12-cartas-sueltas", "/12-cartas-sueltas?page=2"]);
    expect(server.requests[1]!.headers["user-agent"]).toMatch(/^search-magic\/0\.1 /);
  });

  it.skipIf(playwrightInstalled)("renderJs sin Playwright instalado falla con un mensaje claro", async () => {
    const server = await serve({ "/robots.txt": "" });
    const config = store(server.url, {
      platform: "html",
      html: { startUrls: [`${server.url}/magic`], selectors: { item: ".p", title: ".t", price: ".x" }, renderJs: true },
    });
    const result = await run(config, fakeRepo().repo);
    expect(result.status).toBe("error");
    expect(result.message).toContain("Playwright no está instalado");
  });

  it("respeta el crawlDelaySeconds de la tienda entre peticiones", async () => {
    const server = await serve({ "/robots.txt": "", [page(1)]: { products: [p1] }, [page(2)]: { products: [] } });
    const result = await run(store(server.url, { crawlDelaySeconds: 0.3 }), fakeRepo().repo);
    expect(result.status).toBe("ok");
    const [robots, first, second] = server.requests.map((r) => r.at);
    expect(first! - robots!).toBeGreaterThanOrEqual(250);
    expect(second! - first!).toBeGreaterThanOrEqual(250);
  });

  it("si robots.txt pide un Crawl-delay de más de 10 s, salta la tienda", async () => {
    const server = await serve({ "/robots.txt": "User-agent: *\nCrawl-delay: 30\n" });
    const result = await run(store(server.url), fakeRepo().repo);
    expect(result).toMatchObject({ status: "skipped", message: expect.stringContaining("Crawl-delay") });
    expect(server.requests).toHaveLength(1);
  });

  it("HTML: lee páginas en ISO-8859-1 con la codificación configurada", async () => {
    // "Relámpago" y "€" en windows-1252, sin charset en Content-Type
    const body = Buffer.concat([
      Buffer.from('<html><body><div class="p"><a href="/rel">', "latin1"),
      Buffer.from([0x52, 0x65, 0x6c, 0xe1, 0x6d, 0x70, 0x61, 0x67, 0x6f]),
      Buffer.from('</a><span class="x">1,50 ', "latin1"),
      Buffer.from([0x80]),
      Buffer.from("</span></div></body></html>", "latin1"),
    ]);
    const server = await serve({
      "/robots.txt": "",
      "/magic": (_req, res) => res.writeHead(200, { "content-type": "text/html" }).end(body),
    });
    const { repo, calls } = fakeRepo();
    const html = { startUrls: [`${server.url}/magic`], selectors: { item: ".p", title: "a", price: ".x" }, encoding: "iso-8859-1" };
    const result = await run(store(server.url, { platform: "html", html }), repo);
    expect(result.status).toBe("ok");
    expect(calls.saved.flat().map((l) => [l.rawTitle, l.priceCents])).toEqual([["Relámpago", 150]]);
  });

  it("la fuente web de una tienda sin web se salta", async () => {
    const result = await run(store("https://nada.example.com", { website: null, platform: null }), fakeRepo().repo);
    expect(result).toMatchObject({ source: "web", status: "skipped" });
  });
});

describe("scrapeStore: CSV de Cardmarket", { timeout: 30_000 }, () => {
  const csvFile = fileURLToPath(new URL("./fixtures/cardmarket-stock-semicolon.csv", import.meta.url));
  const csvText = existsSync(csvFile) ? readFileSync(csvFile) : Buffer.from("");
  const csvStore = (extra: Partial<StoreConfig> = {}) =>
    store("https://rincon.example.com", { website: null, platform: null, cardmarketUser: "RinconDelDraft", ...extra });
  const byCardmarketId = async (listing: NormalizedListing): Promise<MatchResult | null> =>
    listing.cardmarketId ? { oracleId: `o-${listing.cardmarketId}`, scryfallId: `s-${listing.cardmarketId}`, confidence: 1, method: "cardmarket_id" } : null;

  it("importa el fichero de --file: abre la ejecución con su fuente, empareja y cierra como ok", async () => {
    const { repo, calls } = fakeRepo();
    const result = await run(csvStore(), repo, { source: "cardmarket_csv", csvFile: csvFile, match: byCardmarketId });

    expect(result).toMatchObject({ source: "cardmarket_csv", status: "ok", stats: { found: 5, matched: 5, unmatched: 0 }, pages: { ok: 1, failed: 0 } });
    // la firmada no se importa, pero el CSV es el stock completo: la ejecución es "ok"
    expect(result.message).toContain("1 fila(s) descartadas (1 firmada o alterada)");
    expect(calls.sources).toEqual(["cardmarket_csv"]);
    expect(calls.saved.flat().map((l) => [l.externalId, l.cardmarketId, l.match?.method])).toEqual([
      ["1500000001", 566480, "cardmarket_id"],
      ["1500000002", 671359, "cardmarket_id"],
      ["1500000003", 882058, "cardmarket_id"],
      ["1500000004", 607389, "cardmarket_id"],
      ["1500000006", 795131, "cardmarket_id"],
    ]);
    expect(calls.finished).toMatchObject([{ status: "ok", stats: { found: 5, matched: 5 } }]);
  });

  it("lee el fichero configurado en cardmarketCsv.file; con --limit, partial", async () => {
    const { repo, calls } = fakeRepo();
    const result = await run(csvStore({ cardmarketCsv: { file: csvFile } }), repo, { source: "cardmarket_csv", limit: 2 });
    expect(result).toMatchObject({ status: "partial", stats: { found: 2 } });
    expect(calls.saved.flat()).toHaveLength(2);
  });

  it("descarga el enlace configurado una sola vez, con nuestro User-Agent", async () => {
    const server = await serve({
      "/stock.csv": (_req, res) => res.writeHead(200, { "content-type": "text/csv; charset=utf-8" }).end(csvText),
    });
    const { repo, calls } = fakeRepo();
    const result = await run(csvStore({ cardmarketCsv: { url: `${server.url}/stock.csv` } }), repo, { source: "cardmarket_csv" });
    expect(result).toMatchObject({ status: "ok", stats: { found: 5 } });
    expect(server.requests.map((r) => r.url)).toEqual(["/stock.csv"]);
    expect(server.requests[0]!.headers["user-agent"]).toBe("search-magic/0.1 (+pruebas@search-magic.example)");
    expect(calls.saved.flat()[0]).toMatchObject({ url: "https://www.cardmarket.com/es/Magic/Users/RinconDelDraft/Offers/Singles" });
  });

  it("reintenta los 5xx del enlace y no los 404", async () => {
    let attempts = 0;
    const server = await serve({
      "/stock.csv": (_req, res) => {
        attempts++;
        if (attempts < 2) return res.writeHead(503).end();
        res.writeHead(200, { "content-type": "text/csv" }).end(csvText);
      },
    });
    expect(await run(csvStore({ cardmarketCsv: { url: `${server.url}/stock.csv` } }), fakeRepo().repo, { source: "cardmarket_csv" })).toMatchObject({
      status: "ok",
    });
    expect(attempts).toBe(2);

    const missing = await run(csvStore({ cardmarketCsv: { url: `${server.url}/no-existe.csv` } }), fakeRepo().repo, { source: "cardmarket_csv" });
    expect(missing).toMatchObject({ status: "error", message: expect.stringContaining("HTTP 404") });
    expect(server.requests.filter((r) => r.url === "/no-existe.csv")).toHaveLength(1);
  });

  it("si el enlace devuelve una página HTML, error claro", async () => {
    const server = await serve({ "/stock.csv": "<html><body>Inicia sesión</body></html>" });
    const result = await run(csvStore({ cardmarketCsv: { url: `${server.url}/stock.csv` } }), fakeRepo().repo, { source: "cardmarket_csv" });
    expect(result).toMatchObject({ status: "error", message: expect.stringContaining("página HTML") });
  });

  it("sin cardmarketUser o sin fichero, error", async () => {
    const { repo, calls } = fakeRepo();
    expect(await run(csvStore({ cardmarketUser: null }), repo, { source: "cardmarket_csv", csvFile })).toMatchObject({
      status: "error",
      message: expect.stringContaining("cardmarketUser"),
    });
    expect(await run(csvStore(), repo, { source: "cardmarket_csv" })).toMatchObject({ status: "error", message: expect.stringContaining("no existe el CSV") });
    expect(calls.finished.map((f) => f.status)).toEqual(["error", "error"]);
  });

  it("la fecha de los listados es la del CSV; si es antiguo, lo avisa", async () => {
    const dir = mkdtempSync(join(tmpdir(), "search-magic-csv-"));
    const file = join(dir, "stock.csv");
    copyFileSync(csvFile, file);
    const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    utimesSync(file, old, old);
    const { repo, calls } = fakeRepo();
    const result = await run(csvStore({ cardmarketCsv: { file } }), repo, { source: "cardmarket_csv", match: byCardmarketId });
    expect(result.status).toBe("ok");
    expect(result.message).toContain("hace 20 días");
    expect(new Set(calls.saved.flat().map((l) => l.scrapedAt))).toEqual(new Set([old.toISOString()]));
    rmSync(dir, { recursive: true, force: true });
  });

  it("el mismo CSV de la última importación no se vuelve a importar (con --file, sí)", async () => {
    const lastImport: ScrapeRun = {
      id: "run-0",
      storeId: "tienda-prueba",
      source: "cardmarket_csv",
      startedAt: new Date(Date.now() + 60_000).toISOString(),
      finishedAt: new Date(Date.now() + 61_000).toISOString(),
      status: "ok",
      error: null,
      found: 5,
      matched: 5,
      unmatched: 0,
    };
    const { repo, calls } = fakeRepo([lastImport]);
    const configured = csvStore({ cardmarketCsv: { file: csvFile } });
    const result = await run(configured, repo, { source: "cardmarket_csv" });
    expect(result).toMatchObject({ status: "skipped", message: expect.stringContaining("no ha cambiado") });
    expect(calls.saved).toEqual([]);
    expect(calls.finished).toMatchObject([{ status: "skipped" }]);

    expect(await run(configured, repo, { source: "cardmarket_csv", csvFile })).toMatchObject({ status: "ok" });
  });

  it("en seco no escribe nada", async () => {
    const { repo, calls } = fakeRepo();
    const result = await run(csvStore(), repo, { source: "cardmarket_csv", csvFile, dryRun: true });
    expect(result).toMatchObject({ status: "ok", stats: { found: 5 } });
    expect(result.sample).toHaveLength(5);
    expect(calls).toEqual({ started: [], sources: [], saved: [], finished: [] });
  });

  it("Crawlee no deja nada en disco", () => {
    expect(existsSync(join(process.cwd(), "storage"))).toBe(false);
  });
});
