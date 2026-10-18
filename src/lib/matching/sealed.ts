import type { CatalogLookup, Lang, ListingKind, SealedCandidate, SealedMatchResult } from "@/lib/data/types";
import { normalizeName } from "@/lib/normalize";
import { trigramSimilarity } from "@/lib/trigram";
import { LANGUAGES, parseTitle, resolveSetCode, stripInvisible } from "./title";

/**
 * Producto sellado: clasificación de títulos y emparejamiento con el catálogo de MTGJSON.
 *
 *   "Caja de sobres de juego Bloomburrow (Español)" → booster_box/play · blb · es
 *   "Duskmourn Collector Booster Pack - ENG"          → booster_pack/collector · dsk · en
 *   "Kit de presentación Pirexia: Todos serán uno"    → limited_aid_tool/prerelease_kit · one
 *
 * El título se parte en segmentos (paréntesis, corchetes, "|", " - ", "+") y palabras
 * normalizadas. Las frases del vocabulario (RULES) dan la categoría y el subtipo de MTGJSON, el
 * idioma y algunas palabras obligatorias; se marcan como usadas. Lo que queda son "tramos" de
 * texto donde está la edición y, a veces, palabras que distinguen el producto ("Ninjas", "negro").
 */

// ---------------------------------------------------------------------------
// Vocabulario (frases ya pasadas por normalizeName)
// ---------------------------------------------------------------------------

interface Effect {
  /** basta por sí sola para saber que el título es de producto sellado */
  marker?: boolean;
  /** solo al principio de su segmento (tras lo ya reconocido): "Sobre …", "Mazo …", "Caja …" */
  atStart?: boolean;
  /** la palabra siguiente no puede ser una de estas: "Display of Dominance" es una carta */
  notBefore?: string[];
  /** ni delante de un número: "Magic 2015" es una edición */
  notBeforeNumber?: boolean;
  pack?: boolean;
  box?: boolean;
  /** subtipo de un sobre o una caja de sobres */
  booster?: string;
  /** categoría propia (bundle, deck…): manda sobre sobre/caja */
  category?: string;
  /** subtipos admitidos de esa categoría; ausente = cualquiera */
  subtypes?: string[];
  /** palabras que tiene que llevar el nombre del producto en MTGJSON */
  keywords?: string[];
  isCase?: boolean;
  mtgo?: boolean;
  secretLair?: boolean;
  language?: Lang;
  /** vocabulario de tienda española: el emparejamiento se registra como exact_es */
  es?: boolean;
  /** nombre de edición con palabras de producto: ni cuenta como producto ni se quita */
  lock?: boolean;
}

const RULES: Array<[string[], Effect]> = [
  // Ediciones de cartas sueltas con palabras de producto
  [["mystery booster"], { lock: true }],

  // Ruido
  [
    [
      "magic the gathering",
      "mtg",
      "tcg",
      "precintado",
      "precintada",
      "sellado",
      "sellada",
      "sealed",
      "nuevo",
      "nueva",
      "oficial",
      "original",
      "preventa",
      "pre order",
      "preorder",
      "reserva",
      "producto",
      "edicion",
      "expansion",
    ],
    {},
  ],
  [["magic"], { notBeforeNumber: true }],

  // Cajas de cajas: solo si el título lo dice
  [["caja de cajas", "caja de displays", "master case", "case"], { isCase: true }],

  // Subtipos de sobre (antes que las cajas: "set booster box" es "set booster" + "box")
  [["play booster", "booster play"], { marker: true, pack: true, booster: "play" }],
  [["draft booster", "booster draft"], { marker: true, pack: true, booster: "draft" }],
  [["set booster"], { marker: true, pack: true, booster: "set" }],
  [["collector booster", "collectors booster", "booster collector"], { marker: true, pack: true, booster: "collector" }],
  [["jumpstart booster", "jump start booster", "booster jumpstart"], { marker: true, pack: true, booster: "jumpstart" }],
  [["theme booster"], { marker: true, pack: true, booster: "theme" }],
  [["welcome booster"], { marker: true, pack: true, booster: "welcome" }],
  [["box topper", "booster box topper"], { marker: true, pack: true, booster: "topper" }],

  // Cajas de sobres
  [["booster box", "booster display", "box booster"], { marker: true, box: true }],
  [["caja de sobres", "caja de boosters", "caja de booster", "caja sobres", "display de sobres"], { marker: true, box: true, es: true }],
  [["display"], { marker: true, box: true, notBefore: ["of"] }],
  [["caja"], { marker: true, box: true, atStart: true, es: true }],
  [["caja de"], { box: true, es: true }],
  [["box"], { box: true }],

  // Subtipos de sobre en español y palabras sueltas
  [["booster de juego", "sobre de juego", "sobres de juego"], { marker: true, pack: true, booster: "play", es: true }],
  [["de juego", "juego"], { booster: "play", es: true }],
  [["play"], { booster: "play" }],
  [["booster de draft", "sobre de draft", "sobres de draft"], { marker: true, pack: true, booster: "draft", es: true }],
  [["de draft"], { booster: "draft", es: true }],
  [["draft"], { booster: "draft" }],
  [["booster de edicion", "sobre de edicion", "sobres de edicion"], { marker: true, pack: true, booster: "set", es: true }],
  [["de edicion"], { booster: "set", es: true }],
  [
    ["booster de coleccionista", "sobre de coleccionista", "sobres de coleccionista"],
    { marker: true, pack: true, booster: "collector", es: true },
  ],
  [["de coleccionista", "coleccionista"], { booster: "collector", es: true }],
  [["collector", "collectors"], { booster: "collector" }],
  [["sobre jumpstart", "sobre de jumpstart", "sobres de jumpstart"], { marker: true, pack: true, booster: "jumpstart", es: true }],
  [["jumpstart", "jump start"], { booster: "jumpstart" }],
  [["booster tematico", "sobre tematico", "sobres tematicos"], { marker: true, pack: true, booster: "theme", es: true }],
  [["sobre de bienvenida"], { marker: true, pack: true, booster: "welcome", es: true }],
  [["foil promo pack"], { marker: true, pack: true, booster: "promotional", keywords: ["foil", "promo"] }],
  [["promo pack"], { marker: true, pack: true, booster: "promotional", keywords: ["promo"] }],
  [["sobre promocional"], { marker: true, pack: true, booster: "promotional", keywords: ["promo"], es: true }],
  [["sample pack", "collector booster sample pack"], { marker: true, pack: true, booster: "promotional", keywords: ["sample"] }],
  [["booster pack", "booster", "boosters"], { marker: true, pack: true }],
  [["sobres"], { marker: true, pack: true, es: true }],
  [["sobre"], { marker: true, pack: true, atStart: true, es: true }],
  [["pack", "packs"], { pack: true }],

  // Bundles
  [["gift bundle"], { marker: true, category: "bundle", subtypes: ["gift_bundle"] }],
  [["bundle de regalo", "bundle regalo"], { marker: true, category: "bundle", subtypes: ["gift_bundle"], es: true }],
  [["bundle", "fat pack"], { marker: true, category: "bundle" }],

  // Mazos
  [["commander deck", "deck commander", "commander precon", "precon commander"], { marker: true, category: "deck", subtypes: ["commander"] }],
  [
    ["mazo commander", "mazo de commander", "mazo preconstruido commander", "mazo commander preconstruido"],
    { marker: true, category: "deck", subtypes: ["commander"], es: true },
  ],
  [["welcome deck"], { marker: true, category: "deck", subtypes: ["welcome"] }],
  [["mazo de bienvenida"], { marker: true, category: "deck", subtypes: ["welcome"], es: true }],
  [["starter deck"], { marker: true, category: "deck", subtypes: ["starter_deck"] }],
  [["mazo de inicio", "mazo de iniciacion"], { marker: true, category: "deck", subtypes: ["starter_deck"], es: true }],
  [["theme deck"], { marker: true, category: "deck", subtypes: ["theme"] }],
  [["mazo tematico"], { marker: true, category: "deck", subtypes: ["theme"], es: true }],
  [["intro pack", "intro deck"], { marker: true, category: "deck", subtypes: ["intro"] }],
  [["planeswalker deck"], { marker: true, category: "deck", subtypes: ["planeswalker"] }],
  [["mazo de planeswalker"], { marker: true, category: "deck", subtypes: ["planeswalker"], es: true }],
  [["challenger deck"], { marker: true, category: "deck", subtypes: ["challenger"] }],
  [["precon", "preconstruido", "mazo preconstruido"], { marker: true, category: "deck" }],
  [["mazo"], { marker: true, category: "deck", atStart: true, es: true }],

  // Ayudas para limitado
  [["prerelease pack", "prerelease kit"], { marker: true, category: "limited_aid_tool", subtypes: ["prerelease_kit"] }],
  [
    ["kit de presentacion", "pack de presentacion", "kit de prerelease", "kit presentacion"],
    { marker: true, category: "limited_aid_tool", subtypes: ["prerelease_kit"], es: true },
  ],
  [["prerelease"], { category: "limited_aid_tool", subtypes: ["prerelease_kit"] }],
  [["presentacion"], { category: "limited_aid_tool", subtypes: ["prerelease_kit"], es: true }],
  [["draft night"], { marker: true, category: "limited_aid_tool", subtypes: ["draft", "draft_set"], keywords: ["night"] }],
  [["noche de draft"], { marker: true, category: "limited_aid_tool", subtypes: ["draft", "draft_set"], keywords: ["night"], es: true }],

  // Kits de inicio para dos jugadores y cajas para empezar
  [["starter kit", "two player starter"], { marker: true, category: "multiple_decks", subtypes: ["two_player_starter"] }],
  [
    ["kit de inicio", "kit de iniciacion", "kit para dos jugadores"],
    { marker: true, category: "multiple_decks", subtypes: ["two_player_starter"], es: true },
  ],
  [["beginner box"], { marker: true, category: "box_set", subtypes: ["starter_deck"], keywords: ["beginner"] }],
  [
    ["caja de iniciacion", "caja de inicio", "caja para principiantes"],
    { marker: true, category: "box_set", subtypes: ["starter_deck"], keywords: ["beginner"], es: true },
  ],
  [["starter collection"], { marker: true, category: "box_set", subtypes: ["starter_deck"], keywords: ["starter", "collection"] }],
  [["scene box"], { marker: true, category: "box_set", subtypes: ["other"], keywords: ["scene"] }],
  [["tin"], { category: "box_set", subtypes: ["other"], keywords: ["tin"] }],
  [["lata"], { category: "box_set", subtypes: ["other"], keywords: ["tin"], es: true }],

  // Productos que solo se emparejan si el título los nombra
  [["mtgo redemption"], { marker: true, mtgo: true, category: "box_set", subtypes: ["mtgo_redemption"] }],
  [["mtgo", "redemption"], { mtgo: true }],
  [["secret lair"], { secretLair: true, keywords: ["secret", "lair"] }],
];

// Idioma: "Español", "en inglés", "versión en castellano", "edición española"…
const LANGUAGE_ADJECTIVES: Array<[Lang, string[]]> = [
  ["es", ["espanola"]],
  ["en", ["inglesa"]],
  ["fr", ["francesa"]],
  ["it", ["italiana"]],
  ["de", ["alemana"]],
  ["ja", ["japonesa"]],
  ["pt", ["portuguesa"]],
];
for (const [language, words] of LANGUAGES) {
  const phrases = words.flatMap((w) => [w, `en ${w}`, `version en ${w}`, `edicion en ${w}`, `idioma ${w}`]);
  RULES.unshift([phrases, { language }]);
}
for (const [language, words] of LANGUAGE_ADJECTIVES) {
  const phrases = words.flatMap((w) => [w, `version ${w}`, `edicion ${w}`]);
  RULES.unshift([phrases, { language }]);
}

/** Abreviaturas de idioma: solas en su segmento ("(ES)") o en mayúsculas al final ("… EN") */
const LANGUAGE_ABBREVIATIONS = new Map<string, Lang>(
  LANGUAGES.flatMap(([language, , abbreviations]) => abbreviations.map((a) => [a, language] as [string, Lang])),
);

interface CompiledRule {
  words: string[];
  effect: Effect;
}

/** Las frases largas primero: "caja de sobres de juego" es "caja de sobres" + "de juego" */
const COMPILED: CompiledRule[] = RULES.flatMap(([phrases, effect]) => phrases.map((p) => ({ words: p.split(" "), effect }))).sort(
  (a, b) => b.words.length - a.words.length,
);

/** Categoría de la caja de cajas de cada producto */
const CASE_CATEGORY: Record<string, string> = {
  booster_pack: "booster_case",
  booster_box: "booster_case",
  bundle: "bundle_case",
  limited_aid_tool: "limited_aid_case",
  multiple_decks: "deck_box",
};

/** Subtipos que solo valen si el título los nombra: un "sobre" a secas es de juego o de draft */
const EXPLICIT_ONLY_SUBTYPES = new Set([
  "collector",
  "set",
  "jumpstart",
  "theme",
  "promotional",
  "topper",
  "welcome",
  "premium",
  "prerelease_kit",
  "gift_bundle",
  "other",
  "mtgo_redemption",
  "secret_lair",
]);
/** Preferencia cuando el título no dice el subtipo */
const DEFAULT_SUBTYPES = ["play", "draft", "default"];

/** Palabras sueltas que se traducen para buscarlas en los nombres de MTGJSON */
const KEYWORD_EN: Record<string, string> = {
  negro: "black",
  negra: "black",
  azul: "blue",
  verde: "green",
  rojo: "red",
  roja: "red",
  blanco: "white",
  blanca: "white",
  pesadilla: "nightmare",
  regalo: "gift",
  raton: "mouse",
  nutria: "otter",
  mofeta: "skunk",
  especial: "special",
  noche: "night",
};

const STOPWORDS = new Set(["de", "del", "la", "las", "el", "los", "the", "of", "y", "and", "con", "en", "para", "a", "x", "with", "for", "por", "e", "un", "una"]);
/** Lo que se recorta de los bordes de un tramo ("de Bloomburrow"); "El"/"The" no, empiezan ediciones */
const EDGE_WORDS = new Set(["de", "del", "of", "y", "and", "con", "en", "para", "a", "x", "with", "for", "por", "e"]);
/** Palabras de tipo de producto en los nombres de MTGJSON: no distinguen un producto de otro */
const TYPE_WORDS = new Set([
  "booster",
  "boosters",
  "box",
  "pack",
  "packs",
  "bundle",
  "deck",
  "decks",
  "kit",
  "display",
  "case",
  "play",
  "draft",
  "set",
  "collector",
  "jumpstart",
  "theme",
  "prerelease",
  "starter",
  "commander",
  "welcome",
  "promo",
  "topper",
  "beginner",
  "collection",
  "scene",
  "tin",
]);
/** Unidades tras un número que es la cantidad del producto: "caja de 36 sobres" */
const COUNT_UNITS = new Set(["sobres", "sobre", "boosters", "booster", "packs", "unidades", "uds", "cartas", "cards"]);

/** Nombre inglés de cada tipo de producto, para el trigram */
const TYPE_NAMES: Record<string, string> = {
  booster_pack: "booster pack",
  booster_box: "booster box",
  booster_case: "booster box case",
  bundle: "bundle",
  bundle_case: "bundle case",
  deck: "deck",
  limited_aid_tool: "prerelease pack",
  limited_aid_case: "prerelease pack case",
  multiple_decks: "starter kit",
  box_set: "box",
};
const SUBTYPE_NAMES: Record<string, string> = {
  play: "play",
  draft: "draft",
  set: "set",
  collector: "collector",
  jumpstart: "jumpstart",
  theme: "theme",
  welcome: "welcome",
  gift_bundle: "gift",
  commander: "commander",
  starter_deck: "starter",
};

// ---------------------------------------------------------------------------
// Clasificación
// ---------------------------------------------------------------------------

/** Accesorios, lotes, fichas, otros juegos y servicios: nunca se emparejan */
const OTHER_PHRASES = [
  // accesorios
  "funda",
  "fundas",
  "sleeve",
  "sleeves",
  "carpeta",
  "binder",
  "archivador",
  "album",
  "playmat",
  "playmats",
  "tapete",
  "tapetes",
  "deckbox",
  "deck box",
  "portamazos",
  "caja de mazo",
  "caja para mazo",
  "toploader",
  "toploaders",
  "protectores",
  "dado",
  "dados",
  "dice set",
  "set de dados",
  "contador de vidas",
  "life counter",
  "dragon shield",
  "ultra pro",
  "ultimate guard",
  "gamegenic",
  "separadores",
  "card saver",
  "perfect fit",
  "storage box",
  "caja de almacenaje",
  // fichas y lotes
  "token",
  "tokens",
  "ficha",
  "fichas",
  "lote",
  "lotes",
  "playset",
  // otros juegos
  "pokemon",
  "yu gi oh",
  "yugioh",
  "one piece",
  "lorcana",
  "digimon",
  "dragon ball",
  "flesh and blood",
  "star wars unlimited",
  "weiss schwarz",
  "keyforge",
  "riftbound",
  // servicios
  "torneo",
  "inscripcion",
  "entrada al",
  "entrada para",
  "tarjeta regalo",
  "gift card",
  "cheque regalo",
  "gastos de envio",
];

/** Rareza entre paréntesis o corchetes: solo la llevan las cartas sueltas */
const RARITY = /[([]\s*(?:common|uncommon|rare|mythic(?: rare)?|special|com[uú]n|infrecuente|rara|m[ií]tica|rara m[ií]tica)\s*[)\]]/i;

/** "4x Lightning Bolt", "Lightning Bolt x4", "Lightning Bolt (x4)" */
function isLot(norm: string): boolean {
  const words = norm.split(" ");
  const quantity = (w: string | undefined) => {
    const m = /^(?:x(\d+)|(\d+)x)$/.exec(w ?? "");
    return m ? Number(m[1] ?? m[2]) : 0;
  };
  return quantity(words[0]) > 1 || quantity(words[words.length - 1]) > 1;
}

/**
 * Qué es un título: "single" (carta suelta), "sealed" (producto sellado de Magic) o null
 * (accesorios, lotes, fichas, otros juegos, servicios…: no se emparejan).
 *
 * Una carta suelta se reconoce por el número de coleccionista, el estado o la rareza, aunque su
 * edición tenga palabras de producto ("Shivan Dragon - Welcome Deck 2017 (Rare) [12]").
 */
export function classifyTitle(rawTitle: string): ListingKind | null {
  const text = stripInvisible(rawTitle);
  const norm = normalizeName(text);
  const padded = ` ${norm} `;
  if (isLot(norm) || OTHER_PHRASES.some((p) => padded.includes(` ${p} `))) return null;
  const parsed = parseTitle(text);
  if (parsed.collectorNumber || parsed.condition || RARITY.test(text)) return "single";
  if (parseSealedTitle(text).marker) return "sealed";
  // Palabras de producto que no son sellado de Magic ("Kit …", "Starter…")
  return parsed.nonSingle ? null : "single";
}

// ---------------------------------------------------------------------------
// Lectura del título
// ---------------------------------------------------------------------------

export interface SealedTitle {
  /** alguna frase basta para saber que es sellado (ver classifyTitle) */
  marker: boolean;
  /** categoría de MTGJSON (booster_box, bundle, deck…), o null si el título no la dice */
  category: string | null;
  /** subtipos admitidos; null = el título no lo dice */
  subtypes: string[] | null;
  /** palabras que tiene que llevar el nombre del producto (del vocabulario: "night", "beginner"…) */
  keywords: string[];
  /** tramos de texto sin reconocer, normalizados: la edición y lo que distingue el producto */
  runs: string[][];
  language?: Lang;
  /** el título usa vocabulario de tienda española */
  spanish: boolean;
  isCase: boolean;
  mtgo: boolean;
  secretLair: boolean;
}

interface Tok {
  norm: string;
  upper: boolean;
  seg: number;
  used: boolean;
  locked: boolean;
}

/** Paréntesis, corchetes, "|", viñetas, "+" y guiones con espacios */
const SEGMENT_SPLIT = /[()[\]{}|·•+]|\s[-‐‑–—]+\s|\s[-‐‑–—]+$|^[-‐‑–—]+\s/;

function tokenize(rawTitle: string): Tok[] {
  const out: Tok[] = [];
  stripInvisible(rawTitle)
    .split(SEGMENT_SPLIT)
    .forEach((segment, seg) => {
      for (const word of segment.split(/\s+/)) {
        const upper = word === word.toUpperCase() && word !== word.toLowerCase();
        for (const norm of normalizeName(word).split(" ")) {
          if (norm) out.push({ norm, upper, seg, used: false, locked: false });
        }
      }
    });
  return out;
}

function ruleMatches(tokens: Tok[], i: number, rule: CompiledRule): boolean {
  const { words, effect } = rule;
  if (i + words.length > tokens.length) return false;
  for (let k = 0; k < words.length; k++) {
    const t = tokens[i + k]!;
    if (t.used || t.locked || t.norm !== words[k] || t.seg !== tokens[i]!.seg) return false;
  }
  const next = tokens[i + words.length];
  const nextNorm = next && next.seg === tokens[i]!.seg ? next.norm : undefined;
  if (effect.notBefore && nextNorm && effect.notBefore.includes(nextNorm)) return false;
  if (effect.notBeforeNumber && nextNorm && /^\d+$/.test(nextNorm)) return false;
  if (effect.atStart) {
    for (let k = i - 1; k >= 0 && tokens[k]!.seg === tokens[i]!.seg; k--) if (!tokens[k]!.used) return false;
  }
  return true;
}

export function parseSealedTitle(rawTitle: string): SealedTitle {
  const tokens = tokenize(rawTitle);
  const keywords: string[] = [];
  let marker = false;
  let spanish = false;
  let box = false;
  let pack = false;
  let booster: string | undefined;
  let category: string | undefined;
  let subtypes: string[] | undefined;
  let language: Lang | undefined;
  let isCase = false;
  let mtgo = false;
  let secretLair = false;

  for (const rule of COMPILED) {
    for (let i = 0; i < tokens.length; i++) {
      if (!ruleMatches(tokens, i, rule)) continue;
      const e = rule.effect;
      for (let k = 0; k < rule.words.length; k++) {
        if (e.lock) tokens[i + k]!.locked = true;
        else tokens[i + k]!.used = true;
      }
      marker ||= !!e.marker;
      spanish ||= !!e.es;
      box ||= !!e.box;
      pack ||= !!e.pack;
      booster ??= e.booster;
      if (e.category && !category) {
        category = e.category;
        subtypes = e.subtypes;
      }
      keywords.push(...(e.keywords ?? []));
      language ??= e.language;
      isCase ||= !!e.isCase;
      mtgo ||= !!e.mtgo;
      secretLair ||= !!e.secretLair;
    }
  }

  // Abreviaturas de idioma y cantidades ("caja de 36 sobres")
  tokens.forEach((t, i) => {
    if (t.used || t.locked) return;
    const sameSeg = (j: number) => tokens[j]?.seg === t.seg;
    const abbreviation = LANGUAGE_ABBREVIATIONS.get(t.norm);
    const alone = !sameSeg(i - 1) && !sameSeg(i + 1);
    if (abbreviation && (alone || (t.upper && !sameSeg(i + 1)))) {
      t.used = true;
      language ??= abbreviation;
    } else if (/^x?\d+$/.test(t.norm) && sameSeg(i + 1) && COUNT_UNITS.has(tokens[i + 1]!.norm)) {
      t.used = true;
    } else if (/^x\d+$/.test(t.norm)) {
      t.used = true; // "Caja x36"
    }
  });

  // Tramos: palabras seguidas sin usar del mismo segmento, sin conectores en los bordes
  const runs: string[][] = [];
  let current: string[] = [];
  let seg = -1;
  const flush = () => {
    while (current.length && EDGE_WORDS.has(current[0]!)) current.shift();
    while (current.length && EDGE_WORDS.has(current[current.length - 1]!)) current.pop();
    if (current.length) runs.push(current);
    current = [];
  };
  for (const t of tokens) {
    if (t.used || t.seg !== seg) flush();
    seg = t.seg;
    if (!t.used) current.push(t.norm);
  }
  flush();

  const resolved = category ?? (box ? "booster_box" : pack || booster ? "booster_pack" : null);
  const resolvedSubtypes = category ? (subtypes ?? null) : resolved && booster ? [booster] : null;
  return {
    marker,
    category: resolved && isCase ? (CASE_CATEGORY[resolved] ?? resolved) : resolved,
    subtypes: resolvedSubtypes,
    keywords,
    runs,
    language,
    spanish,
    isCase,
    mtgo,
    secretLair,
  };
}

// ---------------------------------------------------------------------------
// Emparejamiento
// ---------------------------------------------------------------------------

/** Producto identificado por edición y tipo; menos si hay que elegir por descarte */
export const SEALED_EXACT_CONFIDENCE = 0.95;
export const SEALED_DEFAULT_CONFIDENCE = 0.9;
export const SEALED_TIEBREAK_CONFIDENCE = 0.85;
/** Lo que se resta cuando la edición sale de los nombres de producto y no de resolveSet */
export const SEALED_DISCOVERED_PENALTY = 0.05;

/** Trigram sobre el nombre en inglés: mismo esquema que en las cartas (umbral y margen) */
export const SEALED_TRIGRAM_ACCEPT = 0.6;
export const SEALED_TRIGRAM_MARGIN = 0.1;
export const SEALED_TRIGRAM_MIN_SIMILARITY = 0.4;
export const SEALED_TRIGRAM_LIMIT = 20;
export const SEALED_TRIGRAM_MIN_CONFIDENCE = 0.6;
export const SEALED_TRIGRAM_MAX_CONFIDENCE = 0.85;

/** Para descubrir la edición por los nombres de producto ("Duskmourn" → dsk) */
const DISCOVERY_MIN_SIMILARITY = 0.2;
const DISCOVERY_LIMIT = 50;
/** Tramos más largos no se trocean (cada trozo es una consulta a resolveSet) */
const MAX_RUN_LENGTH = 10;

interface Span {
  run: number;
  start: number;
  words: string[];
}

interface FoundSet {
  code: string;
  /** tramo del título que es la edición; null si salió del setHint del adaptador */
  span: Span | null;
  discovered: boolean;
}

const nameTokensCache = new WeakMap<SealedCandidate, Set<string>>();
function nameTokens(c: SealedCandidate): Set<string> {
  let tokens = nameTokensCache.get(c);
  if (!tokens) {
    tokens = new Set(normalizeName(c.name).split(" "));
    nameTokensCache.set(c, tokens);
  }
  return tokens;
}

const isNumber = (w: string) => /^\d+$/.test(w);
const significant = (w: string) => w.length >= 4 && !STOPWORDS.has(w) && !TYPE_WORDS.has(w) && !isNumber(w);

/**
 * Empareja un título de producto sellado con el catálogo de MTGJSON:
 *   1. edición: setHint del adaptador o un tramo del título (catalog.resolveSet acepta código y
 *      nombres en inglés, español y de Cardmarket); si no, se busca en los nombres de producto;
 *   2. productos de esa edición de la categoría/subtipo del título; si queda más de uno, se
 *      eligen por las palabras que distinguen el producto, el subtipo por defecto (de juego, de
 *      draft, normal) y, por último, el nombre con menos palabras de más;
 *   3. si no, trigram sobre el nombre en inglés, con umbral y margen.
 *
 * Método: no hay uno propio para el sellado; un producto identificado por edición y tipo cuenta
 * como nombre exacto, "exact_es" si el título usa vocabulario de tienda española y "exact_en" si
 * no. El trigram es "trigram". Nunca empareja cajas de cajas, canjes de MTGO ni Secret Lair si el
 * título no los nombra.
 */
export async function matchSealed(
  rawTitle: string,
  setHint: string | undefined,
  catalog: CatalogLookup,
): Promise<SealedMatchResult | null> {
  const title = parseSealedTitle(rawTitle);
  const set = await findSet(title, setHint, catalog);
  if (set && title.category) {
    const picked = await pickInSet(title, set, catalog);
    if (picked) {
      const penalty = set.discovered ? SEALED_DISCOVERED_PENALTY : 0;
      return {
        kind: "sealed",
        sealedProductId: picked.candidate.sealedProductId,
        confidence: round(picked.confidence - penalty),
        method: title.spanish ? "exact_es" : "exact_en",
      };
    }
  }
  return sealedTrigram(title, set, catalog);
}

/** Trozos de los tramos que pueden ser la edición: primero los tramos enteros, luego más cortos */
function candidateSpans(runs: string[][]): Span[] {
  const spans: Span[] = [];
  runs.forEach((words, run) => {
    const n = Math.min(words.length, MAX_RUN_LENGTH);
    for (let len = n; len >= 1; len--) {
      for (let start = 0; start + len <= n; start++) {
        const part = words.slice(start, start + len);
        if (part.every((w) => STOPWORDS.has(w) || isNumber(w))) continue;
        if (part.length === 1 && (TYPE_WORDS.has(part[0]!) || part[0]!.length < 3)) continue;
        spans.push({ run, start, words: part });
      }
    }
  });
  return spans.sort((a, b) => b.words.length - a.words.length);
}

async function findSet(title: SealedTitle, setHint: string | undefined, catalog: CatalogLookup): Promise<FoundSet | null> {
  const hinted = await resolveSetCode([setHint], catalog);
  const spans = candidateSpans(title.runs);
  // Los mazos Commander van en su propia edición: "Mazo Commander Bloomburrow" → "Bloomburrow Commander"
  const suffixes = title.category === "deck" && title.subtypes?.includes("commander") ? [" commander", ""] : [""];
  for (const suffix of suffixes) {
    for (const span of spans) {
      const code = await catalog.resolveSet(span.words.join(" ") + suffix);
      if (code && (!hinted || code === hinted)) return { code, span, discovered: false };
    }
  }
  if (hinted) return { code: hinted, span: null, discovered: false };
  return discoverSet(title, spans, catalog);
}

/**
 * La edición escrita de forma abreviada ("Duskmourn", "Lord of the Rings"): el tramo más largo
 * cuyas palabras están todas en nombres de producto de una sola edición.
 */
async function discoverSet(title: SealedTitle, spans: Span[], catalog: CatalogLookup): Promise<FoundSet | null> {
  if (!spans.some((s) => s.words.some(significant))) return null;
  const query = [...title.runs.flat(), ...typeName(title)].join(" ");
  const rows = await catalog.findSealedByTrigram(query, DISCOVERY_MIN_SIMILARITY, DISCOVERY_LIMIT);
  // Cada tramo que solo sale en una edición la señala; tienen que señalar todos la misma
  const found = new Set<string>();
  for (const span of spans) {
    if (!span.words.some(significant)) continue;
    const codes = new Set(
      rows.filter((r) => span.words.every((w) => STOPWORDS.has(w) || nameTokens(r).has(w))).map((r) => r.setCode),
    );
    if (codes.size === 1) found.add([...codes][0]!);
  }
  // Sin tramo: lo que no es la edición se separa luego por las palabras comunes de sus productos
  return found.size === 1 ? { code: [...found][0]!, span: null, discovered: true } : null;
}

/** Palabras del título que no son la edición, traducidas, más las del vocabulario */
function titleKeywords(title: SealedTitle, span: Span | null, common: Set<string>): string[] {
  const words = title.runs.flatMap((run, r) =>
    run.filter((_, i) => !span || span.run !== r || i < span.start || i >= span.start + span.words.length),
  );
  const out = words
    .filter((w) => !STOPWORDS.has(w) && !TYPE_WORDS.has(w) && !isNumber(w))
    .map((w) => KEYWORD_EN[w] ?? w)
    .filter((w) => !common.has(w));
  return [...new Set([...out, ...title.keywords])];
}

/** Palabras que salen en al menos la mitad de los productos de la edición: el nombre de la edición */
function commonTokens(products: SealedCandidate[]): Set<string> {
  const counts = new Map<string, number>();
  for (const p of products) for (const w of nameTokens(p)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n * 2 >= products.length).map(([w]) => w));
}

function allowed(c: SealedCandidate, title: SealedTitle): boolean {
  const isCaseProduct = !!c.category?.endsWith("_case") || c.category === "deck_box" || nameTokens(c).has("case");
  if (isCaseProduct !== title.isCase) return false;
  if (c.subtype === "mtgo_redemption" && !title.mtgo) return false;
  if (c.subtype === "secret_lair" && !title.secretLair) return false;
  return c.category !== "subset"; // "Set of 3": lotes del propio MTGJSON
}

function fitsType(c: SealedCandidate, title: SealedTitle): boolean {
  if (title.category && c.category !== title.category) return false;
  return !title.subtypes || title.subtypes.includes(c.subtype ?? "");
}

async function pickInSet(
  title: SealedTitle,
  set: FoundSet,
  catalog: CatalogLookup,
): Promise<{ candidate: SealedCandidate; confidence: number } | null> {
  const subtype = title.subtypes?.length === 1 ? title.subtypes[0] : undefined;
  let pool = (await catalog.findSealedProducts(set.code, { category: title.category ?? undefined, subtype })).filter(
    (c) => fitsType(c, title) && allowed(c, title),
  );
  if (pool.length === 0) return null;

  // Hace falta el nombre de la edición tal como sale en los productos para separar lo demás
  const extra = title.runs.flat().length > (set.span?.words.length ?? 0) || title.keywords.length > 0;
  const all = extra || pool.length > 1 ? await catalog.findSealedProducts(set.code) : pool;
  const common = commonTokens(all);
  const keywords = titleKeywords(title, set.span, common);
  if (keywords.length) pool = pool.filter((c) => keywords.every((k) => nameTokens(c).has(k)));

  let confidence = SEALED_EXACT_CONFIDENCE;
  if (!title.subtypes && keywords.length === 0) {
    const plain = pool.filter((c) => !EXPLICIT_ONLY_SUBTYPES.has(c.subtype ?? ""));
    if (plain.length < pool.length) {
      pool = plain;
      confidence = SEALED_DEFAULT_CONFIDENCE;
    }
  }
  if (pool.length > 1 && !title.subtypes) {
    const preferred = DEFAULT_SUBTYPES.map((s) => pool.filter((c) => c.subtype === s)).find((list) => list.length > 0);
    if (preferred && preferred.length < pool.length) {
      pool = preferred;
      confidence = SEALED_DEFAULT_CONFIDENCE;
    }
  }
  if (pool.length > 1) {
    // "Collector Booster Pack" antes que "Special Edition Collector Booster Pack"
    const surplus = (c: SealedCandidate) =>
      [...nameTokens(c)].filter((w) => !common.has(w) && !TYPE_WORDS.has(w) && !keywords.includes(w) && !isNumber(w)).length;
    const scored = pool.map((c) => [c, surplus(c)] as const).sort((a, b) => a[1] - b[1]);
    if (scored[0]![1] < scored[1]![1]) {
      pool = [scored[0]![0]];
      confidence = SEALED_TIEBREAK_CONFIDENCE;
    }
  }
  return pool.length === 1 ? { candidate: pool[0]!, confidence } : null;
}

function typeName(title: SealedTitle): string[] {
  const words: string[] = [];
  const subtype = title.subtypes?.length === 1 ? SUBTYPE_NAMES[title.subtypes[0]!] : undefined;
  if (subtype) words.push(subtype);
  if (title.category) words.push(...(TYPE_NAMES[title.category] ?? "").split(" ").filter(Boolean));
  return words;
}

/** Sin edición, el trigram solo vale si alguna palabra del título (con erratas) está en el nombre */
const WORD_SIMILARITY = 0.5;
function resembles(word: string, tokens: Set<string>): boolean {
  for (const t of tokens) if (t === word || trigramSimilarity(word, t) >= WORD_SIMILARITY) return true;
  return false;
}

/** Último recurso: el nombre en inglés contra los nombres de MTGJSON, sin salirse del tipo ni de la edición */
async function sealedTrigram(title: SealedTitle, set: FoundSet | null, catalog: CatalogLookup): Promise<SealedMatchResult | null> {
  const words = title.runs.flat().map((w) => KEYWORD_EN[w] ?? w);
  const name = [...words, ...title.keywords, ...typeName(title)].join(" ");
  if (name.replace(/ /g, "").length < 3) return null;
  const important = words.filter(significant);
  // Sin tipo de producto, un título que es solo la edición ("Bloomburrow") no dice qué producto es
  if (!title.category && important.length < 2) return null;
  const rows = (await catalog.findSealedByTrigram(name, SEALED_TRIGRAM_MIN_SIMILARITY, SEALED_TRIGRAM_LIMIT)).filter(
    (r) =>
      allowed(r, title) &&
      fitsType(r, title) &&
      title.keywords.every((k) => nameTokens(r).has(k)) &&
      (set ? r.setCode === set.code : important.some((w) => resembles(w, nameTokens(r)))),
  );
  const [first, second] = rows.sort((a, b) => b.similarity - a.similarity);
  if (!first || first.similarity < SEALED_TRIGRAM_ACCEPT) return null;
  if (second && first.similarity - second.similarity < SEALED_TRIGRAM_MARGIN) return null;
  const t = (Math.min(first.similarity, 1) - SEALED_TRIGRAM_ACCEPT) / (1 - SEALED_TRIGRAM_ACCEPT);
  return {
    kind: "sealed",
    sealedProductId: first.sealedProductId,
    confidence: round(SEALED_TRIGRAM_MIN_CONFIDENCE + t * (SEALED_TRIGRAM_MAX_CONFIDENCE - SEALED_TRIGRAM_MIN_CONFIDENCE)),
    method: "trigram",
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
