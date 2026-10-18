import { squish } from "../text";

/**
 * Texto de una tienda sin caracteres de formato invisibles (Unicode Cf: U+2063, U+200B, U+FEFF…) y
 * con los espacios colapsados. El Duelista mete U+2063 en todos sus títulos.
 */
export function cleanText(text: string): string {
  return squish(text.replace(/\p{Cf}/gu, ""));
}
