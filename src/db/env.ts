import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * Carga .env.local y .env para los scripts que corren fuera de Next (migraciones,
 * importación, worker). No pisa variables ya definidas: en CI mandan los secretos.
 */
export function loadLocalEnv(): void {
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

/**
 * pg avisa de que `sslmode=require` pasará a tener la semántica débil de libpq.
 * Neon tiene certificados públicos válidos, así que fijamos el comportamiento actual.
 */
function withVerifiedSsl(url: string): string {
  return url.replace(/([?&])sslmode=(require|prefer|verify-ca)\b/, '$1sslmode=verify-full');
}

/** Conexión de la aplicación: pooled (PgBouncer) en Neon. */
export function appDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL. Copia .env.example a .env.local.');
  return withVerifiedSsl(url);
}

/** Conexión directa, sin pooler: migraciones e importaciones largas. */
export function directDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL_UNPOOLED o DATABASE_URL. Copia .env.example a .env.local.');
  return withVerifiedSsl(url);
}
