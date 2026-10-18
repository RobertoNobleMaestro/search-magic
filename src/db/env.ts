import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// Solo para scripts (migraciones, importación, worker): usa `fs` y no debe entrar en el bundle de Next.
export { appDatabaseUrl, directDatabaseUrl } from './urls';

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
