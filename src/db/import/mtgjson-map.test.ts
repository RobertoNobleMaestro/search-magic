import { describe, expect, it } from 'vitest';
import { mapSetList, type MtgjsonSet } from './mtgjson-map';

const known = new Map([
  ['dmu', 'dominaria united'],
  ['m10', 'magic 2010'],
  ['one', 'phyrexia all will be one'],
]);

const dmu: MtgjsonSet = {
  code: 'DMU',
  name: 'Dominaria United',
  releaseDate: '2022-09-09',
  mcmName: 'Dominaria United',
  translations: { Spanish: 'Dominaria Unida', French: 'Dominaria Uni' },
  sealedProduct: [
    {
      uuid: '11111111-1111-5111-8111-111111111111',
      name: 'Dominaria United Set Booster Box',
      category: 'booster_box',
      subtype: 'set',
      identifiers: { mcmId: '657123' },
    },
    { uuid: '22222222-2222-5222-8222-222222222222', name: 'Dominaria United Bundle', category: 'bundle', subtype: 'default', releaseDate: '2022-09-10' },
    { uuid: '33333333-3333-5333-8333-333333333333', name: 'Dominaria United MTGO Redemption', category: 'box_set', subtype: 'mtgo_redemption' },
  ],
};

describe('mapSetList', () => {
  it('convierte el producto sellado y descarta las colecciones de canje de MTGO', () => {
    const { sealed } = mapSetList([dmu], known);
    expect(sealed).toHaveLength(2);
    expect(sealed[0]).toMatchObject({
      setCode: 'dmu',
      setName: 'Dominaria United',
      nameNorm: 'dominaria united set booster box',
      category: 'booster_box',
      subtype: 'set',
      cardmarketId: 657123,
      releasedAt: '2022-09-09',
    });
    expect(sealed[1]).toMatchObject({ cardmarketId: null, releasedAt: '2022-09-10' });
  });

  it('ignora los sets solo online', () => {
    expect(mapSetList([{ ...dmu, isOnlineOnly: true }], known).sealed).toHaveLength(0);
  });

  it('crea alias en español y de Cardmarket sin repetir el nombre inglés', () => {
    const one: MtgjsonSet = { code: 'ONE', name: 'Phyrexia: All Will Be One', mcmName: 'Phyrexia: All Will Be One', translations: { Spanish: 'Pirexia: Todos serán uno' } };
    const m10: MtgjsonSet = { code: 'M10', name: 'Magic 2010', mcmName: 'Magic 2010', translations: { Spanish: 'Magic 2010' } };
    expect(mapSetList([dmu, one, m10], known).aliases).toEqual([
      { aliasNorm: 'dominaria unida', setCode: 'dmu', source: 'mtgjson' },
      { aliasNorm: 'pirexia todos seran uno', setCode: 'one', source: 'mtgjson' },
    ]);
  });

  it('descarta alias ambiguos y de sets que no están en el catálogo', () => {
    const a: MtgjsonSet = { code: 'DMU', name: 'Dominaria United', translations: { Spanish: 'Colección' } };
    const b: MtgjsonSet = { code: 'M10', name: 'Magic 2010', translations: { Spanish: 'Colección' } };
    const unknown: MtgjsonSet = { code: 'XYZ', name: 'Nope', translations: { Spanish: 'Desconocida' } };
    expect(mapSetList([a, b, unknown], known).aliases).toEqual([]);
  });
});
