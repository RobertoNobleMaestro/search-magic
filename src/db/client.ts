import { attachDatabasePool } from '@vercel/functions';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { appDatabaseUrl } from './env';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type DbConnection = { db: Db; pool: pg.Pool };

export function createDb(connectionString: string, options: { max?: number } = {}): DbConnection {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  return { db: drizzle({ client: pool, schema }), pool };
}

const globalForDb = globalThis as typeof globalThis & { __searchMagicDb?: DbConnection };

/**
 * Conexión de la web (pooled). Se crea al primer uso, así el build no necesita BD,
 * y se reutiliza entre recargas de Next en desarrollo.
 */
export function getDb(): Db {
  if (!globalForDb.__searchMagicDb) {
    const conn = createDb(appDatabaseUrl());
    // En Vercel Fluid compute, cierra las conexiones ociosas antes de suspender la función.
    if (process.env.VERCEL) attachDatabasePool(conn.pool);
    globalForDb.__searchMagicDb = conn;
  }
  return globalForDb.__searchMagicDb.db;
}
