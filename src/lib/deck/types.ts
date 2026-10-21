/**
 * Mazos de Commander importados de ManaBox. Se guardan en el navegador (localStorage): no hay
 * cuentas, así que cada mazo es solo de quien lo importa.
 */

/** Colores de Magic en el orden de Scryfall */
export type Color = "W" | "U" | "B" | "R" | "G";

/** Datos de una carta que usa el mazo (de Scryfall, por su Scryfall ID) */
export interface DeckCard {
  scryfallId: string;
  oracleId: string;
  /** nombre en inglés */
  name: string;
  /** nombre impreso en español, si Scryfall tiene esa impresión */
  nameEs: string | null;
  setCode: string;
  collectorNumber: string;
  typeLine: string;
  manaCost: string;
  cmc: number;
  colors: Color[];
  colorIdentity: Color[];
  /** texto de reglas en inglés (en cartas de dos caras, las dos unidas) */
  oracleText: string;
  keywords: string[];
  imageUrl: string | null;
  /** imagen de la impresión en español, si existe */
  imageUrlEs: string | null;
  /** precio de Cardmarket (vía Scryfall) en céntimos: normal o, si no hay, foil */
  priceEurCents: number | null;
  legalCommander: boolean;
  isToken: boolean;
}

export interface DeckEntry {
  card: DeckCard;
  quantity: number;
}

/** Un cambio propuesto o elegido: sale una carta del mazo y entra una nueva */
export interface Swap {
  outId: string;
  inId: string;
  reason: string;
  /** "auto" = lo propone el recomendador; "manual" = lo ha cambiado el usuario */
  source: "auto" | "manual";
}

export interface Deck {
  version: 1;
  id: string;
  name: string;
  /** oracleId del comandante (va dentro de `cards`) */
  commanderId: string | null;
  /** las 100 cartas, comandante incluido */
  cards: DeckEntry[];
  /** fichas: se enseñan aparte y no cuentan */
  tokens: DeckEntry[];
  /** cartas nuevas que todavía no están en el mazo (mejoras, compras) */
  pool: DeckEntry[];
  /** oracleIds que nunca se proponen para salir */
  protectedIds: string[];
  /** oracleIds que se proponen antes para salir */
  cutCandidateIds: string[];
  /** cambios elegidos para el pool (vacío = los que propone el recomendador) */
  swaps: Swap[];
  /** oracleIds de cartas nuevas que el usuario ha decidido no meter */
  dismissedIds: string[];
  importedAt: string;
  updatedAt: string;
}

/** Una línea de un CSV de ManaBox o de una lista pegada, antes de pedir los datos a Scryfall */
export interface ImportRow {
  name: string;
  quantity: number;
  scryfallId?: string;
  setCode?: string;
  collectorNumber?: string;
  language?: string;
}

/** Cómo pedir una carta a Scryfall (/cards/collection) */
export type CardIdentifier = { id: string } | { set: string; collector_number: string } | { name: string };
