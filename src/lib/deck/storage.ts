import type { Deck } from "./types";

/**
 * Mazos guardados en el navegador. localStorage puede no existir (navegación privada, bloqueos),
 * así que todo va con try/catch y, si falla, simplemente no se guarda.
 */

const KEY = "search-magic:mazos:v1";

export function loadDecks(): Deck[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const decks = raw ? (JSON.parse(raw) as Deck[]) : [];
    // dismissedIds llegó después: los mazos guardados antes no lo tienen
    return Array.isArray(decks) ? decks.filter((d) => d?.version === 1).map((d) => ({ ...d, dismissedIds: d.dismissedIds ?? [] })) : [];
  } catch {
    return [];
  }
}

export function saveDecks(decks: Deck[]): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(decks));
    return true;
  } catch {
    return false;
  }
}
