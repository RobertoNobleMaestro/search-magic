import { defineConfig } from 'drizzle-kit';
import { directDatabaseUrl, loadLocalEnv } from './src/db/env';

loadLocalEnv();

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  // Las migraciones van por la conexión directa: PgBouncer no mantiene estado de sesión.
  dbCredentials: { url: directDatabaseUrl() },
  strict: true,
  verbose: true,
});
