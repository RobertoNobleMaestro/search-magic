import { describe, expect, it } from 'vitest';
import {
  DefaultCardsAccumulator,
  eurToCents,
  isPaperCard,
  oracleIdOf,
  printedNames,
  SpanishNamesAccumulator,
  toNameRows,
  type ScryfallCard,
} from './scryfall-map';

const BOLT = '4457ed35-7c10-48c8-9776-456485fdf070';
const FIRE_ICE = 'b76c4c3a-9ad5-4b6a-9a2c-1b0c2b5b2a8f';

function card(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: crypto.randomUUID(),
    oracle_id: BOLT,
    name: 'Lightning Bolt',
    lang: 'en',
    layout: 'normal',
    set: 'm10',
    set_name: 'Magic 2010',
    set_type: 'core',
    collector_number: '146',
    rarity: 'common',
    released_at: '2009-07-17',
    finishes: ['nonfoil', 'foil'],
    border_color: 'black',
    image_uris: { normal: 'https://cards.scryfall.io/normal/m10-146.jpg' },
    prices: { eur: '1.95', eur_foil: '12.50' },
    ...overrides,
  };
}

describe('eurToCents', () => {
  it('convierte el texto de Scryfall a céntimos', () => {
    expect(eurToCents('1.95')).toBe(195);
    expect(eurToCents('0.1')).toBe(10);
    expect(eurToCents('1234.56')).toBe(123456);
  });
  it('devuelve null si no hay precio', () => {
    expect(eurToCents(null)).toBeNull();
    expect(eurToCents(undefined)).toBeNull();
    expect(eurToCents('')).toBeNull();
    expect(eurToCents('n/a')).toBeNull();
  });
});

describe('filtros', () => {
  it('descarta digitales, tokens y art series', () => {
    expect(isPaperCard(card({}))).toBe(true);
    expect(isPaperCard(card({ digital: true }))).toBe(false);
    expect(isPaperCard(card({ layout: 'token' }))).toBe(false);
    expect(isPaperCard(card({ layout: 'art_series' }))).toBe(false);
  });
  it('saca el oracle_id de la primera cara en las reversibles', () => {
    const reversible = card({ oracle_id: undefined, layout: 'reversible_card', card_faces: [
      { name: 'Lightning Bolt', oracle_id: BOLT },
      { name: 'Lightning Bolt', oracle_id: BOLT },
    ] });
    expect(oracleIdOf(reversible)).toBe(BOLT);
  });
});

describe('nombres', () => {
  it('indexa las cartas partidas enteras y por caras', () => {
    const acc = new DefaultCardsAccumulator();
    acc.add(card({
      oracle_id: FIRE_ICE,
      name: 'Fire // Ice',
      layout: 'split',
      card_faces: [{ name: 'Fire' }, { name: 'Ice' }],
    }));
    const names = [...acc.names.values()].map((r) => [r.nameNorm, r.isFace]);
    expect(names).toEqual([
      ['fire ice', false],
      ['fire', true],
      ['ice', true],
    ]);
  });
  it('no duplica nombres que normalizan igual y prefiere el completo', () => {
    const rows = toNameRows(BOLT, 'en', [
      { name: 'Lightning Bolt', isFace: true },
      { name: 'Lightning Bolt', isFace: false },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isFace).toBe(false);
  });
  it('compone el nombre impreso de las cartas de dos caras', () => {
    const es = card({ lang: 'es', layout: 'transform', card_faces: [
      { name: 'Delver of Secrets', printed_name: 'Merodeador de secretos' },
      { name: 'Insectile Aberration', printed_name: 'Aberración insectil' },
    ] });
    expect(printedNames(es).map((e) => e.name)).toEqual([
      'Merodeador de secretos // Aberración insectil',
      'Merodeador de secretos',
      'Aberración insectil',
    ]);
  });
});

describe('DefaultCardsAccumulator', () => {
  it('usa como imagen la impresión normal más reciente, no la borderless', () => {
    const acc = new DefaultCardsAccumulator();
    acc.add(card({ set: 'm10', released_at: '2009-07-17', image_uris: { normal: 'm10.jpg' } }));
    acc.add(card({ set: 'sld', released_at: '2024-01-01', border_color: 'borderless', image_uris: { normal: 'sld.jpg' } }));
    acc.add(card({ set: '2xm', released_at: '2020-08-07', image_uris: { normal: '2xm.jpg' } }));
    expect(acc.cardRows()[0]!.imageUri).toBe('2xm.jpg');
    expect(acc.printings).toHaveLength(3);
  });
  it('guarda precios, acabados y la fecha más antigua de cada set', () => {
    const acc = new DefaultCardsAccumulator();
    acc.add(card({ released_at: '2009-07-20', cardmarket_id: 21071 }));
    acc.add(card({ released_at: '2009-07-17', collector_number: '146★', finishes: ['foil', 'glossy'] }));
    expect(acc.sets.get('m10')!.releasedAt).toBe('2009-07-17');
    expect(acc.printings[0]).toMatchObject({
      priceEurCents: 195,
      priceEurFoilCents: 1250,
      finishes: ['nonfoil', 'foil'],
      cardmarketId: 21071,
    });
    expect(acc.printings[1]!.finishes).toEqual(['foil']);
    expect(acc.printings[1]!.cardmarketId).toBeNull();
  });
});

describe('SpanishNamesAccumulator', () => {
  const english = new Map([[BOLT, new Set(['lightning bolt'])]]);

  it('guarda todas las traducciones distintas y prefiere la más reciente como name_es', () => {
    const acc = new SpanishNamesAccumulator(english);
    acc.add(card({ lang: 'es', printed_name: 'Rayo', released_at: '2009-07-17' }));
    acc.add(card({ lang: 'es', printed_name: 'Relámpago', released_at: '2024-11-15' }));
    acc.add(card({ lang: 'es', printed_name: 'Rayo', released_at: '2012-07-13' }));
    expect([...acc.names.values()].map((r) => r.nameNorm).sort()).toEqual(['rayo', 'relampago']);
    expect(acc.preferred.get(BOLT)!.nameEs).toBe('Relámpago');
  });
  it('no toma por traducción el nombre inglés que Scryfall pone en algunas impresiones "es"', () => {
    const acc = new SpanishNamesAccumulator(english);
    acc.add(card({ lang: 'es', printed_name: 'Relámpago', released_at: '2010-07-16' }));
    acc.add(card({ lang: 'es', printed_name: 'Lightning Bolt', released_at: '2025-01-01' }));
    expect([...acc.names.values()].map((r) => r.nameNorm)).toEqual(['relampago']);
    expect(acc.preferred.get(BOLT)!.nameEs).toBe('Relámpago');
  });
  it('ignora otros idiomas y cartas que no están en el catálogo', () => {
    const acc = new SpanishNamesAccumulator(english);
    acc.add(card({ lang: 'fr', printed_name: 'Foudre' }));
    acc.add(card({ lang: 'es', oracle_id: FIRE_ICE, printed_name: 'Fuego // Hielo' }));
    acc.add(card({ lang: 'es', printed_name: undefined }));
    expect(acc.names.size).toBe(0);
    expect(acc.skipped).toBe(3);
  });
});
