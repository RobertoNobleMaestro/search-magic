import type { Finish, PrintingCandidate } from "@/lib/data/types";
import type { PrintingTag } from "./title";

/** Pistas del listado para elegir la impresión dentro de una edición */
export interface PrintingHints {
  collectorNumber?: string;
  finish: Finish;
  /** false si el acabado es el "nonfoil" por defecto: ni la tienda ni el título lo dicen */
  finishKnown: boolean;
  tags: PrintingTag[];
}

export interface PrintingChoice {
  scryfallId: string;
  /** elegida por descarte (variantes, impresión normal…) y no por un dato inequívoco */
  guessed: boolean;
}

/** Marcos que distinguen una variante de la impresión normal (los mismos que isPlainPrinting en la importación) */
const SPECIAL_FRAMES = new Set(["showcase", "extendedart", "etched", "inverted", "shatteredglass"]);
/** "" = la BD no tiene el dato */
const NORMAL_BORDERS = new Set(["black", "white", "silver", ""]);
/** Marcos de Scryfall que las tiendas llaman "retro" u "old frame" */
const RETRO_FRAMES = new Set(["1993", "1997"]);

/**
 * Elige la impresión de una edición:
 *   1. por número de coleccionista;
 *   2. entre las que existen en el acabado del listado (si ninguna, se ignora el acabado);
 *   3. por las variantes del título (borderless, showcase…);
 *   4. la única impresión "normal": sin promo, marcos especiales, arte completo ni borde raro.
 * null si no se puede decidir.
 */
export function choosePrinting(candidates: PrintingCandidate[], hints: PrintingHints): PrintingChoice | null {
  if (candidates.length === 0) return null;
  let guessed = false;

  if (hints.collectorNumber) {
    const wanted = numberKey(hints.collectorNumber);
    const byNumber = candidates.filter((c) => numberKey(c.collectorNumber) === wanted);
    if (byNumber.length === 1) {
      const pick = byNumber[0]!;
      return { scryfallId: pick.scryfallId, guessed: hints.finishKnown && !pick.finishes.includes(hints.finish) };
    }
    guessed = true; // número que no está en esta edición: se sigue con el resto de pistas
  }

  let pool = candidates.filter((c) => c.finishes.includes(hints.finish));
  if (pool.length === 0) {
    pool = candidates; // acabado imposible en esta edición: la tienda se habrá equivocado
    guessed = true;
  } else if (pool.length < candidates.length && !hints.finishKnown) {
    guessed = true; // se han descartado impresiones solo foil con un "nonfoil" supuesto
  }

  if (hints.tags.length > 0) {
    pool = pool.filter((c) => hints.tags.every((t) => hasTag(c, t) !== false));
    if (pool.length === 0) return null; // el título pide una variante que no existe en esta edición
  }
  // "retro" solo se comprueba si el catálogo trae el marco; si no, solo vale si no hay donde elegir
  const unverifiable = hints.tags.includes("retro") && pool.some((c) => c.frame == null);
  if (pool.length === 1) return { scryfallId: pool[0]!.scryfallId, guessed: guessed || unverifiable };
  if (unverifiable) return null;

  const plain = pool.filter((c) => !hasExtras(c, hints));
  // Desempate entre varias "normales": la que no trae promo_types (los de mazos de inicio,
  // extensiones de la edición…). universesbeyond no cuenta: lo llevan todas las de esas ediciones.
  const plainest = plain.length > 1 ? plain.filter((c) => c.promoTypes.every((t) => t === "universesbeyond")) : plain;
  return plainest.length === 1 ? { scryfallId: plainest[0]!.scryfallId, guessed: true } : null;
}

/** true / false, o null si el catálogo no permite saberlo */
function hasTag(c: PrintingCandidate, tag: PrintingTag): boolean | null {
  switch (tag) {
    case "borderless":
      return c.borderColor === "borderless";
    case "showcase":
    case "extendedart":
      return c.frameEffects.includes(tag);
    case "fullart":
      return c.fullArt;
    case "promo":
      return c.promo;
    case "prerelease":
      return c.promoTypes.includes("prerelease");
    case "retro":
      return c.frame == null ? null : RETRO_FRAMES.has(c.frame);
  }
}

/** Variantes que tiene la impresión y que el título no menciona */
function hasExtras(c: PrintingCandidate, { tags, finish }: PrintingHints): boolean {
  if (c.promo && !tags.includes("promo") && !tags.includes("prerelease")) return true;
  if (c.fullArt && !tags.includes("fullart")) return true;
  if (c.borderColor === "borderless" ? !tags.includes("borderless") : !NORMAL_BORDERS.has(c.borderColor)) return true;
  return c.frameEffects.some((f) => {
    if (!SPECIAL_FRAMES.has(f)) return false;
    if (f === "showcase" || f === "extendedart") return !tags.includes(f);
    return !(f === "etched" && finish === "etched");
  });
}

/** "063" y "63" son el mismo número; "1★" y "1" no */
function numberKey(collectorNumber: string): string {
  return collectorNumber.trim().toLowerCase().replace(/^0+(?=\d)/, "");
}
