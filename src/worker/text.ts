/**
 * Utilidades de texto para lo que llega de las tiendas.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
};

/** Espacios (también los no separables) colapsados en uno */
export function squish(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** HTML de una API (nombres de WooCommerce: "Urza&#8217;s Saga") → texto plano */
export function htmlToText(html: string): string {
  const decoded = html.replace(/<[^>]*>/g, " ").replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (entity, code: string) => {
    if (!code.startsWith("#")) return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
    const point = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
  return squish(decoded);
}

export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // fetch dice solo "fetch failed": el motivo (DNS, conexión rechazada…) va en cause
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
  return `${error.message}${cause}`;
}
