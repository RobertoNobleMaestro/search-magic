import { normalizeName } from '../../lib/normalize';

/**
 * Palabras habituales en español → las que usa MTGJSON en los nombres de producto
 * ("Bloomburrow Play Booster Box"). Cada palabra puede casar con varias alternativas.
 * Mismo criterio que rankSealed en src/lib/data/mock.ts.
 */
const SYNONYMS: Record<string, string[]> = {
  caja: ['box'],
  cajas: ['box'],
  display: ['box'],
  displays: ['box'],
  sobre: ['booster', 'pack'],
  sobres: ['booster', 'pack'],
  mazo: ['deck'],
  mazos: ['deck'],
  baraja: ['deck'],
  presentacion: ['prerelease'],
  kit: ['kit', 'pack'],
  coleccionista: ['collector'],
  juego: ['play'],
  edicion: ['set'],
  inicio: ['starter'],
  iniciacion: ['starter'],
};

/** Palabras que no aportan: artículos, preposiciones y la marca. */
const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'con', 'para', 'un', 'una', 'magic', 'mtg']);

/**
 * Convierte una búsqueda en grupos de alternativas: cada grupo debe casar como prefijo de
 * alguna palabra del producto. "sobres de coleccionista duskmourn" →
 * [["booster","pack"], ["collector"], ["duskmourn"]].
 */
export function sealedQueryTokens(q: string): string[][] {
  return normalizeName(q)
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => SYNONYMS[t] ?? [t]);
}

/**
 * Categorías de MTGJSON que la búsqueda pide expresamente, para ordenarlas primero:
 * "caja dominaria" quiere booster_box antes que el "Box Topper Pack".
 */
export function sealedCategoryHints(groups: string[][]): string[] {
  const words = new Set(groups.flat());
  const hints: string[] = [];
  if (words.has('box')) hints.push('booster_box');
  if (words.has('deck')) hints.push('deck', 'deck_box');
  if (words.has('bundle')) hints.push('bundle');
  if (words.has('prerelease')) hints.push('limited_aid_tool');
  if (!words.has('box') && (words.has('booster') || words.has('pack'))) hints.push('booster_pack');
  return hints;
}
