import type { StoreConfig } from "./types";

/**
 * Tiendas del worker. Es la fuente de verdad de la tabla `stores`: cada ejecución sin --dry-run
 * sincroniza las tiendas activadas (y la BD desactiva las demás).
 *
 * Origen de los datos: docs/tiendas.md (tiendas físicas de Barcelona y L'Hospitalet) y
 * docs/tiendas-online.json (tiendas online del resto de España). Selectores y filtros comprobados
 * contra las webs el 18/10/2026; las muestras recortadas están en src/worker/__tests__/fixtures/stores.
 *
 * Cada tienda tiene hasta dos fuentes:
 *   - "web": su web, si tiene website y platform. Las tiendas físicas de la zona venden ahí sellado
 *     (el emparejador clasifica cada listado); las online, también cartas sueltas.
 *       - Shopify: https://<tienda>/products.json devuelve JSON.
 *       - WooCommerce: https://<tienda>/wp-json/wc/store/v1/products devuelve JSON.
 *       - PrestaShop o una web a medida (o un WooCommerce sin Store API): platform "prestashop" o
 *         "html", con los selectores CSS de una página de categoría.
 *     Si la web no se puede rastrear, deja website (se enseña en la ficha) y pon platform: null.
 *   - "cardmarket_csv": el stock que la tienda exporta desde Cardmarket y nos manda, si tiene
 *     cardmarketUser. Va en data/cardmarket/<id>.csv (fuera de git) o, si la tienda lo publica en un
 *     enlace, en cardmarketCsv.url. Mientras no haya fichero, esa fuente no se ejecuta. Nunca se pide
 *     nada a cardmarket.com.
 *
 * Cómo añadir una tienda:
 *   1. Lee su robots.txt y sus condiciones de uso. Si no permiten el rastreo, no pongas platform (el
 *      worker la saltaría igualmente). Mejor aún: avisa a la tienda o pídele permiso, y apúntalo en `notes`.
 *   2. Copia una tienda que se le parezca con un id nuevo (un slug estable: si lo cambias, es otra
 *      tienda) y la URL final de su web (con https y tal como queda tras las redirecciones).
 *   3. Pruébala sin escribir en la BD:
 *        npm run worker -- --store <id> --dry-run --limit 50
 *        npm run worker -- --store <id> --dry-run --source cardmarket_csv --file <ruta del CSV>
 *   4. Si los listados salen bien (precio, stock, estado, idioma, enlace…), pon enabled: true.
 *
 * El worker pide como mucho una página por segundo, respeta robots.txt (también Crawl-delay, y
 * crawlDelaySeconds si la tienda pide ir más despacio) y se identifica con el User-Agent
 * "search-magic/0.1 (+contacto)": SEARCH_MAGIC_CONTACT o, si no está, la página del repositorio.
 */

/** Selectores de las fichas de un listado de WooCommerce (el precio rebajado gana al original) */
const WOO_PRICE = ".price ins .amount, .price > .amount";

export const STORES: StoreConfig[] = [
  // -------------------------------------------------------------------------
  // Tiendas físicas de Barcelona
  // -------------------------------------------------------------------------
  {
    id: "magic-barcelona",
    name: "Magic Barcelona",
    city: "Barcelona",
    province: "Barcelona",
    local: true,
    address: "Ronda de Sant Pere 44, 08010 Barcelona",
    website: "https://www.magicbarcelona.net",
    // WooCommerce con la Store API desactivada (404): se lee el HTML de la tienda
    platform: "html",
    cardmarketUser: "MagicBarcelona",
    enabled: true,
    notes:
      "WooCommerce sin Store API: HTML de /tienda/ filtrado por la categoría producto-sellado (18 por página, " +
      "unas 17 páginas). robots.txt solo bloquea /wp-admin/. Stock por la clase de cada producto del listado " +
      "(WooCommerce pone instock u outofstock). Sueltas en Cardmarket (MagicBarcelona): pedirle el CSV de stock.",
    webKind: "sealed",
    html: {
      // el menú "Tienda > Producto sellado" de la web
      startUrls: ["https://www.magicbarcelona.net/tienda/?swoof=1&product_cat=producto-sellado"],
      selectors: {
        item: ".product.type-product",
        title: ".entry-title a",
        price: WOO_PRICE,
        url: ".entry-title a",
        outOfStock: ".outofstock",
        // carga diferida: la foto va en data-src (src es un marcador data:…)
        image: "img.attachment-woocommerce_thumbnail",
      },
      // el <link rel=next> de la cabecera pierde el filtro; este enlace lo conserva
      nextPage: "a.nav-next",
    },
    cardmarketCsv: { file: "data/cardmarket/magic-barcelona.csv" },
  },
  {
    id: "ingenio",
    name: "inGenio BCN Games",
    city: "Barcelona",
    province: "Barcelona",
    local: true,
    address: "Pg. de Sant Joan 16, 08010 Barcelona",
    website: "https://www.ingeniobcn.com",
    // WooCommerce, pero su robots.txt quiere bloquear las URL con parámetros (Store API incluida)
    platform: "html",
    cardmarketUser: "inGenio",
    enabled: false,
    notes:
      "robots.txt: 'Disallow: / *?' (mal escrito, pero se entiende que no quiere URL con parámetros): nada de " +
      "Store API ni de ?product-page=N. Los selectores de abajo leen bien la categoría magic-the-gathering " +
      "(40 productos por página, solo sellado), pero no se activa: la paginación por ruta (/page/N/, el " +
      "<link rel=next>) devuelve siempre los mismos 40 productos (comprobado el 18/10/2026) y la de verdad es " +
      "?product-page=N. Pedirle permiso para la Store API o para ?product-page. Sueltas en Cardmarket " +
      "(inGenio): pedirle el CSV de stock.",
    html: {
      startUrls: ["https://www.ingeniobcn.com/magic-the-gathering/"],
      selectors: {
        item: "ul.products li.product",
        title: ".woocommerce-loop-product__title",
        price: WOO_PRICE,
        url: "a.woocommerce-LoopProduct-link",
        image: "a.woocommerce-LoopProduct-link img",
      },
      nextPage: "link[rel=next]",
    },
    cardmarketCsv: { file: "data/cardmarket/ingenio.csv" },
  },
  {
    id: "industria-61",
    name: "Industria 61",
    city: "Barcelona",
    province: "Barcelona",
    local: true,
    address: "C/ Indústria 61, 08025 Barcelona",
    website: "https://industria61.com",
    platform: "woocommerce",
    cardmarketUser: "Magic-Industria-61",
    enabled: true,
    notes:
      "Web solo con sellado (\"NO vendemos cartas sueltas directamente\"): Store API abierta y robots.txt de " +
      "WooCommerce por defecto. Categorías 329 (Material sellado: cajas, sobres, mazos, especiales) y 247 " +
      "(MTG preventa); se dejan fuera los lotes de cartas (246). Sueltas en Cardmarket (Magic-Industria-61): " +
      "pedirle el CSV de stock.",
    webKind: "sealed",
    woocommerce: { categories: ["329", "247"], variations: false },
    cardmarketCsv: { file: "data/cardmarket/industria-61.csv" },
  },
  {
    id: "el-nucli",
    name: "El Nucli",
    city: "Barcelona",
    province: "Barcelona",
    local: true,
    address: "C/ Valladolid 41, 08014 Barcelona",
    website: "https://www.elnucli.es",
    platform: "shopify",
    cardmarketUser: null,
    enabled: true,
    notes:
      "Shopify con el robots.txt por defecto. Colección magic-sellado (~700 productos; variantes por idioma). " +
      "Las sueltas las vende por presupuesto en pedidos@elnucli.es, no en la web ni en Cardmarket.",
    webKind: "sealed",
    shopify: { collections: ["magic-sellado"] },
  },
  {
    id: "dungeon-marvels",
    name: "Dungeon Marvels",
    city: "Barcelona",
    province: "Barcelona",
    local: true,
    address: "C/ d'Olzinelles 49, 08014 Barcelona",
    website: "https://dungeonmarvels.com",
    platform: "prestashop",
    cardmarketUser: null,
    enabled: false,
    notes:
      "PrestaShop; robots.txt deja las categorías y ?page=N (bloquea búsquedas y otros parámetros). Los " +
      "selectores de abajo funcionan, pero no se activa: el listado recorta los títulos ('Mazo de Commander " +
      "Señores de...') y no trae enlace a la página siguiente (paginación por JavaScript; 619 productos de " +
      "24 en 24), así que solo se leería la primera página. Haría falta leer cada ficha o generar ?page=N.",
    html: {
      startUrls: ["https://dungeonmarvels.com/185-magic"],
      selectors: {
        item: "#js-product-list article.product-miniature",
        title: ".product-title a",
        price: ".product-price-and-shipping .price",
        url: ".product-title a",
        stock: ".stock-tag",
        image: ".product-thumbnail img",
      },
    },
  },
  {
    id: "arco-tcg",
    name: "Arco TCG",
    city: "Barcelona",
    province: "Barcelona",
    local: true,
    address: "C/ d'Ausiàs Marc 53, 08010 Barcelona",
    website: "https://arcotcg.com",
    platform: null,
    cardmarketUser: null,
    enabled: false,
    notes:
      "WooCommerce; robots.txt solo bloquea add-to-cart. Dice vender sueltas de Magic, pero de momento solo " +
      "tiene Pokémon: volver a mirarla y, cuando tenga Magic, poner platform: \"woocommerce\" con su categoría.",
  },
  {
    id: "kaburi",
    name: "Kaburi Rol & Games",
    city: "Barcelona",
    province: "Barcelona",
    local: true,
    address: "Pg. de Sant Joan 11, 08010 Barcelona",
    website: "https://kaburi.es",
    platform: null,
    cardmarketUser: null,
    enabled: false,
    notes: "robots.txt 'Disallow: /': no se puede rastrear. Tiene también tiendas en C/ Sants 17 y C/ Alí Bei 10.",
  },
  {
    id: "gameria",
    name: "Gameria",
    city: "Barcelona",
    province: "Barcelona",
    local: true,
    address: "C/ d'Ausiàs Marc 52, 08010 Barcelona",
    website: null,
    platform: null,
    cardmarketUser: "GAMERIA",
    enabled: false,
    notes:
      "Sin web. Vende sueltas en Cardmarket (GAMERIA): activarla cuando nos mande su CSV de stock " +
      "(data/cardmarket/gameria.csv).",
    cardmarketCsv: { file: "data/cardmarket/gameria.csv" },
  },

  // -------------------------------------------------------------------------
  // Tiendas físicas de L'Hospitalet de Llobregat
  // -------------------------------------------------------------------------
  {
    id: "el-tesoro-del-dragon-blanco",
    name: "El Tesoro del Dragón Blanco",
    city: "L'Hospitalet de Llobregat",
    province: "Barcelona",
    local: true,
    address: "C/ de l'Aprestadora 110, 08902 L'Hospitalet de Llobregat",
    website: null,
    platform: null,
    cardmarketUser: null,
    enabled: false,
    notes: "Sin web (solo Facebook) ni usuario de Cardmarket conocido: tienda física de TCG con Magic.",
  },
  // NuncaEsDemasiado TCG (L'Hospitalet) no está: su web Shopify solo tiene Pokémon.

  // -------------------------------------------------------------------------
  // Tiendas online del resto de España (cartas sueltas en su web)
  // -------------------------------------------------------------------------
  {
    id: "el-duelista",
    name: "El Duelista",
    city: "Valladolid",
    province: "Valladolid",
    local: false,
    address: "Marina de Escobar 6, 47001 Valladolid",
    website: "https://www.elduelista.com",
    platform: "shopify",
    cardmarketUser: null,
    enabled: true,
    notes:
      "Shopify, robots.txt por defecto. Colección magic-single (~3.100). Variantes Language / Condition / " +
      "Edition (Normal o Foil Normal = acabado). Los títulos llevan U+2063 invisibles (se quitan).",
    webKind: "single",
    shopify: { collections: ["magic-single"] },
  },
  {
    id: "universe-tcg",
    name: "Universe TCG",
    city: "Mollet del Vallès",
    province: "Barcelona",
    local: false,
    address: "Gaietà Ventalló 34, Local 3, 08100 Mollet del Vallès",
    website: "https://www.universetcg.com",
    platform: "shopify",
    cardmarketUser: null,
    enabled: true,
    notes: "Shopify, robots.txt por defecto. Colección magic-single (~650), mismas variantes que El Duelista.",
    webKind: "single",
    shopify: { collections: ["magic-single"] },
  },
  {
    id: "mtg-canarias",
    name: "MTG Canarias",
    city: "Tacoronte",
    province: "Santa Cruz de Tenerife",
    local: false,
    address: "Calle Ismael Domínguez 11, Local 1, 38350 Tacoronte",
    website: "https://mtgcanarias.com",
    platform: "woocommerce",
    cardmarketUser: null,
    enabled: true,
    notes:
      "Store API abierta, robots.txt de WooCommerce por defecto. Categoría 400 (cartas sueltas: ~42.500 " +
      "fichas, ~9.500 con stock; ~425 páginas de 100). Productos variables Estado × Foil × Idioma: sin pedir " +
      "las variaciones, un listado por ficha con el precio mínimo y el stock de la ficha; estado, idioma y " +
      "acabado solo si todas sus variaciones coinciden. Edición por el atributo Conjunto (código) y " +
      "tratamiento (Borderless, Showcase…) al título. Envíos desde Canarias: fuera del IVA de la UE.",
    webKind: "single",
    woocommerce: { categories: ["400"], variations: false },
  },
  {
    id: "rebellion",
    name: "Rebellion (Tienda Rebel)",
    city: "Móstoles",
    province: "Madrid",
    local: false,
    address: "Avda. Portugal 21, posterior, local 4, Móstoles",
    website: "https://www.rebellion.es/tiendarebel/",
    platform: "html",
    cardmarketUser: null,
    enabled: false,
    notes:
      "PHP antiguo en ISO-8859-1; robots.txt sin grupo para '*' (bloquea ~150 robots concretos, no a " +
      "nosotros). Lector propio (adapters/rebellion.ts): una fila por carta con variantes por idioma, estado " +
      "y foil. No se activa: cada edición pagina de 25 en 25 con la sesión PHP (sin cookie, ?pag=2 sale " +
      "vacía; el tamaño de página es una preferencia de sesión por POST), así que solo se leerían las 25 " +
      "primeras cartas de cada una de sus 466 ediciones y todas las ejecuciones quedarían parciales.",
    html: {
      startUrls: ["https://www.rebellion.es/tiendarebel/index.php"],
      selectors: {
        // fila de cada carta; precio, estado e idioma, en cada fila de su subtabla de variantes
        item: "table.tablaCartas > tbody > tr:has(a.presentarcarta)",
        title: "a.presentarcarta",
        price: "td[onmouseout] font",
        condition: "td[width='35px']",
        language: "img[src*='/flag/']@title",
        // miniatura recortada (45 × 30) de la ilustración
        image: "img[src*='/card/']",
      },
      // menú "MAGIC cartas sueltas": una página por edición (verampliacion.php?idAmpl=<id>)
      nextPage: "#cat1 a.linklateral[href*='verampliacion.php?idAmpl=']",
      encoding: "windows-1252",
    },
  },
  {
    id: "itaca",
    name: "Itaca.gg",
    city: "Madrid",
    province: "Madrid",
    local: false,
    address: "Calle Blasco de Garay 15, Local 1, 28015 Madrid",
    website: "https://itaca.gg",
    platform: null,
    cardmarketUser: null,
    enabled: false,
    notes:
      "Pendiente de permiso del propietario: sus condiciones prohíben copiar o explotar el material del " +
      "sitio. Web a medida con JSON-LD Product (ofertas Normal/Foil), Crawl-delay 5; permite " +
      "/magic/expansions y /magic/products/singles/*. Con permiso: platform \"html\" desde /magic/expansions.",
  },
  {
    id: "disfrutalo-tcg",
    name: "Disfrutalo TCG",
    city: "Elda",
    province: "Alicante",
    local: false,
    address: "C. Reyes Católicos 24, bajo, 03600 Elda",
    website: "https://disfrutalo-tcg.com",
    platform: null,
    cardmarketUser: null,
    enabled: false,
    notes:
      "Pendiente de permiso del propietario: sus condiciones prohíben la explotación sin consentimiento y su " +
      "robots.txt bloquea a ClaudeBot. PrestaShop (categoría /es/5-magic-cartas-sueltas, ~280 sueltas; estado " +
      "en el título, idioma solo en la ficha).",
  },
  {
    // Con Crawl-delay 10 tarda unas 3 h: va aparte (slow), en el job semanal del workflow.
    id: "el-rincon-de-magic",
    name: "El Rincón de Magic",
    city: "Daganzo de Arriba",
    province: "Madrid",
    local: false,
    address: null,
    website: "https://www.elrincondemagic.com",
    platform: "html",
    cardmarketUser: null,
    enabled: true,
    notes:
      "Tienda ePages solo online. robots.txt bloquea búsquedas y facetas (ViewAction=…Search…, /rs/*) y pide " +
      "Crawl-delay 10 a 'pricebot': se respeta. Una categoría por edición (~147, ~300 fichas cada una, 48 por " +
      "página): unas 1.000 páginas, ~3 h por ejecución. Precio 'desde' (la variante más barata) y sin stock en " +
      "el listado (se da por disponible); alguna ficha sale sin precio y se descarta (3 de 48 en la primera " +
      "página de Realidad Fracturada). No cabe en el job de cada 8 h (60 min): slow, job semanal propio.",
    crawlDelaySeconds: 10,
    slow: true,
    webKind: "single",
    html: {
      startUrls: ["https://www.elrincondemagic.com/Cartas-Sueltas"],
      selectors: {
        item: ".ProductListImageBox .InfoArea[itemscope]",
        title: "h3 a",
        price: "[itemprop=price]@content",
        url: "h3 a",
        image: "img.ProductSmallImage",
      },
      // las ediciones (subcategorías) y, dentro de cada una, la página siguiente
      nextPage: ".ListItemCategory h3 a, a[rel=next][title=Siguiente]",
    },
  },
];
