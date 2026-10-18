import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CONDITIONS, type Condition, type Lang, type ListingKind, type NormalizedListing } from "@/lib/data/types";
import { normalizeName } from "@/lib/normalize";
import { parseAttributes } from "../attributes";
import { decodeText } from "../encoding";
import { fetchText } from "../fetch";
import { parsePrice } from "../price";
import { squish } from "../text";
import type { StoreConfig } from "../types";

/**
 * Fuente "cardmarket_csv": el stock que una tienda exporta desde Cardmarket y nos comparte.
 *
 * Cada fila es un artículo de Cardmarket: idProduct se empareja exacto con la impresión de Scryfall
 * (cardmarket_id), sin heurísticas de título. Nunca se pide nada a cardmarket.com (sirve un reto de
 * Cloudflare hasta en robots.txt): solo se construyen enlaces para el usuario.
 *
 * Decisiones:
 *   - El nombre de las columnas cambia entre versiones e idiomas de la exportación: se reconocen por
 *     alias (sin mayúsculas, acentos ni signos) en CSV_COLUMN_ALIASES; para una tienda concreta se
 *     puede fijar la cabecera exacta con cardmarketCsv.columns.
 *   - Separador ";" o "," (o tabulador), detectado en la cabecera; "sep=;" de Excel también vale.
 *   - Precio con coma o punto decimal.
 *   - Playset: el precio es de 4 copias y la cantidad cuenta playsets. Se guarda por carta, como el resto
 *     de ofertas: precio / 4 (redondeado al céntimo) y cantidad × 4.
 *   - Firmadas y alteradas no se importan: su precio no es comparable con el de una copia normal.
 *   - externalId = idArticle; si no hay, una clave estable con producto, idioma, estado y acabado.
 */

export const CSV_FIELDS = [
  "articleId",
  "productId",
  "nameEn",
  "name",
  "nameLocal",
  "expansion",
  "expansionCode",
  "expansionId",
  "collectorNumber",
  "language",
  "condition",
  "foil",
  "signed",
  "playset",
  "altered",
  "price",
  "amount",
  "currency",
  "category",
  "comments",
] as const;
export type CsvField = (typeof CSV_FIELDS)[number];

/**
 * Cabeceras conocidas de cada campo. Se comparan normalizadas: "Exp. Name", "exp name" y "EXPNAME" son
 * la misma. Si una exportación nueva trae otra cabecera, basta con añadirla aquí.
 */
export const CSV_COLUMN_ALIASES: Record<CsvField, string[]> = {
  articleId: ["idArticle", "Article ID", "articleId", "id Artículo"],
  productId: ["idProduct", "Product ID", "productId", "cardmarketId", "Cardmarket ID", "idProducto", "id Producto"],
  nameEn: ["English Name", "Name (English)", "enName", "Nombre en inglés", "Nombre inglés"],
  name: ["Name", "Product Name", "Card Name", "Product", "Card", "Carta", "Producto", "Nombre de la carta"],
  nameLocal: ["Local Name", "locName", "Nombre local", "Nombre"],
  expansion: ["Expansion", "Exp. Name", "Expansion Name", "Set Name", "Set", "Expansión", "Edición", "Nombre de la expansión"],
  expansionCode: ["Exp.", "Exp", "Expansion Code", "Set Code", "setCode", "Código de expansión"],
  expansionId: ["idExpansion", "Expansion ID", "expansionId", "idExpansión"],
  collectorNumber: ["Collector Number", "Collector #", "Number", "cn", "Número", "Número de colección"],
  language: ["Language", "idLanguage", "Lang", "Idioma"],
  condition: ["Condition", "Cond.", "Estado", "Condición"],
  foil: ["Foil", "Foil?", "isFoil", "Is Foil"],
  signed: ["Signed", "Signed?", "isSigned", "Firmada", "Firmado"],
  playset: ["Playset", "Playset?", "isPlayset"],
  altered: ["Altered", "Altered?", "isAltered", "Alterada", "Alterado"],
  price: ["Price", "Price (EUR)", "Price EUR", "Precio", "Precio (EUR)"],
  amount: ["Amount", "Quantity", "Qty", "Count", "Cantidad", "Uds."],
  currency: ["Currency", "Currency Code", "currencyCode", "Moneda"],
  category: ["Category", "Product Type", "Categoría", "Tipo de producto"],
  comments: ["Comments", "Comment", "Comentarios", "Comentario"],
};

/** Idiomas de Cardmarket (id de su API y nombre en inglés) → códigos de Scryfall */
// prettier-ignore
const CARDMARKET_LANGUAGE_IDS: Record<string, Lang> = {
  "1": "en", "2": "fr", "3": "de", "4": "es", "5": "it", "6": "zhs", "7": "ja", "8": "pt", "9": "ru", "10": "ko", "11": "zht",
};
// prettier-ignore
const CARDMARKET_LANGUAGE_NAMES: Record<string, Lang> = {
  english: "en", french: "fr", german: "de", spanish: "es", italian: "it", "s chinese": "zhs", japanese: "ja",
  portuguese: "pt", russian: "ru", korean: "ko", "t chinese": "zht",
  ingles: "en", frances: "fr", aleman: "de", espanol: "es", italiano: "it", "chino s": "zhs", japones: "ja",
  portugues: "pt", ruso: "ru", coreano: "ko", "chino t": "zht",
};

const TRUE_VALUES = new Set(["x", "1", "true", "yes", "y", "si", "s", "foil", "signed", "firmada", "playset", "altered", "alterada"]);

/** Moneda: Cardmarket exporta en la de la cuenta; solo se aceptan euros */
const EUR_VALUES = new Set(["eur", "euro", "euros", ""]);

/** Las cartas sueltas de un usuario de Cardmarket (patrón confirmado en la web de una tienda) */
export function cardmarketOffersUrl(user: string, expansionId?: string): string {
  const base = `https://www.cardmarket.com/es/Magic/Users/${encodeURIComponent(user)}/Offers/Singles`;
  return expansionId ? `${base}?idExpansion=${encodeURIComponent(expansionId)}` : base;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Separador de la cabecera: el más frecuente fuera de comillas entre ";", "," y tabulador */
export function detectDelimiter(headerLine: string): string {
  const counts = new Map<string, number>([[";", 0], [",", 0], ["\t", 0]]);
  let quoted = false;
  for (const char of headerLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && counts.has(char)) counts.set(char, counts.get(char)! + 1);
  }
  let best = ",";
  let max = 0;
  for (const [delimiter, count] of counts) {
    if (count > max) [best, max] = [delimiter, count];
  }
  return best;
}

/** CSV (RFC 4180) → filas: campos entre comillas con separadores, saltos de línea y "" dentro */
export function parseCsv(input: string, delimiter?: string): string[][] {
  let text = input.replace(/^﻿/, "");
  const sep = /^sep=(.)\r?\n/i.exec(text);
  if (sep) text = text.slice(sep[0].length);
  const delim = delimiter ?? sep?.[1] ?? detectDelimiter(text.slice(0, text.search(/\r?\n|$/)));

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  /** fila (contando la cabecera como 1) donde se abrieron las comillas */
  let quotedRow = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (char === '"' && field === "") {
      quoted = true;
      quotedRow = rows.length + 1;
    } else if (char === delim) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  // Unas comillas sin cerrar se tragarían el resto del fichero: mejor fallar que importar medio stock
  // (una ejecución "ok" marcaría sin stock todo lo que falta).
  if (quoted) throw new Error(`el CSV tiene unas comillas sin cerrar en la fila ${quotedRow} (contando la cabecera)`);
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const headerKey = (header: string) => normalizeName(header).replace(/ /g, "");

/** Cabeceras → índice de cada campo. `overrides` fija la cabecera exacta de algunos campos. */
export function mapColumns(
  headers: string[],
  overrides: Partial<Record<CsvField, string>> = {},
): Partial<Record<CsvField, number>> {
  const keys = headers.map(headerKey);
  const index: Partial<Record<CsvField, number>> = {};
  const taken = new Set<number>();
  for (const field of CSV_FIELDS) {
    const override = overrides[field];
    const aliases = override ? [override] : CSV_COLUMN_ALIASES[field];
    for (const alias of aliases) {
      const i = keys.findIndex((key, j) => key === headerKey(alias) && !taken.has(j));
      if (i >= 0) {
        index[field] = i;
        taken.add(i);
        break;
      }
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Valores
// ---------------------------------------------------------------------------

function parseFlag(value: string): boolean {
  return TRUE_VALUES.has(normalizeName(value));
}

export function parseLanguage(value: string): Lang | undefined {
  const text = value.trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return CARDMARKET_LANGUAGE_IDS[String(Number(text))];
  return CARDMARKET_LANGUAGE_NAMES[normalizeName(text)] ?? parseAttributes([{ name: "language", value: text }]).attrs.language;
}

export function parseCondition(value: string): Condition | undefined {
  const code = value.trim().toUpperCase();
  if ((CONDITIONS as readonly string[]).includes(code)) return code as Condition;
  return parseAttributes([{ name: "condition", value }]).attrs.condition;
}

function parseKind(value: string): ListingKind | undefined {
  const norm = normalizeName(value);
  if (!norm) return undefined;
  return /\bsingles?\b|\bsueltas?\b/.test(norm) ? "single" : "sealed";
}

// ---------------------------------------------------------------------------
// Filas → listados
// ---------------------------------------------------------------------------

export interface CsvParseOptions {
  storeId: string;
  cardmarketUser: string;
  scrapedAt: string;
  columns?: Partial<Record<CsvField, string>>;
}

export interface CsvSkippedRow {
  /** fila de datos, empezando en 1 (sin contar la cabecera) */
  row: number;
  reason: string;
}

export interface CsvParseResult {
  listings: NormalizedListing[];
  skipped: CsvSkippedRow[];
  /** cabecera reconocida para cada campo, para revisar el mapeo */
  columns: Partial<Record<CsvField, string>>;
}

/** Stock exportado de Cardmarket → listados (función pura, sin red ni disco) */
export function parseCardmarketCsv(text: string, opts: CsvParseOptions): CsvParseResult {
  const [headers = [], ...rows] = parseCsv(text);
  const index = mapColumns(headers, opts.columns);
  const columns = Object.fromEntries(Object.entries(index).map(([field, i]) => [field, headers[i]!])) as CsvParseResult["columns"];
  const hasName = index.nameEn !== undefined || index.name !== undefined || index.nameLocal !== undefined;
  if (index.price === undefined || (index.productId === undefined && !hasName)) {
    const missing = [index.price === undefined && "price", index.productId === undefined && !hasName && "productId o name"].filter(Boolean);
    throw new Error(
      `el CSV no tiene las columnas ${missing.join(" y ")}. Cabeceras: ${headers.map((h) => `"${h}"`).join(", ")}. ` +
        "Añade el alias en CSV_COLUMN_ALIASES (adapters/cardmarket-csv.ts) o fija la cabecera en cardmarketCsv.columns.",
    );
  }

  const listings: NormalizedListing[] = [];
  const skipped: CsvSkippedRow[] = [];
  const keys = new Map<string, number>();
  rows.forEach((cells, i) => {
    const rowNumber = i + 1;
    if (cells.every((cell) => !cell.trim())) return;
    const get = (field: CsvField) => {
      const at = index[field];
      return at === undefined ? "" : squish(cells[at] ?? "");
    };
    const skip = (reason: string) => void skipped.push({ row: rowNumber, reason });

    // normalizeName("€") es "", como una columna vacía
    if (!EUR_VALUES.has(normalizeName(get("currency")))) return skip(`moneda ${get("currency")}`);
    let priceCents = parsePrice(get("price"));
    if (!priceCents) return skip("sin precio");
    if (parseFlag(get("signed")) || parseFlag(get("altered"))) return skip("firmada o alterada");

    const productText = get("productId");
    const cardmarketId = /^\d+$/.test(productText) ? Number(productText) : undefined;
    const name = get("nameEn") || get("name") || get("nameLocal") || (cardmarketId ? `Producto ${cardmarketId} de Cardmarket` : "");
    if (!name) return skip("sin idProduct ni nombre");

    const amountText = get("amount");
    let quantity = amountText ? Number(amountText) : 1;
    if (!Number.isInteger(quantity) || quantity < 0) return skip(`cantidad no válida: "${amountText}"`);
    if (parseFlag(get("playset"))) {
      priceCents = Math.max(1, Math.round(priceCents / 4));
      quantity *= 4;
    }

    // Una columna "Exp." solo con cifras es el id de la expansión, no su nombre
    const code = get("expansionCode");
    const expansionId = get("expansionId") || (/^\d+$/.test(code) ? code : "");
    const setHint = get("expansion") || (/^\d+$/.test(code) ? "" : code);
    const language = parseLanguage(get("language"));
    const condition = parseCondition(get("condition"));
    const finish = index.foil === undefined ? undefined : parseFlag(get("foil")) ? "foil" : "nonfoil";
    const collectorNumber = get("collectorNumber");
    const kind = parseKind(get("category"));

    let externalId = get("articleId");
    if (!externalId) {
      // Clave estable sin idArticle; si se repite (mismo artículo a dos precios), se numera
      const base = ["cm", cardmarketId ?? normalizeName(`${name} ${setHint}`), language, condition, finish, parseFlag(get("playset")) && "playset"]
        .map((part) => part || "")
        .join(":");
      const seen = (keys.get(base) ?? 0) + 1;
      keys.set(base, seen);
      externalId = seen > 1 ? `${base}#${seen}` : base;
    }

    listings.push({
      storeId: opts.storeId,
      externalId,
      rawTitle: setHint ? `${name} (${setHint})` : name,
      url: cardmarketOffersUrl(opts.cardmarketUser, /^\d+$/.test(expansionId) ? expansionId : undefined),
      priceCents,
      currency: "EUR",
      inStock: quantity > 0,
      quantity,
      ...(condition ? { condition } : {}),
      ...(language ? { language } : {}),
      ...(finish ? { finish } : {}),
      ...(setHint ? { setHint } : {}),
      ...(collectorNumber ? { collectorNumber } : {}),
      ...(kind ? { kind } : {}),
      ...(cardmarketId ? { cardmarketId } : {}),
      scrapedAt: opts.scrapedAt,
    });
  });
  return { listings, skipped, columns };
}

// ---------------------------------------------------------------------------
// De dónde se lee
// ---------------------------------------------------------------------------

/** data/cardmarket/<id>.csv, relativo a la raíz del repositorio (carpeta fuera de git) */
export function defaultCsvPath(storeId: string): string {
  return join("data", "cardmarket", `${storeId}.csv`);
}

/** CSV local configurado (o el de por defecto), resuelto desde el directorio de trabajo */
export function csvFilePath(store: StoreConfig): string {
  return resolve(store.cardmarketCsv?.file ?? defaultCsvPath(store.id));
}

/** La tienda tiene CSV de Cardmarket que importar: usuario y, además, un enlace o el fichero en disco */
export function hasCardmarketCsv(store: StoreConfig, exists: (path: string) => boolean = existsSync): boolean {
  if (!store.cardmarketUser) return false;
  return Boolean(store.cardmarketCsv?.url) || exists(csvFilePath(store));
}

export interface CsvSource {
  text: string;
  /** ruta o URL de donde se ha leído */
  origin: string;
  /** fecha del CSV (ISO): la del fichero o la cabecera Last-Modified del enlace; sin ella, undefined */
  modifiedAt?: string;
}

/** Fecha HTTP o de fichero → ISO; undefined si no se entiende */
function isoDate(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

/**
 * Lee el CSV de una tienda: `file` (--file) si se pasa; si no, el enlace configurado (una descarga por
 * ejecución, con nuestro User-Agent y reintentos) o el fichero local.
 */
export async function loadCardmarketCsv(
  store: StoreConfig,
  opts: { file?: string; userAgent: string; timeoutMs: number; backoffMs?: number },
): Promise<CsvSource> {
  const encoding = store.cardmarketCsv?.encoding;
  const url = store.cardmarketCsv?.url;
  if (!opts.file && url) {
    const response = await fetchText(url, {
      userAgent: opts.userAgent,
      timeoutMs: opts.timeoutMs,
      backoffMs: opts.backoffMs,
      accept: "text/csv,text/plain;q=0.9,*/*;q=0.5",
      encoding,
    });
    if (/text\/html/i.test(response.contentType ?? "")) {
      throw new Error(`${url} devuelve una página HTML, no un CSV (¿el enlace no es público o no es el de descarga?)`);
    }
    return { text: response.text, origin: url, modifiedAt: isoDate(response.lastModified) };
  }
  const path = opts.file ? resolve(opts.file) : csvFilePath(store);
  if (!existsSync(path)) throw new Error(`no existe el CSV ${path}`);
  const [bytes, info] = await Promise.all([readFile(path), stat(path)]);
  return { text: decodeText(bytes, encoding), origin: path, modifiedAt: isoDate(info.mtime) };
}
