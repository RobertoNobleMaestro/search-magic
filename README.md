# search-magic

Buscador y comparador de precios de Magic: The Gathering centrado en las tiendas físicas de Barcelona
y L'Hospitalet de Llobregat, y ampliado a las tiendas online de toda España. Escribes el nombre de una
carta (en inglés o en español) o de un producto sellado y ves qué tiendas lo tienen, a qué precio, en
qué estado e idioma y con enlace a la tienda, del más barato al más caro.

De dónde salen los datos:

| Qué | Fuente |
| --- | --- |
| Catálogo de cartas, imágenes y precio de referencia | [Scryfall](https://scryfall.com) (el precio es el de Cardmarket) |
| Catálogo de producto sellado | [MTGJSON](https://mtgjson.com) |
| Sellado de las tiendas físicas | Su web, rastreada respetando robots.txt y a una página por segundo |
| Cartas sueltas de las tiendas físicas | El stock que cada tienda exporta desde Cardmarket y nos comparte (CSV) |
| Cartas sueltas y sellado de las tiendas online | Su web |

Las tiendas físicas de la zona no publican sus cartas sueltas en su web: las venden por Cardmarket o
en el mostrador (ver [docs/tiendas.md](docs/tiendas.md)).

## Primeros pasos

```bash
npm install
cp .env.example .env.local      # y rellena lo que necesites (ver la tabla)
npm run dev                     # http://localhost:3000
```

Sin base de datos, la web funciona con datos de ejemplo (`DATA_SOURCE=mock`): cartas y productos reales,
pero pocos, y tiendas inventadas. Para el catálogo completo y las ofertas reales, monta la base de datos
(sección siguiente) y pon `DATA_SOURCE=db`.

| Variable | Para qué |
| --- | --- |
| `DATA_SOURCE` | `mock` (datos de ejemplo, por defecto) o `db` |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Conexión a PostgreSQL (ver [Base de datos](#base-de-datos)) |
| `SEARCH_MAGIC_CONTACT` | Opcional. Contacto (correo o URL) que va en el User-Agent hacia Scryfall, MTGJSON y las tiendas, y en la página de tiendas. Si no está, se usa la página del repositorio de GitHub |
| `ADMIN_PASSWORD` | Protege `/admin` con HTTP Basic (usuario cualquiera). Si está vacía, el panel queda abierto: solo para local |

Comandos: `npm run dev`, `npm run build`, `npm start`, `npm test` (tests unitarios),
`npm run typecheck` y `npm run worker` (ver [Worker](#worker)).

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

El User-Agent lleva un contacto, como pide Scryfall: `SEARCH_MAGIC_CONTACT` si lo pones en `.env.local` o,
si no, la página del repositorio.

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

## Web

Next.js 16 (App Router) y Tailwind 4. Las páginas solo consultan la base de datos, nunca las tiendas en directo.

| Ruta | Qué enseña |
| --- | --- |
| `/` | Buscador con autocompletado (desde 3 letras; nombres en inglés y en español) |
| `/buscar?q=` | Resultados: cartas sueltas y producto sellado |
| `/carta/[id]` | Ofertas de una carta, de la más barata a la más cara, con la diferencia frente a Cardmarket. Filtros: solo tiendas físicas, ciudad, stock, acabado, idioma, estado mínimo y edición |
| `/sellado`, `/sellado/[id]` | Producto sellado y sus ofertas, con los filtros que le aplican |
| `/tiendas`, `/tiendas/[id]` | Tiendas físicas y online, qué venden y cuándo se revisaron por última vez |
| `/admin` | Panel interno: última ejecución de cada tienda y fuente, y listados sin emparejar |

El acceso a datos está en `src/lib/data/`: `types.ts` es el contrato, `mock.ts` los datos de ejemplo y
`repository.ts` la implementación sobre PostgreSQL. El emparejamiento de títulos está en
`src/lib/matching/`. El diseño visual sale de la maqueta de [design/](design/README.md).

## Worker

`src/worker/` recorre las tiendas de `src/worker/stores.config.ts`, empareja cada listado con el catálogo
y lo guarda en la base de datos.

```bash
npm run worker -- --dry-run                       # valida la configuración y enseña el plan (no sale a internet)
npm run worker -- --store el-nucli --dry-run      # rastrea una tienda sin escribir (50 listados como mucho)
npm run worker -- --store el-nucli                # rastrea una tienda y la guarda
npm run worker                                    # todas las tiendas activadas, menos las lentas
npm run worker -- --slow                          # solo las lentas (slow: true)
npm run worker -- --store magic-barcelona --file stock.csv   # importa un CSV de Cardmarket
```

Más opciones: `--source web|cardmarket_csv`, `--all` (con `--dry-run`, rastrear de verdad todas),
`--limit <n>` y `--max-minutes <n>`. Para escribir en la base de datos hace falta `DATA_SOURCE=db`.

Fuentes de cada tienda:

- **Web**: adaptadores para Shopify (`/products.json`), WooCommerce (Store API) y HTML con selectores
  (PrestaShop y webs a medida), más uno propio para Rebellion.
- **Stock de Cardmarket**: el CSV que exporta la tienda, en `data/cardmarket/<id>.csv` (fuera de git) o en
  un enlace que publique (`cardmarketCsv.url`). Se empareja de forma exacta por el id de producto de
  Cardmarket. Nunca se hace ninguna petición a cardmarket.com.

Rastreo responsable: respeta robots.txt (también `Crawl-delay`), pide como mucho una página por segundo a
cada dominio, se identifica con el User-Agent `search-magic/0.1 (+<contacto>)` (el de `SEARCH_MAGIC_CONTACT`
o, si no está, la página del repositorio), reintenta con
esperas crecientes y no guarda el rastreo en disco. Cada ejecución termina en `ok`, `partial` (fallaron
páginas, se paró en `--limit` o se interrumpió), `error` o `skipped` (robots.txt no lo permite, o el CSV
no ha cambiado). Solo una ejecución `ok` marca como agotado lo que ya no aparece.

En producción lo lanza `.github/workflows/scrape.yml`: cada 8 horas las tiendas normales, y los lunes las
lentas (El Rincón de Magic, con Crawl-delay de 10 s). Necesita el secreto `DATABASE_URL` (la conexión
pooled de producción) en el repositorio de GitHub; `SEARCH_MAGIC_CONTACT` es opcional.

### Añadir una tienda

1. Lee su robots.txt y sus condiciones de uso. Si no permiten el rastreo, no la actives. Mejor aún:
   pide permiso a la tienda y apúntalo en `notes`.
2. Añádela a `src/worker/stores.config.ts` copiando una de la misma plataforma: `id` (un slug estable),
   nombre, ciudad, provincia, `local` (tienda física en Barcelona o L'Hospitalet), dirección, web,
   plataforma y, si vende en Cardmarket, `cardmarketUser`.
3. Pruébala sin escribir en la base de datos: `npm run worker -- --store <id> --dry-run --limit 50`.
4. Si el precio, el stock, el estado, el idioma y los enlaces salen bien, pon `enabled: true`.

### Stock de Cardmarket de una tienda

Las tiendas de la zona venden sus cartas sueltas por Cardmarket. Si una tienda acepta compartir su stock:

1. La tienda exporta su stock desde Cardmarket (un CSV) y nos lo manda, o lo publica en un enlace fijo.
2. Guárdalo como `data/cardmarket/<id>.csv`, o pon el enlace en `cardmarketCsv.url` de su entrada.
3. Impórtalo con `npm run worker -- --store <id> --source cardmarket_csv` (o `--file <ruta>` para un
   fichero suelto).

## Datos y avisos

- Datos e imágenes de cartas: [Scryfall](https://scryfall.com). Precio de referencia: Cardmarket, a
  través de Scryfall. Producto sellado: [MTGJSON](https://mtgjson.com) (licencia MIT).
- Las tiendas activadas y desactivadas (con el motivo: robots.txt, permiso pendiente, sin web…) están en
  `src/worker/stores.config.ts`. La investigación de tiendas, en [docs/tiendas.md](docs/tiendas.md) y
  [docs/tiendas-online.json](docs/tiendas-online.json).
- search-magic es contenido de fans no oficial, permitido por la
  [Política de contenido de fans](https://company.wizards.com/en/legal/fancontentpolicy) de Wizards of
  the Coast. No está aprobado ni respaldado por Wizards. Algunas partes de los materiales utilizados son
  propiedad de Wizards of the Coast. ©Wizards of the Coast LLC.
