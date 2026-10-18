# Diseño visual

Maqueta del diseño de search-magic y los tokens para llevarlo a la web (Next.js + Tailwind 4).

| Archivo | Qué es |
| --- | --- |
| [index.html](index.html) | Maqueta navegable de todas las pantallas, en escritorio y en móvil, con modo claro y oscuro, notas para la integración y el sistema de diseño |
| [theme.css](theme.css) | Tokens para pegar en `src/app/globals.css`: colores, fuentes, sombras y utilidades |

## Cómo verla

Se abre `index.html` con doble clic. Hace falta conexión, porque Tailwind (versión para navegador), las fuentes de Google y las imágenes de Scryfall se cargan de internet.

- Arriba se elige la pantalla, la vista de escritorio o de móvil (390 px) y el tema.
- Los filtros, las ediciones, el autocompletado del buscador y los enlaces funcionan con datos de ejemplo.
- `index.html?embed=1&view=carta&theme=dark` muestra una pantalla sola, sin la barra de la maqueta.

Las cartas, ediciones, imágenes y precios de Cardmarket son reales (los de `src/lib/data/fixtures/scryfall-sample.json`). Las tiendas y sus ofertas son inventadas: son las mismas de `src/lib/data/mock.ts`.

## Decisiones

- **El precio manda.** Siempre a la derecha, en grande y con `tabular-nums`. La oferta más barata con stock lleva «Mejor precio» en dorado, y el dorado no se usa para nada más.
- **Comparación con Cardmarket.** El % solo sale en verde si la tienda está al menos un 5 % por debajo. Si está por encima, sale en gris: comprar en mano no tiene envío y no queremos castigar a la tienda de barrio.
- **Lo dudoso se enseña.** Una edición sin identificar, un estado desconocido, una «edición probable» (confianza < 1) o datos de más de 24 h salen marcados como tales, nunca se esconden.
- **Convenciones de Cardmarket.** La escala de estados MT…PO usa sus colores, porque los jugadores ya la conocen. El color siempre va con el código y el nombre completo.
- **Tipografía.** Fraunces para los nombres de carta y los títulos, Geist para la interfaz y Geist Mono para los códigos de edición.
- **Color.** Violeta de maná para las acciones, fondo cálido de papel en claro y azul tinta en oscuro.

## Integración

1. Pegar [theme.css](theme.css) en `src/app/globals.css`, debajo de `@import "tailwindcss";`.
2. Cargar las fuentes con `next/font/google`: `Geist`, `Geist_Mono` y `Fraunces` (con cursiva), con las variables `--font-geist-sans`, `--font-geist-mono` y `--font-fraunces` en `<html>`.
3. Cambiar las constantes de `src/components/ui.tsx` (`buttonClass`, `panelClass`, `linkClass`…) por las del objeto `UI` del script de `index.html`. Así dejan de usar `violet-*` y `neutral-*` y pasan a los tokens.
4. Pasar a componentes de React las funciones del script (`condBadge`, `langChip`, `finishChip`, `setChip`, `bestBadge`, `freshness`, `priceBlock`, `offerRow`, `offerCard`, `storeStatus`…). Ya usan clases de Tailwind y las clases de cada estado están en mapas con clases literales (`COND_CLASS`, `STATUS_CLASS`), para que Tailwind las encuentre al compilar.
5. Los iconos son de Lucide: en la web, `lucide-react` con los mismos nombres.

La maqueta usa las rutas `/buscar?q=`, `/carta/[slug]`, `/sellado/[edición]`, `/tiendas` y `/panel` solo como ejemplo. Los parámetros de los filtros sí son los de `src/components/offers/filters.ts`.

## Propuestas que todavía no están en el contrato de datos

- **Producto sellado.** Su catálogo de MTGJSON se está montando. Los tipos de producto y los nombres pueden cambiar.
- **Acciones del panel interno.** «Asignar», «Buscar otra», «Descartar» y «Lanzar ahora» guardarían una corrección que leería `getOverride`, o lanzarían una ejecución.
- **Ir directo a la carta** cuando una búsqueda da un único resultado exacto.
- **Tiendas online de toda España.** Cuando entren, el filtro «Ciudad» pasaría a ser «Dónde», con una opción «Online».
