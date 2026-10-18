"use client";

import { Search } from "lucide-react";
import Form from "next/form";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import type { CardSuggestion } from "@/lib/data/types";
import { buttonClass, cx } from "./ui";

/** Por debajo de 3 caracteres no se pide autocompletado: en la base de datos es lento */
export const AUTOCOMPLETE_MIN_CHARS = 3;

interface Props {
  /** texto inicial (la búsqueda actual en /buscar) */
  initialQuery?: string;
  /** "large" en la portada, "compact" en la cabecera */
  size?: "large" | "compact";
}

/**
 * Caja de búsqueda con autocompletado de cartas (patrón combobox de WAI-ARIA).
 * Sin JavaScript es un formulario GET normal a /buscar?q=, que busca cartas y producto sellado.
 */
export function SearchBox({ initialQuery = "", size = "large" }: Props) {
  const router = useRouter();
  const id = useId();
  const inputId = `${id}-q`;
  const listId = `${id}-sugerencias`;
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [result, setResult] = useState<{ term: string; items: CardSuggestion[] } | null>(null);

  const term = query.trim();
  const ready = term.length >= AUTOCOMPLETE_MIN_CHARS;
  // mientras llega la respuesta se siguen viendo las sugerencias anteriores
  const items = ready && result ? result.items : [];
  const noMatches = ready && result?.term === term && result.items.length === 0;
  const expanded = open && (items.length > 0 || noMatches);

  useEffect(() => {
    if (!open || !ready || result?.term === term) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/autocompletar?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        if (!res.ok) return;
        setResult({ term, items: (await res.json()) as CardSuggestion[] });
        setActive(-1);
      } catch {
        // petición cancelada (se ha seguido escribiendo) o sin conexión
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, ready, term, result]);

  function choose(item: CardSuggestion) {
    setOpen(false);
    setActive(-1);
    setQuery(item.nameEn);
    router.push(`/carta/${item.oracleId}`);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!expanded) {
        setOpen(true);
        return;
      }
      if (items.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i === -1 && step === -1 ? items.length - 1 : (i + step + items.length) % items.length));
    } else if (event.key === "Enter") {
      const item = expanded ? items[active] : undefined;
      // sin sugerencia marcada, el formulario se envía a /buscar?q=
      if (item) {
        event.preventDefault();
        choose(item);
      }
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  const large = size === "large";

  return (
    <Form action="/buscar" role="search" aria-label="Buscar cartas y producto sellado" onSubmit={() => setOpen(false)} className="relative">
      <label htmlFor={inputId} className="sr-only">
        Carta (en inglés o en español) o producto sellado
      </label>
      <div
        className={cx(
          "flex items-center border bg-surface transition focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15",
          large ? "h-14 gap-3 rounded-2xl border-line-strong pr-1.5 pl-4 shadow-card" : "h-10 gap-2 rounded-xl border-line pr-1 pl-3",
        )}
      >
        <Search aria-hidden="true" className={cx("shrink-0 text-ink-3", large ? "size-5" : "size-4")} />
        <input
          id={inputId}
          type="search"
          name="q"
          required
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (result) setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          placeholder={large ? "Relámpago, Sol Ring, Bloomburrow…" : "Busca una carta o un producto…"}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={100}
          className={cx(
            "h-full min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden",
            large ? "text-base" : "text-sm",
          )}
        />
        {large ? (
          <button type="submit" className={cx(buttonClass, "h-11 px-5")}>
            Buscar
          </button>
        ) : (
          <button
            type="submit"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-3 transition hover:bg-surface-2 hover:text-ink"
          >
            <span className="sr-only">Buscar</span>
            <Search aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>

      <div className={cx("absolute inset-x-0 top-full z-40 mt-2 text-left", !expanded && "hidden")}>
        <ul
          id={listId}
          role="listbox"
          aria-label="Sugerencias de cartas"
          className={cx("overflow-hidden rounded-2xl border border-line bg-surface py-1.5 shadow-pop", items.length === 0 && "hidden")}
        >
          {items.map((item, i) => (
            <li
              key={item.oracleId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown no quita el foco al campo, así el clic llega a la opción
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(item)}
              onMouseMove={() => setActive(i)}
              className={cx("flex cursor-pointer items-center gap-3 px-4 py-2 transition", i === active && "bg-surface-2")}
            >
              <Search aria-hidden="true" className="size-4 shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1">
                <span lang={item.lang} className="block truncate text-sm font-medium text-ink">
                  {item.matchedName}
                </span>
                {item.matchedName !== item.nameEn && (
                  <span lang="en" className="block truncate text-xs text-ink-3">
                    <span className="sr-only">, </span>
                    {item.nameEn}
                  </span>
                )}
              </span>
              <span
                aria-hidden="true"
                className="rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-3 uppercase ring-1 ring-line ring-inset"
              >
                {item.lang}
              </span>
            </li>
          ))}
        </ul>
        {noMatches && (
          <p className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink-3 shadow-pop">
            No hay cartas que empiecen así. Pulsa Intro para buscar «{term}» también en producto sellado.
          </p>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {expanded ? (items.length ? `${items.length} sugerencias, usa las flechas para elegir` : "Sin sugerencias") : ""}
      </p>
    </Form>
  );
}
