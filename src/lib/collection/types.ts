import type { DeckCard } from "@/lib/deck/types";

/**
 * Colecciones importadas de un CSV de ManaBox. Como los mazos, se guardan en el navegador
 * (localStorage): no hay cuentas.
 */

export type Finish = "normal" | "foil" | "etched";

/** Una impresión concreta con un acabado: las líneas repetidas del CSV se suman aquí */
export interface CollectionLine {
  card: DeckCard;
  finish: Finish;
  quantity: number;
  /** lo que valían todas las copias al añadirlas en ManaBox, en céntimos (null si no consta) */
  paidCents: number | null;
}

export interface Collection {
  version: 1;
  id: string;
  name: string;
  lines: CollectionLine[];
  importedAt: string;
}

/** Lo que se enseña como una carta: todas las copias de esa carta (o de esa impresión) juntas */
export interface CollectionEntry {
  key: string;
  /** la impresión que se enseña: la de número más bajo, que suele ser la normal */
  card: DeckCard;
  lines: CollectionLine[];
  quantity: number;
  foil: number;
  /** cuántas impresiones distintas hay dentro */
  versions: number;
  /** valor de todas las copias en céntimos; null si ninguna tiene precio */
  valueCents: number | null;
  /** precio de mercado por copia (el de la copia que más vale, p. ej. la foil); null si no hay */
  unitCents: number | null;
}
