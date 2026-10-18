import type { Condition, Finish, Lang, NormalizedListing } from "@/lib/data/types";
import { normalizeName } from "@/lib/normalize";

/**
 * Estado, idioma, acabado y edición a partir de los campos estructurados de las tiendas: opciones de
 * variante de Shopify ("NM / Español / Foil"), atributos de WooCommerce ("Idioma: Español") o el texto
 * de un selector. Lo que venga solo en el título lo completa después enrichListing (src/lib/matching).
 */

export type ListingAttributes = Pick<NormalizedListing, "condition" | "language" | "finish" | "setHint">;

type Kind = "condition" | "language" | "finish" | "set";
type Words<T> = ReadonlyArray<readonly [string, T]>;

/** { valor: [palabras] } → [palabra, valor], en el mismo orden */
function words<T extends string>(groups: Partial<Record<T, string[]>>): Words<T> {
  return (Object.entries(groups) as Array<[T, string[]]>).flatMap(([value, list]) => list.map((word) => [word, value] as const));
}

/** Nombre de la opción o del atributo (normalizado) → qué describe. Sin nombre conocido, se prueba todo. */
const KIND_BY_NAME = new Map(
  words<Kind>({
    condition: ["condition", "condicion", "estado", "estat", "calidad", "conservacion"],
    language: ["language", "idioma", "lengua"],
    finish: ["finish", "acabado", "acabat", "foil"],
    set: ["set", "edition", "edicion", "edicio", "expansion", "coleccion"],
  }),
);

// Palabras ya normalizadas (normalizeName). Gana la primera de la lista que aparezca, así que las
// expresiones largas van antes que las cortas que contienen ("near mint" antes que "mint",
// "lightly played" antes que "played").
const CONDITION_WORDS = words<Condition>({
  NM: ["near mint", "nm m", "casi nueva", "casi nuevo", "como nueva", "como nuevo"],
  MT: ["mint", "perfecta", "perfecto"],
  EX: ["excellent", "excelente", "slightly played"],
  GD: ["moderately played", "good", "buen estado", "buena", "bueno"],
  LP: ["light played", "lightly played", "ligeramente jugada", "ligeramente jugado", "poco jugada", "poco jugado"],
  PL: ["heavily played", "muy jugada", "muy jugado", "played", "jugada", "jugado"],
  PO: ["damaged", "poor", "mal estado", "danada", "danado"],
});
/** Escala de Cardmarket y equivalencias de la americana (SP, MP, HP, DMG) */
// prettier-ignore
const CONDITION_CODES: Record<string, Condition> = {
  MT: "MT", NM: "NM", EX: "EX", GD: "GD", LP: "LP", PL: "PL", PO: "PO",
  SP: "EX", MP: "GD", HP: "PL", DMG: "PO",
};

const LANGUAGE_WORDS = words<Lang>({
  en: ["english", "ingles", "angles", "eng"],
  es: ["spanish", "espanol", "castellano", "castella", "espanyol", "esp"],
  fr: ["french", "frances"],
  de: ["german", "aleman", "alemany", "deutsch"],
  it: ["italian", "italiano"],
  pt: ["portuguese", "portugues"],
  ja: ["japanese", "japones", "jap"],
  ko: ["korean", "coreano"],
  ru: ["russian", "ruso"],
  zht: ["traditional chinese", "chinese traditional", "chino tradicional"],
  zhs: ["simplified chinese", "chinese simplified", "chino simplificado", "chinese", "chino"],
});
// prettier-ignore
const LANGUAGE_CODES: Record<string, Lang> = {
  EN: "en", ES: "es", FR: "fr", DE: "de", IT: "it", PT: "pt", RU: "ru",
  JA: "ja", JP: "ja", KO: "ko", KR: "ko", ZHS: "zhs", ZHT: "zht",
};

const FINISH_WORDS = words<Finish>({
  nonfoil: ["non foil", "nonfoil", "no foil", "sin foil", "normal"],
  etched: ["foil etched", "etched foil", "etched"],
  foil: ["foil"],
});
/** Opción "Foil: Sí / No" */
const FINISH_ANSWERS = words<Finish>({ foil: ["si", "yes"], nonfoil: ["no"] });

function findWord<T>(norm: string, list: Words<T>): readonly [string, T] | undefined {
  return list.find(([word]) => ` ${norm} `.includes(` ${word} `));
}

/** Abreviaturas ("NM", "ES"…). En texto libre solo cuentan en mayúsculas: "es" o "de" no son idiomas. */
function findCode<T>(text: string, codes: Record<string, T>, anyCase: boolean): readonly [string, T] | undefined {
  for (const token of text.split(/[^A-Za-z0-9]+/)) {
    const key = anyCase ? token.toUpperCase() : token;
    if (Object.hasOwn(codes, key)) return [token.toLowerCase(), codes[key]!];
  }
  return undefined;
}

/** Lee un valor; `rest` es lo que queda sin reconocer (vacío si se ha entendido todo). */
function parseValue(value: string, kind: Kind | undefined) {
  let rest = normalizeName(value);
  const anyCase = kind !== undefined;
  const take = <T>(hit: readonly [string, T] | undefined): T | undefined => {
    if (hit) rest = ` ${rest} `.replace(` ${hit[0]} `, " ").trim();
    return hit?.[1];
  };
  const wants = (k: Kind) => kind === undefined || kind === k;
  const condition = wants("condition") ? take(findWord(rest, CONDITION_WORDS) ?? findCode(value, CONDITION_CODES, anyCase)) : undefined;
  const language = wants("language") ? take(findWord(rest, LANGUAGE_WORDS) ?? findCode(value, LANGUAGE_CODES, anyCase)) : undefined;
  const finish = wants("finish")
    ? take(findWord(rest, FINISH_WORDS) ?? (kind === "finish" ? findWord(rest, FINISH_ANSWERS) : undefined))
    : undefined;
  return { condition, language, finish, rest };
}

/**
 * Atributos de un listado a partir de pares nombre/valor (opciones de variante, atributos de producto…).
 * `unrecognized` indica que algún valor lleva algo más que estado, idioma o acabado ("M10 / NM"), por si
 * conviene añadirlo al título para el emparejador.
 */
export function parseAttributes(entries: ReadonlyArray<{ name?: string | null; value?: string | null }>): {
  attrs: ListingAttributes;
  unrecognized: boolean;
} {
  const attrs: ListingAttributes = {};
  let unrecognized = false;
  for (const { name, value } of entries) {
    const text = value?.trim();
    if (!text || /^default title$/i.test(text)) continue;
    const kind = name ? KIND_BY_NAME.get(normalizeName(name)) : undefined;
    if (kind === "set") {
      attrs.setHint ??= text;
      continue;
    }
    const { condition, language, finish, rest } = parseValue(text, kind);
    if (condition && !attrs.condition) attrs.condition = condition;
    if (language && !attrs.language) attrs.language = language;
    if (finish && !attrs.finish) attrs.finish = finish;
    if (rest) unrecognized = true;
  }
  return { attrs, unrecognized };
}

const OUT_OF_STOCK =
  /\b(agotad[oa]s?|esgotat|sin stock|sin existencias|sense estoc|no disponible|fuera de stock|out of stock|outofstock|sold out|unavailable)\b/;

/**
 * Cantidad solo junto a una palabra de stock ("Quedan 3", "3 disponibles", "Stock: 5") o como texto
 * entero ("3"): cualquier otra cifra (un id, "Envío en 24h", la clase post-119455) no es una cantidad.
 */
const QUANTITY =
  /^(\d+)$|\b(\d+) (?:uds?|unidades?|disponibles?|en stock|in stock|left|available|restantes?)\b|\b(?:quedan?|stock|disponibles?|unidades?) (\d+)\b/;

/** Texto de disponibilidad: "Agotado" → sin stock; "Quedan 3" → 3 unidades; cualquier otro → disponible. */
export function parseStock(text: string): { inStock: boolean; quantity?: number } {
  const norm = normalizeName(text);
  if (OUT_OF_STOCK.test(norm)) return { inStock: false, quantity: 0 };
  const count = QUANTITY.exec(norm);
  if (!count) return { inStock: true };
  const quantity = Number(count[1] ?? count[2] ?? count[3]);
  return { inStock: quantity > 0, quantity };
}
