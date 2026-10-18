/**
 * Transformación pura de objetos de Scryfall a filas de la BD.
 * Sin E/S: todo lo que hay aquí se prueba con objetos de ejemplo.
 */
import { normalizeName } from '../../lib/normalize';
import type { cardNames, cards, printings, sets } from '../schema';

type Finish = 'nonfoil' | 'foil' | 'etched';

export type ScryfallFace = {
  name: string;
  printed_name?: string;
  oracle_id?: string;
  mana_cost?: string;
  type_line?: string;
  image_uris?: { normal?: string };
};

/** Solo los campos que usamos de https://scryfall.com/docs/api/cards */
export type ScryfallCard = {
  id: string;
  oracle_id?: string;
  name: string;
  printed_name?: string;
  lang: string;
  layout: string;
  set: string;
  set_name: string;
  set_type: string;
  collector_number: string;
  rarity: string;
  released_at?: string;
  digital?: boolean;
  finishes?: string[];
  border_color?: string;
  frame?: string;
  frame_effects?: string[];
  promo_types?: string[];
  full_art?: boolean;
  promo?: boolean;
  type_line?: string;
  mana_cost?: string;
  image_uris?: { normal?: string };
  card_faces?: ScryfallFace[];
  cardmarket_id?: number | null;
  prices?: { eur?: string | null; eur_foil?: string | null };
};

export type SetRow = typeof sets.$inferInsert;
export type CardRow = typeof cards.$inferInsert;
export type CardNameRow = typeof cardNames.$inferInsert;
export type PrintingRow = typeof printings.$inferInsert;

/** Objetos que no son cartas sueltas de papel y solo meterían ruido en el emparejamiento. */
const EXCLUDED_LAYOUTS = new Set(['token', 'double_faced_token', 'emblem', 'art_series']);
const KNOWN_FINISHES = new Set<string>(['nonfoil', 'foil', 'etched']);
const SHOWY_FRAMES = new Set(['showcase', 'extendedart', 'etched', 'inverted']);

export function isPaperCard(card: ScryfallCard): boolean {
  return !card.digital && !EXCLUDED_LAYOUTS.has(card.layout);
}

/** Las cartas reversibles no tienen oracle_id en la raíz, solo en cada cara. */
export function oracleIdOf(card: ScryfallCard): string | null {
  return card.oracle_id ?? card.card_faces?.[0]?.oracle_id ?? null;
}

/** "1.25" → 125. Scryfall da los precios como texto o null. */
export function eurToCents(value: string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function imageOf(card: ScryfallCard): string | null {
  return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? null;
}

/** Una impresión "normal": sin promo, sin borderless, sin arte completo ni marcos especiales. */
export function isPlainPrinting(card: ScryfallCard): boolean {
  return (
    !card.promo &&
    card.border_color === 'black' &&
    !card.full_art &&
    !(card.frame_effects ?? []).some((f) => SHOWY_FRAMES.has(f))
  );
}

/**
 * Orden para elegir la imagen representativa de una carta: inglés antes que otros
 * idiomas, impresión normal antes que variantes y, a igualdad, la más reciente.
 */
export function representativeScore(card: ScryfallCard): string {
  return `${card.lang === 'en' ? 1 : 0}${isPlainPrinting(card) ? 1 : 0}${card.released_at ?? '0000-00-00'}`;
}

type NamedEntry = { name: string; isFace: boolean };

/** "Fire // Ice" se indexa entero y también por cada cara, que es como lo suelen titular las tiendas. */
export function englishNames(card: ScryfallCard): NamedEntry[] {
  const entries: NamedEntry[] = [{ name: card.name, isFace: false }];
  const faces = card.card_faces ?? [];
  if (faces.length > 1) {
    for (const face of faces) entries.push({ name: face.name, isFace: true });
  }
  return entries;
}

/** Nombre impreso de una impresión en español, completo y por caras. Vacío si no lo trae. */
export function printedNames(card: ScryfallCard): NamedEntry[] {
  const faces = card.card_faces ?? [];
  const faceNames = faces.map((f) => f.printed_name).filter((n): n is string => !!n);
  const full =
    card.printed_name ?? (faces.length > 1 && faceNames.length === faces.length ? faceNames.join(' // ') : undefined);
  const entries: NamedEntry[] = full ? [{ name: full, isFace: false }] : [];
  if (faces.length > 1) {
    for (const name of faceNames) entries.push({ name, isFace: true });
  }
  return entries;
}

/** Filas de card_names sin duplicados por nombre normalizado; descarta nombres que quedan vacíos. */
export function toNameRows(oracleId: string, lang: string, entries: NamedEntry[]): CardNameRow[] {
  const rows = new Map<string, CardNameRow>();
  for (const { name, isFace } of entries) {
    const nameNorm = normalizeName(name);
    if (!nameNorm) continue;
    const existing = rows.get(nameNorm);
    // Si un nombre aparece como completo y como cara (reversibles), gana el completo.
    if (!existing || (existing.isFace && !isFace)) rows.set(nameNorm, { oracleId, lang, name, nameNorm, isFace });
  }
  return [...rows.values()];
}

export function toPrintingRow(card: ScryfallCard, oracleId: string): PrintingRow {
  return {
    scryfallId: card.id,
    oracleId,
    setCode: card.set,
    collectorNumber: card.collector_number,
    lang: card.lang,
    rarity: card.rarity,
    finishes: (card.finishes ?? []).filter((f): f is Finish => KNOWN_FINISHES.has(f)),
    borderColor: card.border_color ?? null,
    frame: card.frame ?? null,
    frameEffects: card.frame_effects ?? [],
    promoTypes: card.promo_types ?? [],
    fullArt: card.full_art ?? false,
    promo: card.promo ?? false,
    imageUri: imageOf(card),
    cardmarketId: card.cardmarket_id ?? null,
    priceEurCents: eurToCents(card.prices?.eur),
    priceEurFoilCents: eurToCents(card.prices?.eur_foil),
    releasedAt: card.released_at ?? null,
  };
}

/** Acumula sets, cartas, nombres en inglés e impresiones a partir de default_cards. */
export class DefaultCardsAccumulator {
  readonly sets = new Map<string, SetRow>();
  readonly cards = new Map<string, CardRow & { score: string }>();
  readonly names = new Map<string, CardNameRow>();
  readonly printings: PrintingRow[] = [];
  skipped = 0;

  add(card: ScryfallCard): void {
    const oracleId = oracleIdOf(card);
    if (!oracleId || !isPaperCard(card)) {
      this.skipped++;
      return;
    }

    const set = this.sets.get(card.set);
    if (!set) {
      this.sets.set(card.set, {
        code: card.set,
        name: card.set_name,
        nameNorm: normalizeName(card.set_name),
        setType: card.set_type,
        releasedAt: card.released_at ?? null,
      });
    } else if (card.released_at && (!set.releasedAt || card.released_at < set.releasedAt)) {
      set.releasedAt = card.released_at;
    }

    const score = representativeScore(card);
    const current = this.cards.get(oracleId);
    if (!current || score > current.score) {
      const front = card.card_faces?.[0];
      this.cards.set(oracleId, {
        oracleId,
        name: card.name,
        typeLine: card.type_line ?? front?.type_line ?? null,
        manaCost: card.mana_cost ?? front?.mana_cost ?? null,
        imageUri: imageOf(card) ?? current?.imageUri ?? null,
        score,
      });
    }

    for (const row of toNameRows(oracleId, 'en', englishNames(card))) {
      this.names.set(`${oracleId}|${row.nameNorm}`, row);
    }
    this.printings.push(toPrintingRow(card, oracleId));
  }

  cardRows(): CardRow[] {
    return [...this.cards.values()].map(({ score: _score, ...row }) => row);
  }
}

/** Acumula los nombres en español de all_cards (solo las impresiones con lang=es). */
export class SpanishNamesAccumulator {
  readonly names = new Map<string, CardNameRow>();
  /** Nombre preferido por carta: el de la impresión en español más reciente. */
  readonly preferred = new Map<string, { nameEs: string; releasedAt: string }>();
  skipped = 0;

  /**
   * @param englishNames nombres normalizados en inglés de cada carta del catálogo
   *   (las claves son los oracle_id conocidos). Algunas impresiones "es" de Scryfall
   *   traen el nombre inglés como printed_name; esos no cuentan como traducción.
   */
  constructor(private readonly englishNames: ReadonlyMap<string, ReadonlySet<string>>) {}

  add(card: ScryfallCard): void {
    const oracleId = oracleIdOf(card);
    const english = oracleId ? this.englishNames.get(oracleId) : undefined;
    if (card.lang !== 'es' || !oracleId || !english || !isPaperCard(card)) {
      this.skipped++;
      return;
    }
    const entries = printedNames(card).filter((e) => !english.has(normalizeName(e.name)));
    if (entries.length === 0) {
      this.skipped++;
      return;
    }
    for (const row of toNameRows(oracleId, 'es', entries)) {
      this.names.set(`${oracleId}|${row.nameNorm}`, row);
    }
    const full = entries.find((e) => !e.isFace)?.name ?? entries[0]!.name;
    const releasedAt = card.released_at ?? '0000-00-00';
    const current = this.preferred.get(oracleId);
    if (!current || releasedAt > current.releasedAt) this.preferred.set(oracleId, { nameEs: full, releasedAt });
  }
}
