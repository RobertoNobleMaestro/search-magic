/**
 * Precios de las tiendas → céntimos de euro enteros.
 */

/**
 * Primer importe de un texto: "1,50 €", "€1.50", "1.234,56 €", "12 €", "0,95€", "Desde 2,50 €".
 * Vale coma o punto como decimal y punto, coma o espacio como separador de miles.
 * Devuelve null si el texto no tiene ningún importe.
 */
export function parsePrice(text: string): number | null {
  // grupos de cifras unidos por "." o ","; un espacio solo une si detrás hay tres cifras ("1 234,56")
  const token = /\d+(?:[.,]\d+|[   ]\d{3}(?!\d))*/.exec(text)?.[0];
  if (!token) return null;
  const groups = token.split(/[.,\s]/);
  const seps = token.match(/[.,\s]/g) ?? [];
  const last = seps.at(-1);
  const lastGroup = groups.at(-1) ?? "";
  // El último separador es el decimal si no lleva tres cifras detrás ("1,5", "1.50"), si es distinto de
  // los anteriores ("1.234,56") o si delante solo hay un cero ("0,950"). "1.234" o "1,234" son miles.
  const isDecimal =
    last !== undefined &&
    /[.,]/.test(last) &&
    (lastGroup.length !== 3 || seps.slice(0, -1).some((s) => s !== last && /[.,]/.test(s)) || groups[0] === "0");
  const euros = Number((isDecimal ? groups.slice(0, -1) : groups).join(""));
  const cents = isDecimal ? Math.round(Number(`0.${lastGroup}`) * 100) : 0;
  const total = euros * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

/** Por encima de esto es un precio de relleno de la tienda (hay quien pone 999.999 € a lo agotado) */
export const MAX_PLAUSIBLE_PRICE_CENTS = 10_000_000;

/** 0 € o un precio de relleno no son una oferta real */
export function isPlausiblePrice(cents: number): boolean {
  return Number.isSafeInteger(cents) && cents > 0 && cents < MAX_PLAUSIBLE_PRICE_CENTS;
}

/** Importe decimal con punto, como lo da Shopify ("1.50", "12", 1.5) → céntimos */
export function decimalToCents(value: string | number): number | null {
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

/**
 * Importe en unidades mínimas de la moneda, como lo da la Store API de WooCommerce:
 * "150" con currency_minor_unit 2 son 1,50 €.
 */
export function minorUnitsToCents(value: string | number, minorUnit: number): number | null {
  const text = String(value).trim();
  if (!/^\d+$/.test(text) || !Number.isInteger(minorUnit) || minorUnit < 0) return null;
  return Math.round(Number(text) * 10 ** (2 - minorUnit));
}
