import { describe, expect, it } from 'vitest';
import { sealedCategoryHints, sealedQueryTokens } from './sealed-query';

describe('sealedQueryTokens', () => {
  it('traduce las palabras de producto y quita las vacías', () => {
    expect(sealedQueryTokens('Caja Bloomburrow')).toEqual([['box'], ['bloomburrow']]);
    expect(sealedQueryTokens('sobres de coleccionista Duskmourn')).toEqual([['booster', 'pack'], ['collector'], ['duskmourn']]);
    expect(sealedQueryTokens('kit de presentación Foundations')).toEqual([['kit', 'pack'], ['prerelease'], ['foundations']]);
    expect(sealedQueryTokens('Mazo Commander')).toEqual([['deck'], ['commander']]);
    expect(sealedQueryTokens('caja de sobres de edición de la Dominaria Unida')).toEqual([
      ['box'],
      ['booster', 'pack'],
      ['set'],
      ['dominaria'],
      ['unida'],
    ]);
  });

  it('deduce la categoría que se busca', () => {
    const hints = (q: string) => sealedCategoryHints(sealedQueryTokens(q));
    expect(hints('caja dominaria unida')).toEqual(['booster_box']);
    expect(hints('caja de sobres de juego')).toEqual(['booster_box']);
    expect(hints('sobres de coleccionista')).toEqual(['booster_pack']);
    expect(hints('mazo commander')).toEqual(['deck', 'deck_box']);
    expect(hints('kit de presentación')).toEqual(['limited_aid_tool', 'booster_pack']);
    expect(hints('bloomburrow')).toEqual([]);
  });

  it('deja tal cual las búsquedas en inglés y descarta la marca', () => {
    expect(sealedQueryTokens('Magic Foundations Play Booster Box')).toEqual([['foundations'], ['play'], ['booster'], ['box']]);
    expect(sealedQueryTokens('MTG')).toEqual([]);
    expect(sealedQueryTokens('  ')).toEqual([]);
  });
});
