import { allParams, firstParam, type SearchParams } from "@/components/search-params";
import {
  CONDITIONS,
  FINISHES,
  type City,
  type Condition,
  type Finish,
  type Lang,
  type OfferFilters,
  type SealedOfferFilters,
} from "@/lib/data/types";

/**
 * Filtros de ofertas de las páginas de carta y de sellado. Viajan en la URL para que funcionen
 * sin JavaScript y se puedan compartir; los valores por defecto no aparecen:
 *
 *   fisicas=1               solo tiendas físicas de Barcelona y L'Hospitalet
 *   ciudad=Madrid           repetible, tal como se muestra la ciudad; sin ciudad = todas
 *   stock=todo              incluye las agotadas (por defecto, solo con stock)
 *   acabado=foil            nonfoil | foil | etched (solo cartas)
 *   idioma=es&idioma=en     repetible; sin idioma = cualquiera
 *   estado=EX               estado mínimo en la escala de Cardmarket (solo cartas)
 *   edicion=m11             código de edición (solo cartas)
 */

export interface FilterState {
  localOnly: boolean;
  /** vacío = todas */
  cities: City[];
  inStockOnly: boolean;
  finish: Finish | null;
  /** vacío = cualquier idioma */
  languages: Lang[];
  minCondition: Condition | null;
  setCode: string | null;
}

export const DEFAULT_FILTERS: FilterState = {
  localOnly: false,
  cities: [],
  inStockOnly: true,
  finish: null,
  languages: [],
  minCondition: null,
  setCode: null,
};

function isOneOf<T extends string>(list: readonly T[], value: string | undefined): value is T {
  return value != null && (list as readonly string[]).includes(value);
}

/** Ciudades tal como llegan en la URL: sin espacios de más, sin vacías ni repetidas */
function parseCities(values: string[]): City[] {
  const out: City[] = [];
  for (const value of values) {
    const city = value.replace(/\s+/g, " ").trim();
    if (city && city.length <= 60 && !/[\u0000-\u001f<>]/.test(city) && !out.includes(city)) out.push(city);
  }
  return out;
}

export function parseFilters(params: SearchParams): FilterState {
  const stock = allParams(params.stock);
  const finish = firstParam(params.acabado);
  const condition = firstParam(params.estado)?.toUpperCase();
  const setCode = firstParam(params.edicion)?.trim().toLowerCase();
  const languages = new Set(allParams(params.idioma).map((l) => l.trim().toLowerCase()));
  return {
    localOnly: allParams(params.fisicas).includes("1"),
    cities: parseCities(allParams(params.ciudad)),
    // el formulario envía siempre stock=todo (campo oculto) y además stock=solo si la casilla está marcada
    inStockOnly: !stock.includes("todo") || stock.includes("solo"),
    finish: isOneOf(FINISHES, finish) ? finish : null,
    languages: [...languages].filter((l) => /^[a-z]{2,3}$/.test(l)),
    minCondition: isOneOf(CONDITIONS, condition) ? condition : null,
    setCode: setCode && /^[a-z0-9]{2,10}$/.test(setCode) ? setCode : null,
  };
}

export function filtersToSearchParams(state: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.localOnly) params.set("fisicas", "1");
  for (const city of state.cities) params.append("ciudad", city);
  if (!state.inStockOnly) params.set("stock", "todo");
  if (state.finish) params.set("acabado", state.finish);
  for (const lang of state.languages) params.append("idioma", lang);
  if (state.minCondition) params.set("estado", state.minCondition);
  if (state.setCode) params.set("edicion", state.setCode);
  return params;
}

/** Ruta con los filtros en la query, sin los valores por defecto */
export function filtersHref(pathname: string, state: FilterState): string {
  const query = filtersToSearchParams(state).toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Cuántos filtros se apartan del valor por defecto */
export function countActiveFilters(state: FilterState): number {
  return [
    state.localOnly,
    state.cities.length > 0,
    !state.inStockOnly,
    state.finish != null,
    state.languages.length > 0,
    state.minCondition != null,
    state.setCode != null,
  ].filter(Boolean).length;
}

/** Filtros para Repository.getOffers */
export function toOfferFilters(state: FilterState): OfferFilters {
  return {
    localOnly: state.localOnly || undefined,
    cities: state.cities.length ? state.cities : undefined,
    inStockOnly: state.inStockOnly,
    finish: state.finish ?? undefined,
    languages: state.languages.length ? state.languages : undefined,
    minCondition: state.minCondition ?? undefined,
    setCode: state.setCode ?? undefined,
  };
}

/** Los filtros que tienen sentido para producto sellado (sin acabado, estado ni edición) */
export function sealedFilterState(state: FilterState): FilterState {
  return { ...state, finish: null, minCondition: null, setCode: null };
}

/** Filtros para Repository.getSealedOffers */
export function toSealedOfferFilters(state: FilterState): SealedOfferFilters {
  return {
    localOnly: state.localOnly || undefined,
    cities: state.cities.length ? state.cities : undefined,
    inStockOnly: state.inStockOnly,
    languages: state.languages.length ? state.languages : undefined,
  };
}

/** Ciudad que se ofrece en el filtro "Dónde"; local = hay alguna tienda física en ella */
export interface CityOption {
  city: City;
  local: boolean;
}

/**
 * Ciudades de las ofertas para el filtro "Dónde": primero las de tiendas físicas y después
 * el resto, por orden alfabético. Se añaden las ya elegidas aunque no tengan ofertas.
 */
export function cityOptions(stores: Array<{ city: City; local: boolean }>, selected: City[] = []): CityOption[] {
  const map = new Map<City, boolean>();
  for (const s of stores) if (s.city) map.set(s.city, (map.get(s.city) ?? false) || s.local);
  for (const city of selected) if (!map.has(city)) map.set(city, false);
  return [...map]
    .map(([city, local]) => ({ city, local }))
    .sort((a, b) => Number(b.local) - Number(a.local) || a.city.localeCompare(b.city, "es"));
}

/** Español e inglés siempre, después el resto de idiomas que aparecen en las ofertas */
export function languageOptions(present: Array<Lang | null>, selected: Lang[], label: (lang: Lang) => string): Lang[] {
  const set = new Set<Lang>(["es", "en", ...selected]);
  for (const lang of present) if (lang) set.add(lang);
  const rank = (lang: Lang) => (lang === "es" ? 0 : lang === "en" ? 1 : 2);
  return [...set].sort((a, b) => rank(a) - rank(b) || label(a).localeCompare(label(b), "es"));
}
