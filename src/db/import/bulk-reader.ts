import { closeSync, createReadStream, openSync, readSync } from 'node:fs';
import { pipeline, type Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { streamArray } from 'stream-json/streamers/stream-array.js';
import type { ScryfallCard } from './scryfall-map';

/**
 * Lee un fichero de bulk data de Scryfall carta a carta sin cargarlo entero en memoria.
 *
 * Formatos admitidos, comprimidos con gzip o no:
 * - JSONL (lo que publica Scryfall hoy: `jsonl_download_uri`, un objeto por línea);
 * - array JSON con un objeto por línea (el formato antiguo de `download_uri`);
 * - cualquier otro JSON con un array en la raíz, con un parser en streaming (más lento).
 *
 * En los dos primeros se lee por líneas y `linePrefilter` descarta sin parsear las que
 * no contienen ese texto (por ejemplo '"lang":"es"' sobre all_cards).
 */
export async function* readBulkCards(file: string, linePrefilter?: string): AsyncGenerator<ScryfallCard> {
  if (await isLineDelimited(file)) {
    yield* readByLines(file, linePrefilter);
  } else {
    yield* readByJsonStream(file);
  }
}

function isGzip(file: string): boolean {
  const fd = openSync(file, 'r');
  try {
    const magic = Buffer.alloc(2);
    return readSync(fd, magic, 0, 2, 0) === 2 && magic[0] === 0x1f && magic[1] === 0x8b;
  } finally {
    closeSync(fd);
  }
}

function openText(file: string): Readable {
  const raw = createReadStream(file);
  return isGzip(file) ? pipeline(raw, createGunzip(), () => {}) : raw;
}

const isObjectLine = (line: string) => line.startsWith('{') && /\},?$/.test(line);

async function isLineDelimited(file: string): Promise<boolean> {
  const input = openText(file);
  const rl = createInterface({ input, crlfDelay: Infinity });
  const lines: string[] = [];
  for await (const line of rl) {
    if (line.trim()) lines.push(line.trim());
    if (lines.length === 2) break;
  }
  rl.close();
  input.destroy();
  const [first, second] = lines;
  if (!first) return false;
  if (isObjectLine(first)) return true; // JSONL
  return first === '[' && !!second && isObjectLine(second); // array con un objeto por línea
}

async function* readByLines(file: string, linePrefilter?: string): AsyncGenerator<ScryfallCard> {
  const rl = createInterface({ input: openText(file), crlfDelay: Infinity });
  let lineNo = 0;
  for await (const raw of rl) {
    lineNo++;
    const line = raw.trim();
    if (line === '[' || line === ']' || line === '') continue;
    if (linePrefilter && !line.includes(linePrefilter)) continue;
    const json = line.endsWith(',') ? line.slice(0, -1) : line;
    try {
      yield JSON.parse(json) as ScryfallCard;
    } catch (err) {
      throw new Error(`${file}:${lineNo}: no es un objeto JSON completo (${(err as Error).message})`);
    }
  }
}

async function* readByJsonStream(file: string): AsyncGenerator<ScryfallCard> {
  const items = pipeline(openText(file), streamArray.withParserAsStream(), () => {});
  for await (const { value } of items as AsyncIterable<{ value: ScryfallCard }>) {
    yield value;
  }
}
