import type { Condition, Finish, Lang, ListingSource, Platform, ScrapeRun } from "@/lib/data/types";

/**
 * Formato de precios, fechas y etiquetas que muestra la web (español de España).
 * Los precios llegan en céntimos enteros y las fechas en ISO 8601.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A partir de estas horas los datos de una tienda se consideran viejos */
export const STALE_HOURS = 24;

// ---------------------------------------------------------------------------
// Precios
// ---------------------------------------------------------------------------

const euros = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

/** 150 → "1,50 €" (con espacio de no separación antes de €) */
export function formatEuros(cents: number): string {
  return euros.format(cents / 100);
}

/**
 * Diferencia del precio respecto a la referencia, en % entero: (88, 100) → -12.
 * null si no hay referencia.
 */
export function priceDiffPercent(priceCents: number, referenceCents: number | null): number | null {
  if (referenceCents == null || referenceCents <= 0) return null;
  // + 0 convierte el -0 de Math.round en 0
  return Math.round(((priceCents - referenceCents) / referenceCents) * 100) + 0;
}

/** -12 → "−12 %", 8 → "+8 %", 0 → "0 %" */
export function formatPercentDiff(percent: number): string {
  const sign = percent < 0 ? "−" : percent > 0 ? "+" : "";
  return `${sign}${Math.abs(percent)} %`;
}

/** Confianza 0..1 → "62 %" */
export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)} %`;
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

/** "hace 5 min", "hace 3 h", "hace 2 días" */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - Date.parse(iso);
  if (Number.isNaN(diff)) return "";
  if (diff < MINUTE) return "hace un momento";
  if (diff < HOUR) return `hace ${Math.floor(diff / MINUTE)} min`;
  if (diff < DAY) return `hace ${Math.floor(diff / HOUR)} h`;
  const days = Math.floor(diff / DAY);
  return `hace ${days} ${days === 1 ? "día" : "días"}`;
}

/** true si la fecha tiene más de STALE_HOURS horas o no hay fecha */
export function isStale(iso: string | null, now: Date = new Date()): boolean {
  if (!iso) return true;
  return now.getTime() - Date.parse(iso) > STALE_HOURS * HOUR;
}

const dateTime = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Madrid",
});

/** "18/10/26, 14:05" en hora de Madrid, la misma en el servidor y en el navegador */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

const longDate = new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "UTC" });

/** Fecha sin hora ("2024-08-02") → "2 de agosto de 2024"; cadena vacía si no es válida */
export function formatDate(isoDate: string): string {
  const time = Date.parse(isoDate);
  return Number.isNaN(time) ? "" : longDate.format(new Date(time));
}

/** 45 s → "45 s", 6 min → "6 min", 1 h 5 min → "1 h 5 min" */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${Math.floor(minutes / 60)} h`;
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

/** plural(1, "oferta", "ofertas") → "1 oferta"; plural(3, …) → "3 ofertas" */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Agotado", "En stock" (cantidad desconocida), "1 ud.", "3 uds." */
export function stockLabel(inStock: boolean, quantity: number | null): string {
  if (!inStock) return "Agotado";
  if (quantity == null) return "En stock";
  return plural(quantity, "ud.", "uds.");
}

// ---------------------------------------------------------------------------
// Etiquetas
// ---------------------------------------------------------------------------

export const CONDITION_LABELS: Record<Condition, string> = {
  MT: "Mint",
  NM: "Near Mint",
  EX: "Excelente",
  GD: "Buena",
  LP: "Ligeramente jugada",
  PL: "Jugada",
  PO: "Pobre",
};

export const FINISH_LABELS: Record<Finish, string> = {
  nonfoil: "Normal",
  foil: "Foil",
  etched: "Etched",
};

export const LANGUAGE_LABELS: Record<string, string> = {
  es: "Español",
  en: "Inglés",
  fr: "Francés",
  de: "Alemán",
  it: "Italiano",
  pt: "Portugués",
  ja: "Japonés",
  ko: "Coreano",
  ru: "Ruso",
  zhs: "Chino simplificado",
  zht: "Chino tradicional",
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  shopify: "Shopify",
  woocommerce: "WooCommerce",
  prestashop: "PrestaShop",
  html: "Web propia",
};

/** Estado de una tienda (última ejecución) o de una ejecución del scraping */
export type RunStatus = ScrapeRun["status"];

export const STATUS_LABELS: Record<RunStatus, string> = {
  ok: "OK",
  partial: "Parcial",
  error: "Error",
  skipped: "Omitida",
  running: "En curso",
};

/** null = estado desconocido */
export function conditionLabel(condition: Condition | null): string {
  return condition ? CONDITION_LABELS[condition] : "Desconocido";
}

export function finishLabel(finish: Finish): string {
  return FINISH_LABELS[finish];
}

/** Códigos de Scryfall; si no se conoce el código se devuelve tal cual */
export function languageLabel(lang: Lang | null): string {
  if (!lang) return "Desconocido";
  return LANGUAGE_LABELS[lang] ?? lang;
}

export function platformLabel(platform: Platform): string {
  return PLATFORM_LABELS[platform];
}

/** null = la tienda aún no se ha revisado nunca */
export function statusLabel(status: RunStatus | null): string {
  return status ? STATUS_LABELS[status] : "Sin datos";
}

/** De dónde sale un listado */
export const SOURCE_LABELS: Record<ListingSource, string> = {
  web: "Web de la tienda",
  cardmarket_csv: "Stock de Cardmarket",
};

export function sourceLabel(source: ListingSource): string {
  return SOURCE_LABELS[source];
}

/** Perfil público de una tienda en Cardmarket */
export function cardmarketProfileUrl(user: string): string {
  return `https://www.cardmarket.com/es/Magic/Users/${encodeURIComponent(user)}`;
}

/** "Tienda física" (Barcelona o L'Hospitalet) u "Online" (resto de España) */
export function storeKindLabel(local: boolean): string {
  return local ? "Tienda física" : "Online";
}

// ---------------------------------------------------------------------------
// Producto sellado (category/subtype de MTGJSON)
// ---------------------------------------------------------------------------

/** "de juego", "de draft"…: completa "Sobre …" y "Caja de sobres …" */
const BOOSTER_KIND: Record<string, string> = {
  play: "de juego",
  draft: "de draft",
  set: "de edición",
  collector: "de coleccionista",
  jumpstart: "de Jumpstart",
  theme: "temáticos",
  premium: "premium",
  welcome: "de bienvenida",
  promotional: "promocionales",
};

const PACK_LABELS: Record<string, string> = {
  play: "Sobre de juego",
  draft: "Sobre de draft",
  set: "Sobre de edición",
  collector: "Sobre de coleccionista",
  jumpstart: "Sobre de Jumpstart",
  theme: "Sobre temático",
  premium: "Sobre premium",
  welcome: "Sobre de bienvenida",
  promotional: "Sobre promocional",
  topper: "Sobre de regalo (box topper)",
  prerelease_kit: "Sobre de presentación",
};

const BUNDLE_LABELS: Record<string, string> = {
  default: "Bundle",
  fat_pack: "Bundle",
  gift_bundle: "Bundle regalo",
  premium: "Bundle premium",
};

const DECK_LABELS: Record<string, string> = {
  commander: "Mazo Commander",
  starter_deck: "Mazo de inicio",
  welcome: "Mazo de bienvenida",
  theme: "Mazo temático",
  planeswalker: "Mazo de planeswalker",
  challenger: "Mazo Challenger",
  two_player_starter: "Kit de inicio para 2 jugadores",
};

const KIT_LABELS: Record<string, string> = {
  prerelease_kit: "Kit de presentación",
  draft: "Kit de draft",
  draft_set: "Kit de draft",
};

const BOX_SET_LABELS: Record<string, string> = {
  mtgo_redemption: "Canje de MTGO",
  starter_deck: "Caja de mazos de inicio",
};

/** Nombre en español de un tipo de producto de MTGJSON: booster_box/collector → "Caja de sobres de coleccionista" */
export function sealedTypeLabel(category: string | null, subtype: string | null): string {
  const sub = subtype ?? "";
  switch (category) {
    case "booster_pack":
      return PACK_LABELS[sub] ?? "Sobre";
    case "booster_box":
      return BOOSTER_KIND[sub] ? `Caja de sobres ${BOOSTER_KIND[sub]}` : "Caja de sobres";
    case "booster_case":
      return BOOSTER_KIND[sub] ? `Lote de cajas de sobres ${BOOSTER_KIND[sub]}` : "Lote de cajas de sobres";
    case "bundle":
      return BUNDLE_LABELS[sub] ?? "Bundle";
    case "bundle_case":
      return `Lote de ${(BUNDLE_LABELS[sub] ?? "Bundle").toLowerCase().replace("bundle", "bundles")}`;
    case "deck":
      return DECK_LABELS[sub] ?? "Mazo";
    case "multiple_decks":
      return DECK_LABELS[sub] ?? "Varios mazos";
    case "deck_box":
      return sub === "two_player_starter" ? "Lote de kits de inicio para 2 jugadores" : "Caja de mazos";
    case "limited_aid_tool":
      return KIT_LABELS[sub] ?? "Kit para limitado";
    case "limited_aid_case":
      return KIT_LABELS[sub] ? `Lote de ${KIT_LABELS[sub].replace("Kit", "kits")}` : "Lote de kits para limitado";
    case "box_set":
      return BOX_SET_LABELS[sub] ?? "Caja especial";
    case "kit":
      return "Kit";
    case "subset":
      return "Lote de productos";
    default:
      return "Producto sellado";
  }
}

/** Familia del producto, para el icono y el color: caja, bundle, sobre, mazo u otro */
export type SealedFamily = "box" | "bundle" | "pack" | "deck" | "other";

export function sealedFamily(category: string | null): SealedFamily {
  switch (category) {
    case "booster_box":
    case "booster_case":
    case "box_set":
    case "deck_box":
      return "box";
    case "bundle":
    case "bundle_case":
      return "bundle";
    case "booster_pack":
      return "pack";
    case "deck":
    case "multiple_decks":
      return "deck";
    default:
      return "other";
  }
}
