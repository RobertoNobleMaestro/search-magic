import { getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

/** `SET col = excluded.col` para un upsert, a partir de las claves TS de la tabla. */
export function excluded<T extends PgTable>(table: T, keys: (keyof T['$inferInsert'] & string)[]): Record<string, SQL> {
  const columns = getTableColumns(table) as Record<string, { name: string }>;
  return Object.fromEntries(keys.map((key) => [key, sql.raw(`excluded."${columns[key]!.name}"`)]));
}

/**
 * Lista de valores como un único parámetro de texto: `= any(${textArray(ids)}::uuid[])`.
 * Evita depender de cómo expande Drizzle los arrays dentro de `sql`.
 */
export function textArray(values: readonly string[]): SQL {
  return sql`string_to_array(${values.join('\u001f')}, ${'\u001f'})`;
}

export async function inBatches<T>(rows: readonly T[], size: number, write: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await write(rows.slice(i, i + size));
  }
}
