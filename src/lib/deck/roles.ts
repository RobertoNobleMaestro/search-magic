import type { Color, DeckCard } from "./types";

/**
 * Qué papel cumple cada carta en un mazo de Commander y cuánto aporta, a partir de su texto de
 * reglas (Scryfall, en inglés). Son reglas sencillas y explicables: cada punto de la nota lleva
 * su motivo, para que el usuario vea por qué se propone un cambio y pueda llevar la contraria.
 *
 * La nota está pensada para mazos de "hechizos que no son criatura" como el de los 4 Fantásticos:
 * premia lo que activa ese plan (Rebote, copias, legendarias) y castiga lo caro, lo que rompe la
 * propia mesa y lo que regala cartas a los rivales.
 */

export type Role =
  | "land"
  | "ramp"
  | "draw"
  | "removal"
  | "wipe"
  | "counter"
  | "protection"
  | "tutor"
  | "threat"
  | "synergy"
  | "other";

export const ROLE_LABEL: Record<Role, string> = {
  land: "tierra",
  ramp: "rampa",
  draw: "robo",
  removal: "eliminación",
  wipe: "barrido",
  counter: "contrahechizo",
  protection: "protección",
  tutor: "tutor",
  threat: "criatura",
  synergy: "sinergia",
  other: "otra",
};

/** Orden de prioridad del papel principal (el primero que cumple manda) */
const ROLE_PRIORITY: Role[] = ["land", "wipe", "counter", "removal", "ramp", "draw", "tutor", "protection", "threat", "synergy", "other"];

export interface ScorePart {
  points: number;
  reason: string;
}

export interface CardEvaluation {
  roles: Role[];
  role: Role;
  score: number;
  parts: ScorePart[];
  /** colores que da una tierra (para el reparto de básicas) */
  landColors: Color[];
  isBasicLand: boolean;
}

const BASE_SCORE = 50;

/**
 * Recompensa por lanzar TÚ hechizos que no son criatura. No cuentan "Counter target noncreature
 * spell" ni "Whenever an opponent casts their first noncreature spell".
 */
const NONCREATURE_PAYOFF =
  /(?:whenever you cast|when you cast|if you've cast|you cast your \w+|whenever a player casts) (?:a |an |your )?(?:\w+ )?noncreature spells?|noncreature spells you cast/i;

/** Tipo de la cara frontal ("Enchantment — Saga // Enchantment Creature" → la saga) */
function frontType(card: DeckCard): string {
  return card.typeLine.split(" // ")[0] ?? card.typeLine;
}

function has(text: string, re: RegExp): boolean {
  return re.test(text);
}

const BASIC_TYPES: Array<[RegExp, Color]> = [
  [/\bplains\b/i, "W"],
  [/\bisland\b/i, "U"],
  [/\bswamp\b/i, "B"],
  [/\bmountain\b/i, "R"],
  [/\bforest\b/i, "G"],
];

/** Colores que puede dar una tierra: por sus tipos básicos o por su texto ("Add {R} or {W}") */
function landColors(card: DeckCard, identity: Color[]): Color[] {
  const text = card.oracleText;
  if (/any color|any combination of colors/i.test(text) && !/that a land an opponent controls/i.test(text)) return identity;
  const out = new Set<Color>();
  for (const [re, color] of BASIC_TYPES) if (re.test(frontType(card))) out.add(color);
  for (const m of text.matchAll(/\{([WUBRG])\}/g)) out.add(m[1] as Color);
  // las fetch dan los colores de lo que buscan
  const fetch = /search your library for an? ([a-z]+) or ([a-z]+) card/i.exec(text);
  if (fetch) for (const [re, color] of BASIC_TYPES) if (re.test(fetch[1]!) || re.test(fetch[2]!)) out.add(color);
  if (/that a land an opponent controls/i.test(text)) for (const c of identity) out.add(c);
  return [...out].filter((c) => identity.length === 0 || identity.includes(c));
}

function coloredPips(manaCost: string): number {
  return (manaCost.match(/\{[WUBRG](?:\/[WUBRGP])?\}/g) ?? []).length;
}

/** Papeles que cumple una carta (puede tener varios) */
export function cardRoles(card: DeckCard): Role[] {
  const type = frontType(card);
  const t = card.oracleText;
  const roles = new Set<Role>();

  if (/\bLand\b/.test(type)) return ["land"];

  // Rampa: maná, buscar tierras al campo, tesoros, abaratar hechizos
  if (
    has(t, /\{T\}(?:, [^:]*)?: Add\b/i) ||
    has(t, /\{T\}: [^.]*\badd (?:one|x|that|\{)/i) ||
    has(t, /search your library for (?:up to (?:one|two) )?(?:a |an )?(?:basic land|land|plains|island|swamp|mountain|forest)[^.]*battlefield/i) ||
    has(t, /create (?:a|one|two|\w+) treasure/i) ||
    has(t, /add (?:two|three|four|x) mana/i) ||
    has(t, /spells you cast cost \{\d\} less/i)
  ) {
    roles.add("ramp");
  }

  // Robo: robar, mirar y quedarse cartas, jugar del exilio
  if (
    has(t, /\bdraws? (?:a|one|two|three|four|x|that many) cards?\b/i) ||
    has(t, /\bdraw cards equal\b/i) ||
    has(t, /\bdraw x cards\b/i) ||
    has(t, /into your hand/i) ||
    has(t, /exile the top [^.]*\. (?:until end of turn, )?you may (?:play|cast)/i) ||
    has(t, /you may play (?:the exiled card|that card) this turn/i) ||
    has(t, /\bexplores\b/i)
  ) {
    roles.add("draw");
  }

  // Barridos
  if (
    has(t, /destroy all (?:creatures|nonland permanents|artifacts|permanents)/i) ||
    has(t, /exile all (?:creatures|nonland permanents|permanents)/i) ||
    has(t, /sacrifices? (?:the rest|all other)/i) ||
    has(t, /damage equal to its power to each other creature/i) ||
    has(t, /deals \d+ damage to each creature/i)
  ) {
    roles.add("wipe");
  }

  if (has(t, /counter target (?:\w+ )?spell/i)) roles.add("counter");

  // Eliminación puntual (no el cementerio rival)
  if (
    has(t, /(?:destroy|exile) target (?:\w+ )*?(?:creature|permanent|artifact|enchantment|planeswalker)/i) ||
    has(t, /deals (?:x|\d+|damage equal to its power) damage to target (?:creature|planeswalker)/i) ||
    has(t, /damage equal to its power to target creature/i) ||
    has(t, /return target nonland permanent to its owner's hand/i)
  ) {
    roles.add("removal");
  }

  // Protección para lo propio (no la que una criatura tiene para sí misma)
  if (
    has(t, /(?:gains?|have|has) (?:\w+ (?:and )?){0,3}(?:indestructible|hexproof|shroud)/i) ||
    has(t, /\bphase out\b/i) ||
    has(t, /\bward \{/i) ||
    has(t, /spells you control can't be countered/i)
  ) {
    roles.add("protection");
  }

  // Tutores: buscar una carta que no sea tierra
  if (has(t, /search your library for (?:a|an|up to \w+) (?!basic land|land|plains|island|swamp|mountain|forest)[^.]*card/i)) {
    roles.add("tutor");
  }

  if (/\bCreature\b/.test(type)) roles.add("threat");
  if (has(t, NONCREATURE_PAYOFF) || card.keywords.includes("Rebound") || has(t, /\bcopy (?:target|that|it|them)\b/i)) {
    roles.add("synergy");
  }
  if (roles.size === 0) roles.add("other");
  return ROLE_PRIORITY.filter((r) => roles.has(r));
}

/** Nota de una carta para este mazo, con los motivos */
export function evaluateCard(card: DeckCard, identity: Color[]): CardEvaluation {
  const roles = cardRoles(card);
  const role = roles[0] ?? "other";
  const parts: ScorePart[] = [];
  const add = (points: number, reason: string) => parts.push({ points, reason });
  const t = card.oracleText;
  const type = frontType(card);
  const isBasicLand = /\bBasic Land\b/.test(type);
  const colors = role === "land" ? landColors(card, identity) : [];

  if (role === "land") {
    if (/any color|any combination of colors|that a land an opponent controls/i.test(t)) add(8, "da maná de cualquier color");
    else if (colors.length >= 3) add(8, `da ${colors.length} colores`);
    else if (colors.length === 2) add(4, "da 2 colores");
    else if (colors.length === 0 && !/search your library/i.test(t)) add(-6, "solo da maná incoloro");

    if (/pay 1 life, sacrifice this land: search your library/i.test(t)) add(6, "fetch: busca una tierra con tipos y entra enderezada");
    else if (/sacrifice this land: search your library for a basic land card, put it onto the battlefield tapped/i.test(t)) {
      if (/untap that land/i.test(t)) add(1, "busca una básica y con 4 tierras la endereza");
      else add(-4, "lenta: busca una básica que entra girada");
    }

    if (/you may pay 2 life\. if you don't, it enters tapped/i.test(t)) add(4, "entra enderezada pagando 2 vidas");
    else if (/enters tapped unless you have two or more opponents/i.test(t)) add(0, "en Commander entra enderezada");
    else if (/enters tapped unless/i.test(t)) add(-3, "a veces entra girada");
    else if (/enters tapped/i.test(t)) add(-8, "entra girada");

    if (/\bcycling\b/i.test(t)) add(2, "ciclo");
    if (/\bhideaway\b|\bscry\b|draw a card/i.test(t) && !isBasicLand) add(3, "habilidad extra");
    if (!isBasicLand && BASIC_TYPES.some(([re]) => re.test(type))) add(1, "tiene tipos básicos: la encuentran Farseek, Three Visits o las fetch");
  } else {
    const noncreature = !/\bCreature\b/.test(type);
    if (noncreature) add(6, "activa el plan: es un hechizo que no es criatura");
    if (/at the beginning of combat on your turn, if you've cast a noncreature spell/i.test(t)) {
      add(12, "dispara al comienzo del combate si lanzaste un hechizo que no es criatura");
    } else if (NONCREATURE_PAYOFF.test(t)) {
      add(10, "recompensa lanzar hechizos que no son criatura");
    }
    if (card.keywords.includes("Rebound") || /\brebound\b/i.test(t)) add(6, "Rebote: se vuelve a lanzar gratis");
    if (/\bcopy (?:target|that|it|them)\b|copies of|a copy of/i.test(t)) add(4, "copia hechizos, habilidades o criaturas");
    if (/\bLegendary\b/.test(type) && /\bCreature\b/.test(type)) add(4, "criatura legendaria: Annie Joins Up duplica sus disparos");
    if (/\bcascade\b|\bdiscover \d|without paying (?:its|their) mana costs?/i.test(t)) add(4, "lanza hechizos gratis");

    if (roles.includes("ramp")) add(card.cmc <= 2 ? 10 : 6, card.cmc <= 2 ? "rampa barata" : "rampa");
    if (roles.includes("draw")) add(6, "da cartas");
    if (roles.includes("removal")) add(card.cmc <= 2 ? 10 : 6, card.cmc <= 2 ? "eliminación barata" : "elimina una amenaza");
    if (roles.includes("counter")) add(5, "contrarresta");
    if (roles.includes("protection")) add(4, "protege tu mesa");
    if (roles.includes("tutor")) add(4, "busca una carta concreta");

    if (roles.includes("wipe") && !/(?:you don't control|your opponents control|an opponent controls)/i.test(t)) {
      add(-12, "barrido que también rompe tu mesa");
    }
    if (card.cmc >= 6) add(-(card.cmc - 5) * 5, `cara: ${card.cmc} de maná`);
    else if (card.cmc === 5) add(-2, "5 de maná");
    const pips = coloredPips(card.manaCost);
    if (pips >= 5) add(-6, `difícil de pagar: ${pips} símbolos de color`);
    if (/each opponent draws|that player may draw|two target players each draw/i.test(t)) add(-6, "también da cartas a los rivales");
    if (/flip a coin/i.test(t)) add(-6, "depende de lanzar una moneda");
    if (/from an opponent's graveyard/i.test(t) && roles.every((r) => r === "other" || r === "draw")) {
      add(-6, "solo afecta al cementerio rival");
    }
    if (/as an additional cost to cast this spell, sacrifice a legendary creature/i.test(t)) {
      add(-8, "obliga a sacrificar una criatura legendaria");
    }
  }

  const score = BASE_SCORE + parts.reduce((sum, p) => sum + p.points, 0);
  return { roles, role, score, parts, landColors: colors, isBasicLand };
}

/** Los dos o tres motivos con más peso, para explicar una nota en una línea */
export function topReasons(evaluation: CardEvaluation, count = 3, sign: "pros" | "cons" | "all" = "all"): string[] {
  return evaluation.parts
    .filter((p) => (sign === "pros" ? p.points > 0 : sign === "cons" ? p.points < 0 : p.points !== 0))
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, count)
    .map((p) => p.reason);
}
