import type { CatalogLookup, MatchResult, NormalizedListing } from "@/lib/data/types";

/**
 * Empareja un listado de tienda con una carta del catálogo de Scryfall.
 * Devuelve null si no hay coincidencia con confianza suficiente (queda "sin emparejar").
 */
export async function matchListing(listing: NormalizedListing, catalog: CatalogLookup): Promise<MatchResult | null> {
  void listing;
  void catalog;
  throw new Error("matchListing: pendiente de implementar");
}

/**
 * Completa estado, idioma, acabado y edición a partir del título cuando el adaptador
 * no los ha podido sacar de campos estructurados. Nunca pisa lo que ya viene relleno.
 */
export function enrichListing(listing: NormalizedListing): NormalizedListing {
  return listing;
}

/**
 * Limpia un título de tienda (estado, idioma, foil, edición, ruido…) y lo normaliza con normalizeName.
 * Es la clave de las correcciones manuales (match_overrides.title_norm).
 */
export function normalizeTitle(rawTitle: string): string {
  void rawTitle;
  throw new Error("normalizeTitle: pendiente de implementar");
}
