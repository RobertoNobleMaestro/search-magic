# Tiendas de Magic en Barcelona y L'Hospitalet

Investigación del 18/10/2026. Para cada web se pidió solo la portada, el robots.txt y, como mucho, un endpoint de la plataforma, con un User-Agent identificado y 1 petición por segundo.

**Conclusión:** ninguna tienda física de la zona vende **cartas sueltas** de Magic en su propia web. Las tiendas de Magic las venden por Cardmarket o en el mostrador. En sus webs solo hay producto sellado y accesorios.

## Barcelona

| Tienda | Dirección | Web | Plataforma | robots.txt | Sueltas de Magic en su web |
| --- | --- | --- | --- | --- | --- |
| Magic Barcelona | Ronda de Sant Pere 44, 08010 | [magicbarcelona.net](https://www.magicbarcelona.net/) | WooCommerce (Store API desactivada, 404) | Permite todo salvo /wp-admin/ | **No**: sellado y accesorios. Las sueltas, en [Cardmarket](https://www.cardmarket.com/en/Magic/Users/MagicBarcelona/Offers/Cartas-Sueltas) |
| inGenio BCN Games | Pg. de Sant Joan 16, 08010 | [ingeniobcn.com](https://www.ingeniobcn.com/) | WooCommerce (Store API abierta) | `Disallow: / *?`: quiere bloquear las URL con parámetros (lo tomamos como tal) | **No**: 626 productos de Magic, todos sellados. "Carta suelta" enlaza a Cardmarket |
| El Nucli | C/ Valladolid 41, 08014 (Sants) | [elnucli.es](https://www.elnucli.es/) | Shopify (`/products.json` accesible) | El de Shopify por defecto | **No**: sellado. Las sueltas, por presupuesto en `pedidos@elnucli.es` |
| Dungeon Marvels | C/ d'Olzinelles 49, 08014 | [dungeonmarvels.com](https://dungeonmarvels.com/) | PrestaShop | Bloquea búsquedas y parámetros | **No consta**: la categoría Magic se organiza por edición y parece sellado (Bloomburrow: 4 productos de 4 € a 218 €) |
| Arco TCG | C/ d'Ausiàs Marc 53, 08010 | [arcotcg.com](https://arcotcg.com/) | WooCommerce | Permite todo salvo add-to-cart | **Todavía no**: dice vender sueltas de Magic, pero solo tiene Pokémon. Conviene volver a mirarla |
| Kaburi Rol & Games | Pg. de Sant Joan 11, 08010 (también C/ Sants 17 y C/ Alí Bei 10) | [kaburi.es](https://kaburi.es/) | WordPress | **`Disallow: /`: no se puede rastrear** | No consta |
| Gameria | C/ d'Ausiàs Marc 52, 08010 | No se ha encontrado | — | — | Torneos de Magic; sueltas solo en la tienda física |

Revisadas y descartadas porque no venden Magic en su web: Júpiter Juegos (jupiterjuegos.com), Mathom Maldà (mathom.es), Gigamesh (gigamesh.com).
No revisadas, porque según los directorios son de cómics o juegos de mesa: Antifaz Comics, Tot Comics, Arkham Comics, Continuarà, Norma Còmics, Freaks, SuperCollectors y Mono de Juegos.

### Tiendas de la zona que venden las sueltas en Cardmarket

Datos sacados de buscadores y de las webs de las tiendas, sin rastrear Cardmarket. Cardmarket sirve un reto de Cloudflare incluso para su `robots.txt`. Estas son las tiendas a las que pedir su stock exportado de Cardmarket (`cardmarketUser` en `stores.config.ts`).

| Tienda | Dirección | Usuario de Cardmarket | Notas |
| --- | --- | --- | --- |
| Magic Barcelona | Ronda de Sant Pere 44, 08010 | [MagicBarcelona](https://www.cardmarket.com/en/Magic/Users/MagicBarcelona) | Powerseller desde 2011, unas 265.000 ventas. Se puede pedir en Cardmarket y recoger en la tienda. MagicBarcelonaShop3/Shop4 son cuentas de la misma empresa sin actividad |
| inGenio BCN Games | Pg. de Sant Joan 16, 08010 | [inGenio](https://www.cardmarket.com/en/Magic/Users/inGenio) | Su web enlaza a sus sueltas por edición: `/Users/inGenio/Offers/Singles?idExpansion=<id>` |
| Industria 61 | C/ Indústria 61, 08025 | [Magic-Industria-61](https://www.cardmarket.com/en/Magic/Users/Magic-Industria-61) | Unas 24.000 ventas, desde 2012. Tiene web ([industria61.com](https://industria61.com/cartas-sueltas/), WooCommerce), pero dice "NO vendemos cartas sueltas directamente": se piden en Cardmarket y se recogen en la tienda |
| Gameria | C/ d'Ausiàs Marc 52, 08010 | [GAMERIA](https://www.cardmarket.com/en/Magic/Users/GAMERIA) | Vendedor profesional desde 2017, unas 1.800 ventas |

No se han encontrado en Cardmarket: El Nucli (vende sueltas por correo), Dungeon Marvels, Kaburi, Arco TCG y ninguna tienda de L'Hospitalet. Están fuera de la zona AsgardBCN (Badalona) y BCN-CARDS (Canet de Mar).

## L'Hospitalet de Llobregat

| Tienda | Dirección | Web | Sueltas de Magic en su web |
| --- | --- | --- | --- |
| El Tesoro del Dragón Blanco | C/ de l'Aprestadora 110, 08902 | Sin web (solo [Facebook](https://www.facebook.com/p/El-Tesoro-del-Dragon-Blanco-100064114985586/)) | No: tienda física de TCG que tiene Magic |
| NuncaEsDemasiado TCG | Ctra. de la Feixa Llarga 47, 1ºB, 08907 | [nuncaesdemasiadotcg.com](https://nuncaesdemasiadotcg.com/) (Shopify) | No: 7 productos, todos de Pokémon |

## Tiendas online del resto de España (con singles en su web)

Revisión de unas 75 candidatas. Solo 7 venden cartas sueltas de Magic en su propia web, con stock propio. Los datos completos, con ejemplos de títulos y reglas de robots.txt, están en [tiendas-online.json](tiendas-online.json).

| Tienda | Ciudad | Plataforma | Sueltas | Estado |
| --- | --- | --- | --- | --- |
| [MTG Canarias](https://mtgcanarias.com/categoria-producto/cartas-sueltas/) | Tacoronte (Tenerife) | WooCommerce (Store API abierta) | 42.456 fichas, 9.452 con stock | OK |
| [El Rincón de Magic](https://www.elrincondemagic.com/Cartas-Sueltas) | Daganzo de Arriba (Madrid), solo online | ePages (HTML) | unas 40.000 (extrapolado) | OK |
| [Rebellion](https://www.rebellion.es/tiendarebel/index.php) | Móstoles (Madrid) | PHP a medida (HTML, ISO-8859-1) | 466 ediciones | OK |
| [El Duelista](https://www.elduelista.com/collections/magic-single) | Valladolid | Shopify | 3.098 | OK (los títulos llevan U+2063 invisibles) |
| [Universe TCG](https://www.universetcg.com/collections/magic-single) | Mollet del Vallès (Barcelona) | Shopify | 649 | OK |
| [Itaca.gg](https://itaca.gg/magic/expansions) | Madrid | A medida (HTML, JSON-LD) | 705 expansiones | **Pendiente de permiso**: cláusula genérica contra copiar o explotar el material del sitio; Crawl-delay 5 |
| [Disfrutalo TCG](https://disfrutalo-tcg.com/es/5-magic-cartas-sueltas) | Elda (Alicante) | PrestaShop | 278 | **Pendiente de permiso**: cláusula genérica contra la explotación sin consentimiento y bloqueo de ClaudeBot en robots.txt |

Descartadas, entre otras: Metrópolis Center y Colossal Store (Cloudflare o un 403 a nuestro User-Agent), TCGMadrid y Dual Games (robots.txt `Disallow: /`), Deck Lab (compra pausada; remite a Cardmarket), TCG Academy (stock de terceros) y una veintena que solo tienen sellado en su web o venden las sueltas solo por Cardmarket.

Nota para los compradores: los envíos desde Canarias a la península salen del territorio IVA de la UE y pueden llevar trámite de aduanas.

## Fuera de la zona (descartadas)

La Màquina del Temps (Badalona, PrestaShop, solo sellado), Universe TCG (Mollet del Vallès, Shopify), TCG Legacy (Pallejà), Dracotienda (Córdoba), Metrópolis Center (Madrid). Friki de Nacimiento y Hykercardhouse no publican dirección.

## Fuentes

- Directorios: [Boardoro Barcelona](https://boardoro.com/en/europe/spain/barcelona), [tiendasfrikis.org](https://tiendasfrikis.org/barcelona-tcg), [Planomato L'Hospitalet](https://www.planomato.com/es/hospitalet-de-llobregat/n/tienda-cartas-coleccionables), [Time Out (Kaburi)](https://www.timeout.es/barcelona/es/espacios-para-jugar/kaburi-rol-games), [Salir.com (inGenio)](https://www.salir.com/ingenio-bcn-games-barcelona-neg-127002.html)
- Las webs de cada tienda que aparecen en las tablas.
