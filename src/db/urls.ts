/**
 * URLs de conexión a partir del entorno. Sin `fs`: lo importa client.ts, que acaba en el
 * bundle del servidor de Next. La carga de .env.local para scripts está en ./env.ts.
 */

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
