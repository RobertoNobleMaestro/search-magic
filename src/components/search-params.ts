/** searchParams de una página del App Router, ya resuelto */
export type SearchParams = Record<string, string | string[] | undefined>;

/** Primer valor de un parámetro (?q=a&q=b → "a") */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Todos los valores de un parámetro repetible (?idioma=es&idioma=en) */
export function allParams(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}
