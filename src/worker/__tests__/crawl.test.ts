import { describe, expect, it } from "vitest";
import { Channel, politeDelay, retryDelayMs, Throttle, userAgent } from "../crawl";
import { decodeText, normalizeEncoding } from "../encoding";
import { charsetOf, fetchText, isCardmarketUrl } from "../fetch";
import { crawlDelaySecs } from "../robots";

describe("userAgent", () => {
  it("se identifica con el contacto de SEARCH_MAGIC_CONTACT", () => {
    expect(userAgent("hola@search-magic.example")).toBe("search-magic/0.1 (+hola@search-magic.example)");
  });

  it("sin contacto usa la página del repositorio", () => {
    expect(userAgent("")).toBe("search-magic/0.1 (+https://github.com/RobertoNobleMaestro/search-magic)");
    expect(userAgent("  ")).toBe("search-magic/0.1 (+https://github.com/RobertoNobleMaestro/search-magic)");
  });
});

describe("retryDelayMs", () => {
  it("dobla la espera en cada reintento", () => {
    expect([0, 1, 2].map((attempt) => retryDelayMs(attempt, 2000))).toEqual([2000, 4000, 8000]);
  });

  it("hace caso a Retry-After; si pide más de un minuto, no se reintenta", () => {
    expect(retryDelayMs(0, 2000, "30")).toBe(30_000);
    expect(retryDelayMs(0, 2000, "60")).toBe(60_000);
    expect(retryDelayMs(0, 2000, "3600")).toBeNull();
    expect(retryDelayMs(2, 2000, "1")).toBe(8000);
    expect(retryDelayMs(0, 2000, "no es una fecha")).toBe(2000);
  });
});

describe("crawlDelaySecs", () => {
  const robots = `
# robots.txt de una tienda
User-agent: *
Disallow: /checkout
Crawl-delay: 2

User-agent: AhrefsBot
User-agent: search-magic
Crawl-delay: 5
`;

  it("usa el grupo con nuestro nombre y, si no hay, el de *", () => {
    expect(crawlDelaySecs(robots)).toBe(5);
    expect(crawlDelaySecs(robots, "otro-bot")).toBe(2);
    expect(crawlDelaySecs("User-agent: *\nDisallow:")).toBeUndefined();
    expect(crawlDelaySecs("")).toBeUndefined();
  });
});

describe("Channel", () => {
  it("entrega en orden lo que llega antes y después de empezar a leer", async () => {
    const channel = new Channel<number>();
    channel.push(1);
    const read = (async () => {
      const items: number[] = [];
      for await (const item of channel) items.push(item);
      return items;
    })();
    setTimeout(() => {
      channel.push(2);
      channel.close();
    }, 5);
    expect(await read).toEqual([1, 2]);
  });

  it("propaga el error con el que se cierra", async () => {
    const channel = new Channel<number>();
    channel.close(new Error("se cayó el crawler"));
    await expect((async () => {
      for await (const _ of channel) void _;
    })()).rejects.toThrow("se cayó el crawler");
  });
});

describe("politeDelay", () => {
  it("usa el mayor de 1 s, el Crawl-delay y el de la tienda", () => {
    expect(politeDelay(1)).toEqual({ ok: true, delaySecs: 1 });
    expect(politeDelay(1, 5)).toEqual({ ok: true, delaySecs: 5 });
    expect(politeDelay(1, 2, 3)).toEqual({ ok: true, delaySecs: 3 });
    expect(politeDelay(1, undefined, 0.5)).toEqual({ ok: true, delaySecs: 1 });
  });

  it("un Crawl-delay de más de 10 s es para saltar la tienda", () => {
    expect(politeDelay(1, 10)).toEqual({ ok: true, delaySecs: 10 });
    expect(politeDelay(1, 11)).toMatchObject({ ok: false, reason: expect.stringContaining("11 s") });
  });
});

describe("Throttle", () => {
  it("separa las peticiones, también las que piden turno a la vez", async () => {
    const throttle = new Throttle(40);
    throttle.touch();
    const times: number[] = [];
    const start = Date.now();
    await Promise.all([1, 2, 3].map(() => throttle.wait().then(() => times.push(Date.now() - start))));
    expect(times[0]).toBeGreaterThanOrEqual(35);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(35);
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(35);
  });
});

describe("codificación", () => {
  it("normaliza nombres; ISO-8859-1 se lee como windows-1252, como en los navegadores", () => {
    expect(normalizeEncoding("ISO-8859-1")).toBe("windows-1252");
    expect(normalizeEncoding("latin1")).toBe("windows-1252");
    expect(normalizeEncoding("UTF8")).toBe("utf-8");
    expect(normalizeEncoding("klingon")).toBeNull();
  });

  it("decodifica con BOM o con la codificación indicada", () => {
    const text = "Relámpago 1,50 €";
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from(text)]))).toBe(text);
    expect(decodeText(Buffer.from([0xff, 0xfe, ...Buffer.from(text, "utf16le")]))).toBe(text);
    const latin = Buffer.from([0x52, 0x65, 0x6c, 0xe1, 0x6d, 0x70, 0x61, 0x67, 0x6f, 0x20, 0x80]);
    expect(decodeText(latin, "iso-8859-1")).toBe("Relámpago €");
    expect(charsetOf('text/csv; charset="ISO-8859-1"')).toBe("ISO-8859-1");
    expect(charsetOf("text/csv")).toBeUndefined();
  });
});

describe("fetchText", () => {
  it("nunca pide nada a Cardmarket", async () => {
    expect(isCardmarketUrl("https://www.cardmarket.com/es/Magic/Users/inGenio")).toBe(true);
    expect(isCardmarketUrl("https://cardmarket.com/robots.txt")).toBe(true);
    expect(isCardmarketUrl("https://notcardmarket.com/")).toBe(false);
    await expect(fetchText("https://www.cardmarket.com/robots.txt", { userAgent: userAgent("x"), timeoutMs: 1000 })).rejects.toThrow(
      "no se hacen peticiones automáticas a Cardmarket",
    );
  });
});
