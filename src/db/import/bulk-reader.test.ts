import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { readBulkCards } from './bulk-reader';

const dir = mkdtempSync(join(tmpdir(), 'bulk-reader-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const cards = [
  { id: 'a', name: 'Lightning Bolt', lang: 'en' },
  { id: 'b', name: 'Lightning Bolt', printed_name: 'Rayo', lang: 'es' },
  { id: 'c', name: 'Counterspell', lang: 'ja' },
];

async function collect(file: string, prefilter?: string) {
  const out = [];
  for await (const card of readBulkCards(file, prefilter)) out.push(card.id);
  return out;
}

describe('readBulkCards', () => {
  it('lee JSONL comprimido, que es lo que publica Scryfall', async () => {
    const file = join(dir, 'cards.jsonl.gz');
    writeFileSync(file, gzipSync(cards.map((c) => JSON.stringify(c)).join('\n') + '\n'));
    expect(await collect(file)).toEqual(['a', 'b', 'c']);
    expect(await collect(file, '"lang":"es"')).toEqual(['b']);
  });

  it('lee JSONL sin comprimir', async () => {
    const file = join(dir, 'cards.jsonl');
    writeFileSync(file, cards.map((c) => JSON.stringify(c)).join('\n'));
    expect(await collect(file)).toEqual(['a', 'b', 'c']);
  });

  it('lee el formato antiguo (array con un objeto por línea)', async () => {
    const file = join(dir, 'lines.json');
    writeFileSync(file, `[\n${cards.map((c) => JSON.stringify(c)).join(',\n')}\n]\n`);
    expect(await collect(file)).toEqual(['a', 'b', 'c']);
    expect(await collect(file, '"lang":"es"')).toEqual(['b']);
  });

  it('tolera saltos de línea CRLF', async () => {
    const file = join(dir, 'crlf.json');
    writeFileSync(file, `[\r\n${cards.map((c) => JSON.stringify(c)).join(',\r\n')}\r\n]\r\n`);
    expect(await collect(file)).toEqual(['a', 'b', 'c']);
  });

  it('recurre al parser en streaming si el JSON está minificado o indentado', async () => {
    const minified = join(dir, 'minified.json');
    writeFileSync(minified, JSON.stringify(cards));
    expect(await collect(minified)).toEqual(['a', 'b', 'c']);

    const pretty = join(dir, 'pretty.json');
    writeFileSync(pretty, JSON.stringify(cards, null, 2));
    expect(await collect(pretty)).toEqual(['a', 'b', 'c']);

    const prettyGz = join(dir, 'pretty.json.gz');
    writeFileSync(prettyGz, gzipSync(JSON.stringify(cards, null, 2)));
    expect(await collect(prettyGz)).toEqual(['a', 'b', 'c']);
  });
});
