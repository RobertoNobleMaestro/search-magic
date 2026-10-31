import type { Collection } from "./types";

/**
 * Colecciones guardadas en el navegador. localStorage puede no existir (navegación privada,
 * bloqueos), así que todo va con try/catch y, si falla, simplemente no se guarda.
 */

const KEY = "search-magic:colecciones:v1";

export function loadCollections(): Collection[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Collection[]) : [];
    return Array.isArray(list) ? list.filter((c) => c?.version === 1 && Array.isArray(c.lines)) : [];
  } catch {
    return [];
  }
}

export function saveCollections(collections: Collection[]): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(collections));
    return true;
  } catch {
    return false;
  }
}
