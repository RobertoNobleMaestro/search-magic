import type { CatalogLookup, Condition, Finish, Lang } from "@/lib/data/types";
import { normalizeName } from "@/lib/normalize";

/**
 * Lectura de títulos de tienda: separa el nombre de la carta de la edición, el número de
 * coleccionista, el estado, el idioma, el acabado y las variantes de impresión.
 *
 *   "Lightning Bolt (M11) NM"                       → Lightning Bolt · M11 · NM
 *   "Relámpago [M11] - Español - Foil"              → Relámpago · M11 · es · foil
 *   "Counterspell - MH2 - 267 - Inglés"             → Counterspell · MH2 · nº 267 · en
 *   "Aves del Paraíso (Edición Básica 2010) Jugada" → Aves del Paraíso · Edición Básica 2010 · PL
 *   "Eldrazi Ravager⁣ - Modern Horizons 3⁣ (Uncommon)⁣ [5]" → Eldrazi Ravager · Modern Horizons 3 · nº 5
 *   "Super Shredder - Teenage Mutant Ninja Turtles (Mythic) [TMT-83]" → … · TMT · nº 83
 *
 * La rareza entre paréntesis y los caracteres invisibles (Unicode Cf) se descartan. Los títulos
 * bilingües ("Abajo en el valle / Down in the Valley") quedan enteros en el nombre: el
 * emparejador prueba cada lado (ver nameCandidates en index.ts).
 *
 * El título se parte en segmentos por paréntesis, corchetes, "|" y guiones con espacios. El
 * primer segmento que no son solo etiquetas es el nombre (se le quitan las etiquetas pegadas
 * al final); los demás son etiquetas o, si no, la edición.
 */

/** Variantes de impresión que las tiendas indican en el título */
export type PrintingTag = "borderless" | "showcase" | "extendedart" | "fullart" | "promo" | "prerelease" | "retro";

export interface ParsedTitle {
  /** Nombre tal como lo escribe la tienda, sin etiquetas: "Lightning Bolt", "Fuego // Hielo" */
  name: string;
  /** Sobres, cajas, fundas, lotes…: no es una carta suelta */
  nonSingle: boolean;
  /** Textos que parecen la edición, en orden de aparición: "M11", "Magic 2011" */
  setHints: string[];
  collectorNumber?: string;
  condition?: Condition;
  language?: Lang;
  finish?: Finish;
  tags: PrintingTag[];
}

type Hit =
  | { kind: "condition"; value: Condition }
  | { kind: "language"; value: Lang }
  | { kind: "finish"; value: Finish }
  | { kind: "printing"; value: PrintingTag }
  | { kind: "number"; value: string }
  | { kind: "set"; value: string }
  | { kind: "quantity"; value: number }
  | { kind: "noise" };

// ---------------------------------------------------------------------------
// Vocabulario (frases ya pasadas por normalizeName)
// ---------------------------------------------------------------------------

/**
 * Dónde vale cada frase:
 *   strong   en cualquier sitio, también pegada al final del nombre: "Lightning Bolt Foil"
 *   weak     abreviaturas de 2-3 letras (ES, EN, IT, DE, EX…): pegadas al nombre solo en
 *            mayúsculas, para no comerse "Espadas en guadañas" ni "Elfos de Llanowar"
 *   segment  palabras que también salen en nombres de cartas (Good, Jugada, Normal, Magic…):
 *            solo en un segmento propio, "… (M10) Jugada" o "… | Good |"
 */
type Strength = "strong" | "weak" | "segment";

const VOCAB = new Map<string, { hit: Hit; strength: Strength }>();

function define(strength: Strength, hit: Hit, phrases: string[]): void {
  for (const phrase of phrases) VOCAB.set(phrase, { hit, strength });
}

// Estado, en la escala de Cardmarket. Las siglas de EE. UU. se aproximan: MP (moderately played)
// → GD, HP (heavily played) → PL, DMG → PO. "LP" se toma como el LP de Cardmarket (Light Played),
// aunque el LP de EE. UU. (Lightly Played) suele equivaler más bien a EX o GD.
const cond = (value: Condition): Hit => ({ kind: "condition", value });
define("weak", cond("MT"), ["mt"]);
define("segment", cond("MT"), ["m", "mint", "nueva", "nuevo"]);
define("strong", cond("NM"), ["nm", "near mint", "casi nueva", "casi nuevo", "como nueva", "como nuevo"]);
define("weak", cond("EX"), ["ex"]);
define("strong", cond("EX"), ["excellent", "excelente"]);
define("weak", cond("GD"), ["gd", "mp"]);
define("strong", cond("GD"), ["moderately played"]);
define("segment", cond("GD"), ["good", "buena", "bueno"]);
define("weak", cond("LP"), ["lp"]);
define("strong", cond("LP"), ["light played", "lightly played", "slightly played", "ligeramente jugada", "ligeramente jugado"]);
define("weak", cond("PL"), ["pl", "hp"]);
define("strong", cond("PL"), ["heavily played", "muy jugada", "muy jugado"]);
define("segment", cond("PL"), ["played", "jugada", "jugado"]);
define("weak", cond("PO"), ["po", "dmg"]);
define("segment", cond("PO"), ["poor", "pobre", "damaged", "danada", "danado"]);

// Idioma: código de Scryfall, palabras y abreviaturas. "POR" no cuenta: es la edición Portal.
export const LANGUAGES: ReadonlyArray<[Lang, string[], string[]]> = [
  ["es", ["espanol", "castellano", "spanish"], ["es", "esp", "spa"]],
  ["en", ["ingles", "english"], ["en", "eng"]],
  ["it", ["italiano", "italian"], ["it", "ita"]],
  ["fr", ["frances", "french"], ["fr", "fra", "fre"]],
  ["de", ["aleman", "german"], ["de", "ger", "deu"]],
  ["ja", ["japones", "japanese"], ["ja", "jp", "jap", "jpn"]],
  ["pt", ["portugues", "portuguese"], ["pt"]],
  ["ko", ["coreano", "korean"], ["ko", "kor"]],
  ["ru", ["ruso", "russian"], ["ru", "rus"]],
  ["zhs", ["chino", "chinese", "chino simplificado", "simplified chinese"], ["zhs"]],
  ["zht", ["chino tradicional", "traditional chinese"], ["zht"]],
];
for (const [value, words, abbreviations] of LANGUAGES) {
  define("strong", { kind: "language", value }, words);
  define("weak", { kind: "language", value }, abbreviations);
}

const finish = (value: Finish): Hit => ({ kind: "finish", value });
define("strong", finish("foil"), ["foil", "surge foil", "galaxy foil", "textured foil", "halo foil"]);
define("strong", finish("etched"), ["etched", "foil etched", "etched foil"]);
define("strong", finish("nonfoil"), ["nonfoil", "non foil", "no foil", "sin foil"]);
define("segment", finish("nonfoil"), ["normal"]);

const tag = (value: PrintingTag): Hit => ({ kind: "printing", value });
define("strong", tag("borderless"), ["borderless", "sin borde", "sin bordes"]);
define("strong", tag("showcase"), ["showcase"]);
define("strong", tag("extendedart"), ["extended art", "arte extendido"]);
define("segment", tag("extendedart"), ["extended"]);
define("strong", tag("fullart"), ["full art", "fullart", "arte completo"]);
define("strong", tag("promo"), ["promo", "promocional", "promo pack", "buy a box"]);
define("strong", tag("prerelease"), ["prerelease", "pre release", "presentacion"]);
define("strong", tag("retro"), ["retro", "retro frame", "old frame", "marco retro", "marco antiguo"]);

const noise: Hit = { kind: "noise" };
define("strong", noise, ["mtg"]);
define("segment", noise, [
  "magic",
  "magic the gathering",
  "carta",
  "carta suelta",
  "single",
  "tcg",
  "common",
  "comun",
  "uncommon",
  "infrecuente",
  "rare",
  "rara",
  "mythic",
  "mythic rare",
  "mitica",
  "rara mitica",
  "special",
  "especial",
  "bonus",
]);

/**
 * Lo único que se quita del principio del nombre: "1x Lightning Bolt", "FOIL Lightning Bolt",
 * "MTG Lightning Bolt". El resto del vocabulario no, porque hay cartas como "Etched Oracle".
 */
const HEAD_WORDS = new Set(["foil", "mtg"]);

// ---------------------------------------------------------------------------
// Productos que no son cartas sueltas
// ---------------------------------------------------------------------------

/** Se buscan en la parte del nombre: "Booster" también es la edición "Mystery Booster". */
const PRODUCT_WORDS = new Set([
  "booster",
  "boosters",
  "sobres",
  "display",
  "bundle",
  "funda",
  "fundas",
  "sleeves",
  "carpeta",
  "binder",
  "playmat",
  "playmats",
  "tapete",
  "tapetes",
  "deckbox",
  "portamazos",
  "toploader",
  "precon",
  "preconstruido",
]);
const PRODUCT_PHRASES = [
  "caja de",
  "deck box",
  "fat pack",
  "starter kit",
  "kit de presentacion",
  "prerelease kit",
  "prerelease pack",
  "commander deck",
  "starter deck",
  "dragon shield",
  "ultra pro",
  "ultimate guard",
  "gamegenic",
  "set de dados",
  "dice set",
  "life counter",
  "contador de vidas",
];
/** Primera palabra del nombre: "Sobre Bloomburrow", "Mazo Commander…", "Caja…" */
const PRODUCT_STARTS = new Set(["sobre", "mazo", "caja", "kit"]);
/** En cualquier parte del título: las fichas no están en el catálogo y los lotes no tienen precio por carta */
const ANYWHERE_PRODUCT_WORDS = new Set(["token", "tokens", "ficha", "fichas", "lote", "lotes", "playset"]);

function isProduct(nameText: string, title: string): boolean {
  const words = normalizeName(nameText).split(" ");
  const padded = ` ${words.join(" ")} `;
  return (
    PRODUCT_STARTS.has(words[0] ?? "") ||
    words.some((w) => PRODUCT_WORDS.has(w)) ||
    PRODUCT_PHRASES.some((p) => padded.includes(` ${p} `)) ||
    normalizeName(title)
      .split(" ")
      .some((w) => ANYWHERE_PRODUCT_WORDS.has(w))
  );
}

// ---------------------------------------------------------------------------
// Segmentos y palabras
// ---------------------------------------------------------------------------

/** "#263", "# 263", "nº 263", "n.º 263", "núm. 263", "#1★", "#DMR-271" (The List) */
const HASH_NUMBER = /(?:#|\bn\.?\s?[º°]|\bn[uú]m(?:ero)?\.?)\s*((?:[a-z]{1,5}-)?\d+[a-z]?★?)(?![\p{L}\p{N}])/iu;
/** "263/281": número / total de la edición */
const TOTAL_NUMBER = /(?<![\p{L}\p{N}\/])(\d{1,4}[a-z]?)\s?\/\s?\d{1,4}(?![\p{L}\p{N}\/])/iu;
/** Un segmento que es solo un número: "- 267 -", "(113p)" */
const NUMBER_TOKEN = /^(?:[a-z]{1,5}-)?\d+[a-z]?★?$/i;
/** Entre corchetes, edición y número de las tiendas Shopify: "[XSOS-285]", "[TMT-83]" */
const SET_NUMBER_TOKEN = /^((?=[a-z0-9]*[a-z])[a-z0-9]{2,6})-(\d+[a-z]?★?)$/i;
/** Variante de arte que no es el número de coleccionista: "Pantano (V.2)" */
const VARIANT_TOKEN = /^v(?:er(?:si[oó]n)?)?\.?\s?\d+$/i;
/** Código de edición pegado al nombre: en mayúsculas y con letras y cifras ("M11", "2XM", "MH2") */
const SET_CODE_TOKEN = /^(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{2,5}$/;
/** "1x", "x4" */
const QUANTITY_TOKEN = /^(?:x(\d+)|(\d+)x)$/i;

/** Guiones con espacio a algún lado ("Mirror-Breaker" no se parte), "|" y viñetas */
const DELIMITER = /\s*[|·•]\s*|\s+[-‐‑–—]+\s*|\s*[-‐‑–—]+\s+/;
const CLOSERS = ")]}";

interface Segment {
  text: string;
  bracketed: boolean;
}

function splitSegments(text: string): Segment[] {
  const out: Segment[] = [];
  const push = (part: string, bracketed: boolean) => {
    for (const piece of part.split(DELIMITER)) {
      const trimmed = piece.trim();
      if (trimmed) out.push({ text: trimmed, bracketed });
    }
  };
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if ("([{".includes(ch)) {
      push(text.slice(start, i), false);
      let close = i + 1;
      while (close < text.length && !CLOSERS.includes(text[close]!)) close++;
      push(text.slice(i + 1, close), true);
      i = close;
      start = close + 1;
    } else if (CLOSERS.includes(ch)) {
      push(text.slice(start, i), false);
      start = i + 1;
    }
  }
  push(text.slice(start), false);
  return out;
}

interface Token {
  raw: string;
  norm: string;
}

function tokenize(text: string): Token[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => ({ raw, norm: normalizeName(raw) }));
}

function isUpperCase(tokens: Token[]): boolean {
  const text = tokens.map((t) => t.raw).join("");
  return text === text.toUpperCase() && text !== text.toLowerCase();
}

/** La palabra sin la puntuación de detrás: "NM," → "NM" */
function bare(token: Token): string {
  return token.raw.replace(/[.,;:]+$/, "");
}

/** "M11", "mh2": ningún nombre de carta es una sola palabra con letras y cifras */
function isLoneSetCode(tokens: Token[]): boolean {
  return tokens.length === 1 && SET_CODE_TOKEN.test(bare(tokens[0]!).toUpperCase());
}

function quantityOf(token: Token): number | null {
  const match = QUANTITY_TOKEN.exec(bare(token));
  return match ? Number(match[1] ?? match[2]) : null;
}

type Match = { hit: Hit; len: number };

/**
 * Etiqueta formada por `tokens`. Pegada al nombre (inName: "Lightning Bolt M11 NM") las
 * abreviaturas solo valen en mayúsculas, las palabras de segmento no valen y se reconocen
 * códigos de edición. Si no, está en un segmento propio ("(ES)", "| Near Mint |") o al final
 * de la edición ("(Magic 2011 Foil)").
 */
function recognize(tokens: Token[], inName: boolean): Hit | null {
  const entry = VOCAB.get(
    tokens
      .map((t) => t.norm)
      .filter(Boolean)
      .join(" "),
  );
  if (entry) {
    if (inName && entry.strength === "segment") return null;
    if (inName && entry.strength === "weak" && !isUpperCase(tokens)) return null;
    return entry.hit;
  }
  if (tokens.length !== 1) return null;
  const quantity = quantityOf(tokens[0]!);
  if (quantity !== null) return { kind: "quantity", value: quantity };
  const raw = bare(tokens[0]!);
  return inName && SET_CODE_TOKEN.test(raw) ? { kind: "set", value: raw } : null;
}

/** Etiqueta de 1 a 3 palabras de un segmento que empieza en `start` */
function matchStarting(tokens: Token[], start: number): Match | null {
  for (let len = Math.min(3, tokens.length - start); len >= 1; len--) {
    const hit = recognize(tokens.slice(start, start + len), false);
    if (hit) return { hit, len };
  }
  return null;
}

/** Etiqueta de 1 a 3 palabras que acaba justo antes de `end`, sin bajar de `floor` */
function matchEnding(tokens: Token[], end: number, floor: number, inName: boolean): Match | null {
  for (let len = Math.min(3, end - floor); len >= 1; len--) {
    const hit = recognize(tokens.slice(end - len, end), inName);
    if (hit) return { hit, len };
  }
  return null;
}

/** Etiquetas de un segmento entero, o null si alguna palabra no lo es */
function readWhole(tokens: Token[], bracketed: boolean): Hit[] | null {
  // Un número suelto solo si es todo el segmento: "Magic 2011" o "Commander 2021" son ediciones
  const words = tokens.filter((t) => t.norm);
  const text = words.map(bare).join(" ");
  if (VARIANT_TOKEN.test(text)) return [{ kind: "noise" }];
  const setNumber = bracketed && words.length === 1 ? SET_NUMBER_TOKEN.exec(text) : null;
  if (setNumber) return [{ kind: "set", value: setNumber[1]! }, { kind: "number", value: setNumber[2]! }];
  if (words.length === 1 && NUMBER_TOKEN.test(text)) return [{ kind: "number", value: text }];
  const hits: Hit[] = [];
  for (let i = 0; i < tokens.length; ) {
    if (!tokens[i]!.norm) {
      i++; // puntuación suelta
      continue;
    }
    const found = matchStarting(tokens, i);
    if (!found) return null;
    hits.push(found.hit);
    i += found.len;
  }
  return hits;
}

/** Quita etiquetas del final del nombre (sin dejarlo vacío) o de la edición */
function stripEnd(tokens: Token[], inName: boolean): { rest: Token[]; hits: Hit[] } {
  const keep = inName ? 1 : 0;
  let end = tokens.length;
  const hits: Hit[] = [];
  while (end > keep) {
    if (!tokens[end - 1]!.norm) {
      end--;
      continue;
    }
    const found = matchEnding(tokens, end, keep, inName);
    if (!found) break;
    hits.unshift(found.hit); // en el orden del título
    end -= found.len;
  }
  return { rest: tokens.slice(0, end), hits };
}

/** Quita cantidades y HEAD_WORDS del principio del nombre, sin dejarlo vacío */
function stripStart(tokens: Token[]): { rest: Token[]; hits: Hit[] } {
  let start = 0;
  const hits: Hit[] = [];
  while (tokens.length - start > 1) {
    const token = tokens[start]!;
    const quantity = quantityOf(token);
    if (quantity !== null) hits.push({ kind: "quantity", value: quantity });
    else if (HEAD_WORDS.has(token.norm)) hits.push(VOCAB.get(token.norm)!.hit);
    else if (token.norm) break;
    start++;
  }
  return { rest: tokens.slice(start), hits };
}

function joinTokens(tokens: Token[]): string {
  return tokens
    .map((t) => t.raw)
    .join(" ")
    .replace(/^[\s,;:.\-–—\/|]+|[\s,;:.\-–—\/|]+$/g, "");
}

function apply(parsed: ParsedTitle, hit: Hit): void {
  switch (hit.kind) {
    case "condition":
      parsed.condition ??= hit.value;
      break;
    case "language":
      parsed.language ??= hit.value;
      break;
    case "finish":
      // "Foil - Etched" es etched; en lo demás manda lo primero que aparece
      if (!parsed.finish || hit.value === "etched") parsed.finish = hit.value;
      break;
    case "printing":
      if (!parsed.tags.includes(hit.value)) parsed.tags.push(hit.value);
      break;
    case "number":
      parsed.collectorNumber ??= hit.value;
      break;
    case "set":
      parsed.setHints.push(hit.value);
      break;
    case "quantity":
      // "1x" es ruido; "4x Lightning Bolt" es un lote
      if (hit.value > 1) parsed.nonSingle = true;
      break;
    case "noise":
      break;
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Quita los caracteres invisibles de formato (Unicode Cf): las tiendas Shopify meten U+2063
 * ("Eldrazi Ravager⁣ - Modern Horizons 3⁣ (Uncommon)⁣ [5]"), y a veces hay U+200B o U+00AD.
 */
export function stripInvisible(text: string): string {
  return text.replace(/\p{Cf}/gu, "");
}

export function parseTitle(rawTitle: string): ParsedTitle {
  const parsed: ParsedTitle = { name: "", nonSingle: false, setHints: [], tags: [] };

  let title = stripInvisible(rawTitle).replace(/\s+/g, " ");
  for (const pattern of [HASH_NUMBER, TOTAL_NUMBER]) {
    title = title.replace(pattern, (_match, number: string) => {
      parsed.collectorNumber ??= number;
      return " ";
    });
  }

  const segments = splitSegments(title).map((s) => ({ ...s, tokens: tokenize(s.text) }));
  const whole = segments.map((s) => readWhole(s.tokens, s.bracketed));
  // El nombre: el primer segmento sin corchetes que no son solo etiquetas ni un código de edición
  // suelto ("M11 - Lightning Bolt"). Si no hay, se van relajando las condiciones: sin código, sin
  // etiquetas (la carta "Foil (PCY)") y, por último, con corchetes.
  const preferences = [
    (i: number) => !segments[i]!.bracketed && !whole[i] && !isLoneSetCode(segments[i]!.tokens),
    (i: number) => !segments[i]!.bracketed && !whole[i],
    (i: number) => !segments[i]!.bracketed,
    (i: number) => !whole[i],
  ];
  let nameAt = -1;
  for (const preferred of preferences) {
    nameAt = segments.findIndex((_, i) => preferred(i));
    if (nameAt >= 0) break;
  }

  segments.forEach((segment, i) => {
    const tags = whole[i];
    if (i === nameAt) {
      if (isProduct(segment.text, title)) parsed.nonSingle = true;
      const end = stripEnd(segment.tokens, true);
      const start = stripStart(end.rest);
      for (const hit of [...start.hits, ...end.hits]) apply(parsed, hit);
      parsed.name = joinTokens(start.rest);
    } else if (tags) {
      for (const hit of tags) apply(parsed, hit);
    } else {
      const { rest, hits } = stripEnd(segment.tokens, false);
      for (const hit of hits) apply(parsed, hit);
      const hint = joinTokens(rest);
      if (hint) parsed.setHints.push(hint);
    }
  });

  return parsed;
}

const SET_LABEL = /^\s*(?:set|edici[oó]n|expansi[oó]n|colecci[oó]n)\s*:\s*/i;

/**
 * Formas en que se puede buscar una edición escrita por la tienda:
 * "Edición: Magic 2011 (M11)" → ["Edición: Magic 2011 (M11)", "Magic 2011 (M11)", "Magic 2011", "M11"]
 *
 * La última es lo que va antes de los dos puntos, para las subediciones que el catálogo no
 * conoce: "Secrets of Strixhaven: Extras" → "Secrets of Strixhaven" (Scryfall mete los extras en
 * la edición principal). Lo de después no: "Commander: Modern Horizons 3" no es Modern Horizons 3.
 */
export function setHintForms(hint: string): string[] {
  const text = stripInvisible(hint).replace(SET_LABEL, "").trim();
  const parts = splitSegments(text).map((s) => s.text);
  const beforeColon = parts.map((p) => p.split(":")[0]!.trim()).filter((p, i) => p && p !== parts[i]);
  return [hint, text, ...parts, ...beforeColon];
}

/** Primera edición que se reconoce entre las pistas, probando cada una entera y por partes */
export async function resolveSetCode(
  hints: Array<string | undefined>,
  catalog: Pick<CatalogLookup, "resolveSet">,
): Promise<string | null> {
  const tried = new Set<string>();
  for (const hint of hints) {
    if (!hint) continue;
    for (const form of setHintForms(hint)) {
      const key = normalizeName(form);
      if (!key || tried.has(key)) continue;
      tried.add(key);
      const code = await catalog.resolveSet(form);
      if (code) return code;
    }
  }
  return null;
}
