/**
 * Worker: recorre las tiendas activadas de stores.config.ts y cada una de sus fuentes (su web y el CSV
 * de stock de Cardmarket) y guarda sus listados.
 *
 *   npm run worker                              # las tiendas activadas (menos las lentas), todas sus fuentes
 *   npm run worker -- --slow                    # solo las lentas (slow: true; El Rincón, ~3 h)
 *   npm run worker -- --store <id>              # solo una (con --dry-run, aunque esté desactivada)
 *   npm run worker -- --source web              # solo una fuente: web o cardmarket_csv
 *   npm run worker -- --store <id> --file x.csv # importa ese CSV de Cardmarket para la tienda
 *   npm run worker -- --store <id> --dry-run    # sin escribir en la BD: una muestra (50 listados por web)
 *   npm run worker -- --dry-run                 # valida la configuración y enseña el plan, sin red
 *   npm run worker -- --limit 50                # como mucho 50 listados por ejecución
 *   npm run worker -- --max-minutes 50          # a los 50 min cierra lo que esté en curso como parcial
 *
 * El User-Agent lleva SEARCH_MAGIC_CONTACT o, si no está, la página del repositorio.
 * Termina con código 1 si los argumentos o la configuración no son válidos, si falta el contacto o si
 * fallan todas las ejecuciones.
 */
import { main } from "./cli";
import { errorMessage } from "./text";

/** Sale sin esperar a que el pool de Postgres cierre sus conexiones, pero después de vaciar la salida. */
function exit(code: number): void {
  process.exitCode = code;
  process.stderr.write("", () => process.stdout.write("", () => process.exit(code)));
}

main(process.argv.slice(2)).then(exit, (error: unknown) => {
  console.error(`[worker] ${errorMessage(error)}`);
  exit(1);
});
