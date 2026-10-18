import type { AnyMatchResult, CatalogLookup, ListingKind, MatchMethod, MatchResult, NormalizedListing } from "@/lib/data/types";
import { normalizeName } from "@/lib/normalize";
import { choosePrinting, type PrintingChoice, type PrintingHints } from "./printing";
import { classifyTitle, matchSealed, parseSealedTitle } from "./sealed";
import { parseTitle, resolveSetCode, type ParsedTitle } from "./title";

export { choosePrinting, type PrintingChoice, type PrintingHints } from "./printing";
export {
  SEALED_DEFAULT_CONFIDENCE,
  SEALED_DISCOVERED_PENALTY,
  SEALED_EXACT_CONFIDENCE,
  SEALED_TIEBREAK_CONFIDENCE,
  SEALED_TRIGRAM_ACCEPT,
  SEALED_TRIGRAM_MARGIN,
  SEALED_TRIGRAM_MAX_CONFIDENCE,
  SEALED_TRIGRAM_MIN_CONFIDENCE,
  classifyTitle,
  parseSealedTitle,
  type SealedTitle,
} from "./sealed";
export { parseTitle, stripInvisible, type ParsedTitle, type PrintingTag } from "./title";

/** Confianza de un nombre exacto, en inglés y en español */
export const EXACT_EN_CONFIDENCE = 1;
export const EXACT_ES_CONFIDENCE = 0.98;
/** Nombre exacto de varias cartas a la vez que la edición del título deja en una sola */
export const AMBIGUOUS_NAME_CONFIDENCE = 0.9;
/** idProduct de Cardmarket (CSV de stock): identifica la impresión o el producto sin dudas */
export const CARDMARKET_ID_CONFIDENCE = 1;

/**
 * Trigram: se acepta el mejor candidato si llega a TRIGRAM_ACCEPT y le saca al segundo al menos
 * TRIGRAM_MARGIN. Medido con la muestra de Scryfall: las erratas corrientes quedan por encima
 * ("Lightnin Bolt" 0,81, "Counterspel" 0,79, "Relampgo" 0,58) y las cartas de nombre parecido
 * por debajo ("Lightning Axe" 0,53, "Lightning Helix" 0,48, "Serra Avenger" 0,44). Las letras
 * cambiadas de sitio caen en esa misma franja ("Thoughtsieze" 0,53) y se quedan para revisión manual.
 */
export const TRIGRAM_ACCEPT = 0.55;
export const TRIGRAM_MARGIN = 0.1;
/** Umbral que se pide a findByTrigram (TRIGRAM_ACCEPT - TRIGRAM_MARGIN): lo justo para ver al segundo */
export const TRIGRAM_MIN_SIMILARITY = 0.45;
export const TRIGRAM_LIMIT = 10;
/** La confianza de un trigram va de 0,6 (similitud TRIGRAM_ACCEPT) a 0,9 (similitud 1) */
export const TRIGRAM_MIN_CONFIDENCE = 0.6;
export const TRIGRAM_MAX_CONFIDENCE = 0.9;

/** Lo que se resta a la confianza cuando la impresión se elige por descarte o queda sin identificar */
export const PRINTING_GUESSED_PENALTY = 0.02;
export const PRINTING_UNRESOLVED_PENALTY = 0.05;

type CardMatch = Pick<MatchResult, "oracleId" | "confidence" | "method">;

/**
 * Empareja un listado de tienda con una carta suelta (Scryfall) o un producto sellado (MTGJSON).
 * Devuelve null si no hay coincidencia con confianza suficiente (queda "sin emparejar").
 *
 *   1. idProduct de Cardmarket (CSV de stock): impresión o producto exactos; si el id no está en
 *      el catálogo, null (en el CSV no se hace heurística).
 *   2. Corrección manual (antes de clasificar, para rescatar una carta que parece un producto:
 *      "Booster Tutor").
 *   3. Tipo: el kind del adaptador o, si no lo trae, classifyTitle. Accesorios, lotes, fichas,
 *      otros juegos y servicios dan null.
 *   4. Sellado: ver matchSealed. Cartas sueltas: nombre exacto en inglés → en español → trigram;
 *      después la impresión: edición (setHint o título) y número, variantes y acabado.
 */
export async function matchListing(listing: NormalizedListing, catalog: CatalogLookup): Promise<AnyMatchResult | null> {
  if (listing.cardmarketId != null) return matchCardmarketId(listing.cardmarketId, listing.kind, catalog);

  const parsed = parseTitle(listing.rawTitle);
  const override = await catalog.getOverride(listing.storeId, titleKey(parsed, listing.rawTitle));
  if (override?.kind === "sealed") return { ...override }; // copia: la BD lo guarda en su caché
  if (override?.scryfallId) return { ...override };

  if (!override) {
    const guessed = classifyTitle(listing.rawTitle);
    // Lo que no es Magic (accesorios, lotes…) no se empareja aunque el adaptador diga otra cosa
    if (guessed === null) return null;
    const kind: ListingKind = listing.kind ?? guessed;
    if (kind === "sealed") return matchSealed(listing.rawTitle, listing.setHint, catalog);
  }
  return matchSingle(listing, parsed, override, catalog);
}

/**
 * Completa estado, idioma, acabado, edición y tipo a partir del título cuando el adaptador no
 * los ha podido sacar de campos estructurados. Nunca pisa lo que ya viene relleno.
 *
 * El tipo solo se rellena cuando el título lo deja claro: "sealed" si nombra un producto
 * sellado y "single" si trae número de coleccionista, estado o acabado.
 */
export function enrichListing(listing: NormalizedListing): NormalizedListing {
  const parsed = parseTitle(listing.rawTitle);
  const kind = classifyTitle(listing.rawTitle);
  const out: NormalizedListing = { ...listing };
  if (kind === "sealed") {
    // En el sellado la edición la busca el emparejador: los segmentos del título no son ediciones
    if (!out.language) {
      const language = parsed.language ?? parseSealedTitle(listing.rawTitle).language;
      if (language) out.language = language;
    }
    out.kind ??= "sealed";
    return out;
  }
  if (!out.condition && parsed.condition) out.condition = parsed.condition;
  if (!out.language && parsed.language) out.language = parsed.language;
  if (!out.finish && parsed.finish) out.finish = parsed.finish;
  if (!out.setHint && parsed.setHints[0]) out.setHint = parsed.setHints[0];
  if (!out.kind && kind === "single" && (parsed.collectorNumber || parsed.condition || parsed.finish)) out.kind = "single";
  return out;
}

/**
 * Limpia un título de tienda (estado, idioma, foil, edición, ruido…) y lo normaliza con normalizeName.
 * Es la clave de las correcciones manuales (match_overrides.title_norm).
 *
 * Solo queda el nombre: "Lightning Bolt (M11) NM" y "Lightning Bolt [2XM] Foil" dan los dos
 * "lightning bolt", así que una corrección vale para todas las ediciones de ese nombre en la tienda.
 */
export function normalizeTitle(rawTitle: string): string {
  return titleKey(parseTitle(rawTitle), rawTitle);
}

// ---------------------------------------------------------------------------
// Cardmarket
// ---------------------------------------------------------------------------

async function matchCardmarketId(
  cardmarketId: number,
  kind: ListingKind | undefined,
  catalog: CatalogLookup,
): Promise<AnyMatchResult | null> {
  // Los idProduct no se repiten entre cartas y sellado: el kind solo decide qué se mira primero
  const lookups = kind === "sealed" ? [sealedById, printingById] : [printingById, sealedById];
  for (const lookup of lookups) {
    const match = await lookup(cardmarketId, catalog);
    if (match) return match;
  }
  return null;
}

async function printingById(cardmarketId: number, catalog: CatalogLookup): Promise<MatchResult | null> {
  const hit = await catalog.findPrintingByCardmarketId(cardmarketId);
  return hit
    ? { kind: "single", oracleId: hit.oracleId, scryfallId: hit.scryfallId, confidence: CARDMARKET_ID_CONFIDENCE, method: "cardmarket_id" }
    : null;
}

async function sealedById(cardmarketId: number, catalog: CatalogLookup): Promise<AnyMatchResult | null> {
  const hit = await catalog.findSealedByCardmarketId(cardmarketId);
  return hit
    ? { kind: "sealed", sealedProductId: hit.sealedProductId, confidence: CARDMARKET_ID_CONFIDENCE, method: "cardmarket_id" }
    : null;
}

// ---------------------------------------------------------------------------
// Carta suelta
// ---------------------------------------------------------------------------

async function matchSingle(
  listing: NormalizedListing,
  parsed: ParsedTitle,
  override: MatchResult | null,
  catalog: CatalogLookup,
): Promise<MatchResult | null> {
  const setCode = await resolveSetCode([listing.setHint, ...parsed.setHints], catalog);
  const card: CardMatch | null = override ?? (await identifyCard(parsed, setCode, catalog));
  if (!card) return null;

  const printing = setCode ? await findPrinting(card.oracleId, setCode, listing, parsed, catalog) : null;
  // Una corrección sin impresión fija la carta; la impresión se busca como en los demás casos
  if (override) return { ...override, scryfallId: printing?.scryfallId ?? null };

  const penalty = !printing ? PRINTING_UNRESOLVED_PENALTY : printing.guessed ? PRINTING_GUESSED_PENALTY : 0;
  return {
    kind: "single",
    oracleId: card.oracleId,
    scryfallId: printing?.scryfallId ?? null,
    confidence: round(card.confidence - penalty),
    method: card.method,
  };
}

/** El nombre limpio o, si no queda nada ("- -", "( )"), el título entero */
function titleKey(parsed: ParsedTitle, rawTitle: string): string {
  return normalizeName(parsed.name) || normalizeName(rawTitle);
}

/** " / " con espacios separa los dos idiomas de un título bilingüe; "//" o "A/B", las caras */
const BILINGUAL = /\s\/\s/;

/**
 * Nombres que se prueban, cada uno como un grupo de lados:
 *   - "Fire // Ice", "Fire/Ice": nombre completo y primera cara;
 *   - "Abajo en el valle / Down in the Valley": nombre completo (también puede ser una carta
 *     partida escrita con una sola barra, "Fire / Ice") y luego los dos lados a la vez.
 */
function nameGroups(name: string): string[][] {
  const full = normalizeName(name);
  if (!name.includes("//") && BILINGUAL.test(name)) {
    const sides = name.split(BILINGUAL).map(normalizeName).filter(Boolean);
    return [[full], sides].filter((g) => g.length > 0);
  }
  const front = normalizeName(name.split("/")[0] ?? "");
  return [...new Set([full, front])].filter(Boolean).map((n) => [n]);
}

async function exactMatch(name: string, setCode: string | null, catalog: CatalogLookup): Promise<CardMatch | null | "ambiguous"> {
  for (const lang of ["en", "es"] as const) {
    const ids = [...new Set((await catalog.findByExactName(name, lang)).map((hit) => hit.oracleId))];
    if (ids.length === 0) continue;
    const method: MatchMethod = lang === "en" ? "exact_en" : "exact_es";
    if (ids.length === 1) {
      return { oracleId: ids[0]!, confidence: lang === "en" ? EXACT_EN_CONFIDENCE : EXACT_ES_CONFIDENCE, method };
    }
    // Mismo nombre exacto para varias cartas (pasa con algunas traducciones): solo se acepta si
    // la edición del título deja una. Si no, mejor sin emparejar que con la carta equivocada.
    const oracleId = await onlyOneInSet(ids, setCode, catalog);
    return oracleId ? { oracleId, confidence: AMBIGUOUS_NAME_CONFIDENCE, method } : "ambiguous";
  }
  return null;
}

async function identifyCard(parsed: ParsedTitle, setCode: string | null, catalog: CatalogLookup): Promise<CardMatch | null> {
  const groups = nameGroups(parsed.name);

  for (const sides of groups) {
    const matches: CardMatch[] = [];
    for (const side of sides) {
      const match = await exactMatch(side, setCode, catalog);
      if (match === "ambiguous") return null;
      if (match) matches.push(match);
    }
    if (matches.length === 0) continue;
    // Los dos lados de un título bilingüe tienen que ser la misma carta
    if (new Set(matches.map((m) => m.oracleId)).size > 1) return null;
    return matches.sort((a, b) => b.confidence - a.confidence)[0]!;
  }

  // Como mucho dos consultas (nombre completo y primera cara, o los dos lados): findByTrigram va a la BD
  const names = groups.length > 1 && groups[1]!.length > 1 ? groups[1]! : groups.map((g) => g[0]!);
  for (const name of names.slice(0, 2)) {
    if (name.length < 3) continue;
    const match = bestTrigram(await catalog.findByTrigram(name, TRIGRAM_MIN_SIMILARITY, TRIGRAM_LIMIT));
    if (match) return match;
  }
  return null;
}

async function onlyOneInSet(oracleIds: string[], setCode: string | null, catalog: CatalogLookup): Promise<string | null> {
  if (!setCode) return null;
  const inSet: string[] = [];
  for (const id of oracleIds) {
    if ((await catalog.findPrintings(id, setCode)).length > 0) inSet.push(id);
  }
  return inSet.length === 1 ? inSet[0]! : null;
}

function bestTrigram(rows: Array<{ oracleId: string; similarity: number }>): CardMatch | null {
  // La BD devuelve una fila por carta; el mock, una por nombre (inglés, español, caras)
  const best = new Map<string, number>();
  for (const row of rows) best.set(row.oracleId, Math.max(best.get(row.oracleId) ?? 0, row.similarity));
  const [first, second] = [...best].sort((a, b) => b[1] - a[1]);
  if (!first || first[1] < TRIGRAM_ACCEPT) return null;
  if (second && first[1] - second[1] < TRIGRAM_MARGIN) return null;
  const t = (Math.min(first[1], 1) - TRIGRAM_ACCEPT) / (1 - TRIGRAM_ACCEPT);
  return {
    oracleId: first[0],
    confidence: TRIGRAM_MIN_CONFIDENCE + t * (TRIGRAM_MAX_CONFIDENCE - TRIGRAM_MIN_CONFIDENCE),
    method: "trigram",
  };
}

// ---------------------------------------------------------------------------
// Impresión
// ---------------------------------------------------------------------------

async function findPrinting(
  oracleId: string,
  setCode: string,
  listing: NormalizedListing,
  parsed: ParsedTitle,
  catalog: CatalogLookup,
): Promise<PrintingChoice | null> {
  const known = listing.finish ?? parsed.finish;
  const hints: PrintingHints = {
    // El número de un campo estructurado manda sobre el del título
    collectorNumber: listing.collectorNumber ?? parsed.collectorNumber,
    finish: known ?? "nonfoil",
    finishKnown: known != null,
    tags: parsed.tags,
  };
  const choice = choosePrinting(await catalog.findPrintings(oracleId, setCode), hints);
  if (choice || !(hints.tags.includes("promo") || hints.tags.includes("prerelease"))) return choice;
  // Las promos suelen estar en su propia edición: "Sheoldred (DMU) Prerelease" está en pdmu
  return choosePrinting(await catalog.findPrintings(oracleId, `p${setCode}`), hints);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
