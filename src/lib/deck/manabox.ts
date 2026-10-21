import { normalizeName } from "@/lib/normalize";
import type { CardIdentifier, ImportRow } from "./types";

/**
 * Lectura de mazos: el CSV que exporta ManaBox o una lista pegada a mano.
 * Las cantidades mandan: una línea "17 Island" son 17 cartas.
 */

/** Campos de una línea CSV con comillas ("a, b" y comillas dobladas "") */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ¿Es un CSV de ManaBox? (cabecera con Name y Quantity) */
export function looksLikeManaBoxCsv(text: string): boolean {
  const header = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const cols = splitCsvLine(header).map((c) => c.toLowerCase());
  return cols.includes("name") && cols.includes("quantity");
}

/** CSV de ManaBox → líneas con cantidad, Scryfall ID, edición, número e idioma */
export function parseManaBoxCsv(text: string): { rows: ImportRow[]; errors: string[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = splitCsvLine(lines[0] ?? "").map((c) => c.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iName = col("name");
  const iQty = col("quantity");
  if (iName < 0 || iQty < 0) return { rows: [], errors: ["El CSV no tiene las columnas Name y Quantity de ManaBox"] };
  const iId = col("scryfall id");
  const iSet = col("set code");
  const iNum = col("collector number");
  const iLang = col("language");

  const rows: ImportRow[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((line, i) => {
    const f = splitCsvLine(line);
    const name = f[iName] ?? "";
    const quantity = Number.parseInt(f[iQty] ?? "", 10);
    if (!name || !Number.isFinite(quantity) || quantity < 1) {
      errors.push(`Línea ${i + 2}: sin nombre o sin cantidad`);
      return;
    }
    const id = iId >= 0 ? f[iId] : undefined;
    rows.push({
      name,
      quantity,
      ...(id && UUID.test(id) ? { scryfallId: id.toLowerCase() } : {}),
      ...(iSet >= 0 && f[iSet] ? { setCode: f[iSet]!.toLowerCase() } : {}),
      ...(iNum >= 0 && f[iNum] ? { collectorNumber: f[iNum] } : {}),
      ...(iLang >= 0 && f[iLang] ? { language: f[iLang] } : {}),
    });
  });
  return { rows, errors };
}

/**
 * Lista pegada, una carta por línea: "1 Sol Ring", "2x Island", "Sol Ring",
 * "1 Sol Ring (MSC) 248". Se ignoran las líneas vacías, los comentarios (#, //) y las
 * cabeceras de sección de Moxfield o Archidekt ("Commander", "Deck", "Sideboard:").
 */
export function parseCardList(text: string): { rows: ImportRow[]; errors: string[] } {
  const rows: ImportRow[] = [];
  const errors: string[] = [];
  const SECTION = /^(commander|deck|mainboard|main|sideboard|maybeboard|tokens?|companion)\s*:?\s*$/i;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//") || SECTION.test(line)) return;
    const m = /^(?:(\d+)\s*x?\s+)?(.+?)(?:\s+\(([A-Za-z0-9]{2,6})\)(?:\s+(\S+))?)?(?:\s+\*F\*)?$/.exec(line);
    const name = m?.[2]?.trim();
    if (!m || !name) {
      errors.push(`Línea ${i + 1}: no se entiende «${line}»`);
      return;
    }
    rows.push({
      name,
      quantity: m[1] ? Number.parseInt(m[1], 10) : 1,
      ...(m[3] ? { setCode: m[3].toLowerCase() } : {}),
      ...(m[3] && m[4] ? { collectorNumber: m[4] } : {}),
    });
  });
  return { rows, errors };
}

/** CSV de ManaBox o lista, según lo que parezca el texto */
export function parseDeckText(text: string): { rows: ImportRow[]; errors: string[] } {
  return looksLikeManaBoxCsv(text) ? parseManaBoxCsv(text) : parseCardList(text);
}

/** Clave de un identificador: une lo que se pidió con lo que devuelve la API */
export function identifierKey(id: CardIdentifier): string {
  if ("id" in id) return `id:${id.id.toLowerCase()}`;
  if ("set" in id) return `set:${id.set.toLowerCase()}:${id.collector_number}`;
  return `name:${normalizeName(id.name)}`;
}

/** La forma más precisa de pedir cada línea a Scryfall: id, después edición y número, después nombre */
export function identifierFor(row: ImportRow): CardIdentifier {
  if (row.scryfallId) return { id: row.scryfallId };
  if (row.setCode && row.collectorNumber) return { set: row.setCode, collector_number: row.collectorNumber };
  return { name: row.name };
}
