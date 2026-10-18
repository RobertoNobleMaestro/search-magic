# search-magic

## Base de datos

PostgreSQL con Drizzle ORM y `pg_trgm` para la búsqueda aproximada. En producción está en
[Neon](https://neon.tech). Para desarrollar puedes usar una rama de Neon o un Postgres local con Docker.

### Puesta en marcha

Con Postgres local (sin cuenta de Neon):

```bash
cp .env.example .env.local
docker compose up -d
npm install
npm run db:migrate              # crea las tablas y la extensión pg_trgm
npm run db:import               # catálogo de Scryfall (~480 MB comprimidos, ~2 min) y producto sellado de MTGJSON
```

Con Neon (si tienes acceso al proyecto):

```bash
neon link                       # una vez
neon checkout dev               # escribe DATABASE_URL y DATABASE_URL_UNPOOLED en .env.local
npm run db:migrate
npm run db:import
```

La web usa `DATABASE_URL` (en Neon, la conexión pooled). Las migraciones y la importación usan
`DATABASE_URL_UNPOOLED` (conexión directa), porque PgBouncer no conserva el estado de sesión.

### Importación de Scryfall

`npm run db:import:scryfall` descarga el bulk data a `data/bulk/` (está en `.gitignore`) y lo vuelca a la BD:

- `default_cards` → ediciones, cartas, nombres en inglés, impresiones y precios de Cardmarket (`prices.eur` / `prices.eur_foil`).
- `all_cards` → todos los nombres impresos en español distintos de cada carta (solo las líneas con `"lang":"es"`).

Solo se importa lo que haya cambiado desde la última vez. `all_cards` pesa unos 400 MB, así que se
salta si se importó hace menos de 7 días y no han salido ediciones nuevas. Opciones: `-- --force` y
`-- --only=default|es`. El workflow `.github/workflows/scryfall-import.yml` lo ejecuta cada día contra producción.

Pon `SEARCH_MAGIC_CONTACT` en `.env.local`: va en el User-Agent, como pide Scryfall.

### Producto sellado (MTGJSON)

`npm run db:import:mtgjson` descarga `SetList.json.gz` de [MTGJSON](https://mtgjson.com) (unos 2,5 MB) y carga:

- `sealed_products`: sobres, cajas, bundles, mazos… (unos 4.000), con categoría, subtipo, edición
  y, cuando existe, el id de producto de Cardmarket. Quedan fuera las colecciones de canje de MTGO y los sets solo online.
- `set_aliases` con `source = 'mtgjson'`: los nombres de las ediciones en español ("Dominaria Unida") y
  los que usa Cardmarket. Se regeneran en cada importación. Los alias `manual` no se tocan nunca.

Solo se importa si MTGJSON ha publicado datos nuevos (`-- --force` para forzarlo). Necesita las
ediciones de Scryfall, así que va después: `npm run db:import` ejecuta las dos importaciones en orden.

Los datos de MTGJSON se distribuyen con licencia MIT (Copyright © 2018-present, Zach Halpern).

### Esquema

| Tabla | Contenido |
| --- | --- |
| `sets`, `set_aliases` | Ediciones de Scryfall y nombres alternativos que usan las tiendas ("Dominaria Unida" → `dmu`) |
| `cards` | Carta conceptual (`oracle_id`) con su nombre en inglés y en español |
| `card_names` | Nombres buscables en inglés y español, completos y por cara, con índice trigram |
| `printings` | Una fila por impresión (`scryfall_id`) con acabados, variantes, precio e id de producto de Cardmarket |
| `sealed_products` | Producto sellado de MTGJSON (sobres, cajas, bundles, mazos…) |
| `stores` | Tiendas, sincronizadas desde `stores.config.ts`. `is_local` distingue las de Barcelona y L'Hospitalet de las tiendas online del resto de España |
| `scrape_runs` | Resultado de cada ejecución, por tienda y fuente (`web` o `cardmarket_csv`) |
| `listings` | Listados de las tiendas: cartas sueltas (`kind = 'single'`) o sellado (`'sealed'`), con precio, stock, estado, idioma, acabado y emparejamiento |
| `match_overrides` | Correcciones manuales del emparejamiento (por tienda y título normalizado) |
| `unmatched_listings` | Vista con los listados sin emparejar, que no se muestran en la web |
| `scryfall_imports` | Registro de importaciones de Scryfall y MTGJSON |

Una tienda puede tener dos fuentes a la vez: su web (rastreada) y el stock que exporta de Cardmarket
(un CSV que nos pasa). Cada listado guarda su fuente, y una pasada completa de una fuente solo marca
como agotado lo que falta de esa misma fuente. Con el stock de Cardmarket, el emparejamiento es exacto
por `cardmarket_id`, sin interpretar títulos.

El estado de la carta usa la escala de Cardmarket (`MT > NM > EX > GD > LP > PL > PO`) como enum
ordenado: el filtro "estado mínimo" es `condition >= 'EX'`.

Para cambiar el esquema, edita `src/db/schema.ts` y ejecuta `npm run db:generate` (crea la migración
en `src/db/migrations/`) y después `npm run db:migrate`. Prueba las migraciones en una rama de Neon
antes de llevarlas a producción.

### Tests

- `npm test`: tests unitarios, sin BD.
- `npm run test:db`: integración del repositorio contra la BD de `.env.local`, con el catálogo ya
  importado. Corre dentro de una transacción que se deshace al final.
