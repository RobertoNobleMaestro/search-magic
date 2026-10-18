import { squish } from "../text";

/**
 * Texto de una tienda sin caracteres de formato invisibles (Unicode Cf: U+2063, U+200B, U+FEFF…) y
 * con los espacios colapsados. El Duelista mete U+2063 en todos sus títulos.
 */
export function cleanText(text: string): string {
  return squish(text.replace(/\p{Cf}/gu, ""));
}

/**
 * Foto de un producto como URL absoluta https, sin #fragmento: "//cdn…" pasa a https, una ruta
 * relativa se resuelve con `base` y lo demás (http, data:, javascript:…) se descarta.
 */
export function httpsImageUrl(src: string | null | undefined, base?: string): string | undefined {
  const value = src?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value, base);
    if (url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}
