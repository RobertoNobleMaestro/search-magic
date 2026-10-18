/**
 * Similitud por trigramas equivalente a `similarity()` de pg_trgm, para usarla fuera de
 * Postgres (datos de ejemplo, tests). Espera textos ya pasados por normalizeName.
 */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/** Como pg_trgm: cada palabra se rodea de dos espacios delante y uno detrás. */
function trigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}
