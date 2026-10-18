"use client";

import { ChevronDown, SlidersHorizontal, Store, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { CONDITIONS, FINISHES, type City, type Condition, type Finish, type Lang } from "@/lib/data/types";
import { conditionLabel, finishLabel, languageLabel } from "@/lib/format";
import { cx, secondaryButtonClass } from "../ui";
import { countActiveFilters, filtersHref, type CityOption, type FilterState } from "./filters";

interface Props {
  /** ruta de la página, sin query */
  pathname: string;
  filters: FilterState;
  /** "sealed" quita acabado, estado y edición */
  variant?: "card" | "sealed";
  /** ciudades de las ofertas, para "Dónde" */
  cities: CityOption[];
  /** idiomas que se ofrecen como opción */
  languages: Lang[];
}

/**
 * Filtros de ofertas como formulario GET. Sin JavaScript se aplican con el botón; con
 * JavaScript cada cambio se aplica al momento y la URL solo lleva lo que no está por defecto.
 */
export function OfferFiltersForm({ pathname, filters, variant = "card", cities, languages }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState(filters);
  // cuando cambia la URL (navegación, "quitar filtros") manda lo que diga el servidor
  const [synced, setSynced] = useState(filters);
  if (synced !== filters) {
    setSynced(filters);
    setState(filters);
  }
  // con JavaScript los cambios se aplican solos y sobra el botón
  useEffect(() => setHydrated(true), []);

  const isCard = variant === "card";

  function apply(next: FilterState) {
    setState(next);
    startTransition(() => router.replace(filtersHref(pathname, next), { scroll: false }));
  }

  function setLocalOnly(localOnly: boolean) {
    // con "solo físicas" no tiene sentido mantener ciudades sin tiendas físicas
    const localCities = new Set(cities.filter((c) => c.local).map((c) => c.city));
    apply({ ...state, localOnly, cities: localOnly ? state.cities.filter((c) => localCities.has(c)) : state.cities });
  }

  function toggleCity(city: City) {
    const next = state.cities.includes(city) ? state.cities.filter((c) => c !== city) : [...state.cities, city];
    apply({ ...state, cities: cities.map((c) => c.city).filter((c) => next.includes(c)) });
  }

  function toggleLanguage(lang: Lang) {
    const next = state.languages.includes(lang) ? state.languages.filter((l) => l !== lang) : [...state.languages, lang];
    apply({ ...state, languages: languages.filter((l) => next.includes(l)) });
  }

  const shownCities = state.localOnly ? cities.filter((c) => c.local || state.cities.includes(c.city)) : cities;
  // el interruptor de "solo físicas" y el de stock van fuera del panel plegable
  const panelActive = countActiveFilters({ ...state, localOnly: false, inStockOnly: true });
  const chips = activeChips(state);

  return (
    <form
      method="get"
      action={pathname}
      onSubmit={(event) => {
        event.preventDefault();
        apply(state);
      }}
      aria-label="Filtros de ofertas"
      className="space-y-3"
    >
      <div
        className={cx(
          "flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl border px-4 py-3 transition",
          state.localOnly ? "border-brand/50 bg-brand-soft" : "border-line bg-surface",
        )}
      >
        <Switch name="fisicas" value="1" checked={state.localOnly} onChange={setLocalOnly}>
          <span className="inline-flex items-center gap-2">
            <Store aria-hidden="true" className="size-4 shrink-0 text-brand-strong" />
            <span>
              Solo tiendas físicas de Barcelona y L&apos;Hospitalet
              <span className="block text-xs font-normal text-ink-3">Para comprar en mano, sin envío</span>
            </span>
          </span>
        </Switch>
        {/* sin marcar, el navegador no envía la casilla: el campo oculto distingue "desmarcada" de "por defecto" */}
        <input type="hidden" name="stock" value="todo" />
        <Switch name="stock" value="solo" checked={state.inStockOnly} onChange={(checked) => apply({ ...state, inStockOnly: checked })}>
          Solo con stock
        </Switch>
      </div>

      <details className="filters-panel group rounded-2xl border border-line bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal aria-hidden="true" className="size-4 text-ink-3" />
            Más filtros
            {panelActive > 0 && (
              <span className="rounded-full bg-brand px-1.5 py-px text-[11px] font-semibold text-on-brand">
                {panelActive}
                <span className="sr-only"> {panelActive === 1 ? "activo" : "activos"}</span>
              </span>
            )}
          </span>
          <ChevronDown aria-hidden="true" className="size-4 text-ink-3 transition group-open:rotate-180" />
        </summary>

        <div className="flex flex-col gap-5 border-t border-line px-4 py-4 lg:flex-row lg:flex-wrap lg:items-start lg:gap-x-8 lg:gap-y-4 lg:border-t-0 lg:py-3.5">
          {shownCities.length > 0 && (
            <Group legend="Dónde" hint={state.cities.length === 0 ? "Sin marcar ninguna, todas" : undefined}>
              {shownCities.map(({ city }) => (
                <Chip key={city} name="ciudad" value={city} checked={state.cities.includes(city)} onChange={() => toggleCity(city)}>
                  {city}
                </Chip>
              ))}
            </Group>
          )}

          {isCard && (
            <Group legend="Acabado">
              <div className="inline-flex flex-wrap rounded-xl border border-line bg-surface-2 p-0.5">
                {[null, ...FINISHES].map((finish) => (
                  <label
                    key={finish ?? "todos"}
                    className="cursor-pointer rounded-[10px] px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink-2 transition hover:text-ink has-checked:bg-surface has-checked:text-ink has-checked:shadow-sm has-checked:ring-1 has-checked:ring-line has-focus-visible:ring-2 has-focus-visible:ring-brand"
                  >
                    <input
                      type="radio"
                      name="acabado"
                      value={finish ?? ""}
                      checked={state.finish === finish}
                      onChange={() => apply({ ...state, finish: finish as Finish | null })}
                      className="sr-only"
                    />
                    {finish ? finishLabel(finish) : "Todos"}
                  </label>
                ))}
              </div>
            </Group>
          )}

          <Group legend="Idioma" hint={state.languages.length === 0 ? "Sin marcar ninguno, todos" : undefined}>
            {languages.map((lang) => (
              <Chip
                key={lang}
                name="idioma"
                value={lang}
                checked={state.languages.includes(lang)}
                onChange={() => toggleLanguage(lang)}
                title={languageLabel(lang)}
                mono
              >
                {lang}
                <span className="sr-only"> ({languageLabel(lang)})</span>
              </Chip>
            ))}
          </Group>

          {isCard && (
            <div className="lg:w-60">
              <label htmlFor="filtro-estado" className="mb-1.5 block text-xs font-medium text-ink-3">
                Estado mínimo
              </label>
              <div className="relative">
                <select
                  id="filtro-estado"
                  name="estado"
                  value={state.minCondition ?? ""}
                  onChange={(event) => apply({ ...state, minCondition: (event.target.value || null) as Condition | null })}
                  aria-describedby="filtro-estado-ayuda"
                  className="h-9 w-full appearance-none rounded-xl border border-line bg-surface pr-9 pl-3 text-sm text-ink outline-none transition hover:border-line-strong focus:border-brand focus:ring-4 focus:ring-brand/15"
                >
                  <option value="">Cualquiera</option>
                  {CONDITIONS.map((condition) => (
                    <option key={condition} value={condition}>
                      {conditionLabel(condition)} ({condition}){condition === "MT" ? "" : " o mejor"}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-3" />
              </div>
              <p id="filtro-estado-ayuda" className="mt-1.5 text-xs text-ink-3">
                Escala de Cardmarket. Oculta las copias sin estado indicado.
              </p>
            </div>
          )}

          {isCard && state.setCode && <input type="hidden" name="edicion" value={state.setCode} />}

          {!hydrated && (
            <div className="lg:self-end">
              <button type="submit" className={secondaryButtonClass}>
                Aplicar filtros
              </button>
            </div>
          )}
        </div>
      </details>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map(([label, next]) => (
            <Link
              key={label}
              href={filtersHref(pathname, next)}
              scroll={false}
              replace
              className="inline-flex items-center gap-1 rounded-full bg-brand-soft py-1 pr-2 pl-3 text-xs font-medium text-brand-strong transition hover:bg-brand/20"
            >
              {label}
              <X aria-hidden="true" className="size-3" />
              <span className="sr-only"> (quitar)</span>
            </Link>
          ))}
          <Link
            href={pathname}
            scroll={false}
            replace
            className="px-1 text-xs font-medium text-ink-3 underline-offset-2 hover:text-ink hover:underline"
          >
            Quitar filtros
          </Link>
          <span role="status" className="text-xs text-ink-3">
            {pending ? "Actualizando…" : ""}
          </span>
        </div>
      )}
      {chips.length === 0 && (
        <span role="status" className="sr-only">
          {pending ? "Actualizando…" : ""}
        </span>
      )}
    </form>
  );
}

/** Filtros activos con su estado sin ellos, para quitarlos de uno en uno */
function activeChips(state: FilterState): Array<[label: string, next: FilterState]> {
  const out: Array<[string, FilterState]> = [];
  if (state.localOnly) out.push(["Solo tiendas físicas", { ...state, localOnly: false }]);
  for (const city of state.cities) out.push([city, { ...state, cities: state.cities.filter((c) => c !== city) }]);
  if (!state.inStockOnly) out.push(["Incluye agotadas", { ...state, inStockOnly: true }]);
  if (state.finish) out.push([finishLabel(state.finish), { ...state, finish: null }]);
  for (const lang of state.languages) {
    out.push([languageLabel(lang), { ...state, languages: state.languages.filter((l) => l !== lang) }]);
  }
  if (state.minCondition) out.push([`${state.minCondition} o mejor`, { ...state, minCondition: null }]);
  if (state.setCode) out.push([`Edición ${state.setCode.toUpperCase()}`, { ...state, setCode: null }]);
  return out;
}

function Group({ legend, hint, children }: { legend: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-xs font-medium text-ink-3">
        {legend}
        {hint && <span className="font-normal"> · {hint}</span>}
      </legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

/** Interruptor (casilla con aspecto de switch) */
function Switch({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink select-none">
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="relative h-5 w-9 shrink-0 rounded-full bg-line-strong transition peer-checked:bg-brand peer-focus-visible:ring-4 peer-focus-visible:ring-brand/25 after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition peer-checked:after:translate-x-4"
      />
      {children}
    </label>
  );
}

/** Casilla con aspecto de píldora, para elegir varias opciones */
function Chip({
  name,
  value,
  checked,
  onChange,
  title,
  mono = false,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  title?: string;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <label
      title={title}
      className={cx(
        "inline-flex h-9 cursor-pointer items-center rounded-xl border border-line bg-surface px-3 text-ink-2 transition select-none hover:border-line-strong has-checked:border-brand has-checked:bg-brand-soft has-checked:text-brand-strong has-focus-visible:ring-4 has-focus-visible:ring-brand/25",
        mono ? "min-w-10 justify-center font-mono text-xs font-semibold uppercase" : "text-sm font-medium",
      )}
    >
      <input type="checkbox" name={name} value={value} checked={checked} onChange={onChange} className="sr-only" />
      {children}
    </label>
  );
}
