/**
 * Transformación pura de SetList.json de MTGJSON (https://mtgjson.com, licencia MIT):
 * producto sellado y nombres alternativos de edición (español y Cardmarket).
 */
import { normalizeName } from '../../lib/normalize';
import type { sealedProducts, setAliases } from '../schema';

export type MtgjsonSealedProduct = {
  uuid: string;
  name: string;
  setCode?: string;
  category?: string;
  subtype?: string | null;
  cardCount?: number;
  releaseDate?: string;
  identifiers?: { mcmId?: string };
};

export type MtgjsonSet = {
  code: string;
  name: string;
  releaseDate?: string;
  isOnlineOnly?: boolean;
  mcmName?: string;
  translations?: Record<string, string | null | undefined>;
  sealedProduct?: MtgjsonSealedProduct[];
};

export type SealedRow = typeof sealedProducts.$inferInsert;
export type AliasRow = typeof setAliases.$inferInsert;

/** Las "MTGO Redemption" son colecciones para canjear en Magic Online: no las vende ninguna tienda. */
const EXCLUDED_SUBTYPES = new Set(['mtgo_redemption']);

export function toSealedRow(set: MtgjsonSet, product: MtgjsonSealedProduct): SealedRow | null {
  if (product.subtype && EXCLUDED_SUBTYPES.has(product.subtype)) return null;
  const nameNorm = normalizeName(product.name);
  if (!nameNorm) return null;
  const mcmId = Number(product.identifiers?.mcmId);
  return {
    id: product.uuid,
    setCode: (product.setCode ?? set.code).toLowerCase(),
    setName: set.name,
    name: product.name,
    nameNorm,
    category: product.category ?? null,
    subtype: product.subtype ?? null,
    cardCount: product.cardCount ?? null,
    releasedAt: product.releaseDate ?? set.releaseDate ?? null,
    cardmarketId: Number.isSafeInteger(mcmId) && mcmId > 0 ? mcmId : null,
  };
}

/**
 * Alias de edición a partir del nombre en español y del nombre de Cardmarket.
 * Solo para sets que existen en el catálogo, sin repetir lo que ya resuelven el código
 * o el nombre inglés, y descartando los alias que apuntarían a dos sets distintos.
 */
export function toAliasRows(
  sets: MtgjsonSet[],
  known: ReadonlyMap<string, string>, // código → name_norm del set en la BD
): AliasRow[] {
  const taken = new Set<string>([...known.keys(), ...known.values()]);
  const byAlias = new Map<string, Set<string>>();
  for (const set of sets) {
    const code = set.code.toLowerCase();
    if (!known.has(code)) continue;
    for (const name of [set.translations?.Spanish, set.mcmName]) {
      const alias = name ? normalizeName(name) : '';
      if (!alias || taken.has(alias)) continue;
      let codes = byAlias.get(alias);
      if (!codes) byAlias.set(alias, (codes = new Set()));
      codes.add(code);
    }
  }
  return [...byAlias.entries()]
    .filter(([, codes]) => codes.size === 1)
    .map(([aliasNorm, codes]) => ({ aliasNorm, setCode: [...codes][0]!, source: 'mtgjson' }));
}

export function mapSetList(sets: MtgjsonSet[], known: ReadonlyMap<string, string>) {
  const sealed = new Map<string, SealedRow>();
  for (const set of sets) {
    if (set.isOnlineOnly) continue;
    for (const product of set.sealedProduct ?? []) {
      const row = toSealedRow(set, product);
      if (row) sealed.set(row.id, row);
    }
  }
  return { sealed: [...sealed.values()], aliases: toAliasRows(sets, known) };
}
