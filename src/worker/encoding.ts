/**
 * Codificación de texto de lo que llega de las tiendas (páginas HTML antiguas, CSV de Excel…).
 */

/**
 * Como hacen los navegadores (WHATWG), "iso-8859-1" y "latin1" se leen como windows-1252: es lo que
 * suelen servir de verdad esas webs, y así el "€" (0x80) no se pierde.
 */
const ALIASES: Record<string, string> = {
  "iso-8859-1": "windows-1252",
  "iso8859-1": "windows-1252",
  latin1: "windows-1252",
  "latin-1": "windows-1252",
  cp1252: "windows-1252",
  utf8: "utf-8",
};

/** Nombre canónico de una codificación, o null si no se conoce */
export function normalizeEncoding(label: string): string | null {
  const key = label.trim().toLowerCase();
  const name = ALIASES[key] ?? key;
  try {
    new TextDecoder(name);
    return name;
  } catch {
    return null;
  }
}

/**
 * Bytes → texto. Un BOM (UTF-8, UTF-16 LE/BE) manda sobre `encoding`, que por defecto es UTF-8.
 * El BOM no se incluye en el texto.
 */
export function decodeText(bytes: Uint8Array, encoding?: string): string {
  let label = encoding ? (normalizeEncoding(encoding) ?? "utf-8") : "utf-8";
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) label = "utf-8";
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) label = "utf-16le";
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) label = "utf-16be";
  // TextDecoder quita el BOM de su propia codificación
  return new TextDecoder(label).decode(bytes);
}
