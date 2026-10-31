"use client";

import { Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { collectionEntries, collectionStats, groupEntries, unitPrice, type GroupMode, type SortMode } from "@/lib/collection/build";
import type { Collection, CollectionEntry } from "@/lib/collection/types";
import { formatEuros, plural } from "@/lib/format";
import { normalizeName } from "@/lib/normalize";
import { CardImage } from "../card-image";
import { ExternalLink, cx, ghostButtonClass, inputClass } from "../ui";

/** Ajustes de la vista: se recuerdan en este navegador */
interface ViewSettings {
  group: GroupMode;
  sort: SortMode;
  size: number;
  split: boolean;
  /** solo las cartas que valen al menos esto (céntimos); 0 = todas */
  minPrice: number;
}
const DEFAULTS: ViewSettings = { group: "color", sort: "cmc", size: 132, split: false, minPrice: 0 };
const SETTINGS_KEY = "search-magic:coleccion-vista:v1";

function loadSettings(): ViewSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<ViewSettings>) };
  } catch {
    return DEFAULTS;
  }
}

const GROUP_LABELS: Record<GroupMode, string> = { color: "por color", type: "por tipo", rarity: "por rareza", cmc: "por coste", none: "sin grupos" };
const SORT_LABELS: Record<SortMode, string> = {
  cmc: "coste y nombre",
  name: "nombre",
  price: "precio de mercado: mayor a menor",
  "price-asc": "precio de mercado: menor a mayor",
  number: "número",
};
const MIN_PRICE_LABELS: Record<string, string> = { "0": "cualquiera", "50": "desde 0,50 €", "100": "desde 1 €", "200": "desde 2 €", "500": "desde 5 €" };
const RARITY: Record<string, string> = { mythic: "Mítica", rare: "Rara", uncommon: "Infrecuente", common: "Común", special: "Especial", bonus: "Bonus" };

/** Color de fondo de cada separador cuando se agrupa por color */
const TINT: Record<string, string> = {
  W: "oklch(0.85 0.09 95)",
  U: "oklch(0.62 0.14 245)",
  B: "oklch(0.4 0.03 300)",
  R: "oklch(0.62 0.18 30)",
  G: "oklch(0.62 0.14 150)",
  M: "oklch(0.78 0.13 80)",
  C: "oklch(0.72 0.02 250)",
  L: "oklch(0.6 0.07 60)",
};
const SYMBOL: Record<string, string> = { W: "W", U: "U", B: "B", R: "R", G: "G", C: "C" };

const symbolUrl = (symbol: string) => `https://svgs.scryfall.io/card-symbols/${symbol.replace(/\//g, "")}.svg`;

/** La colección entera: todas las cartas a la vista, ordenadas, y las repetidas juntas */
export function CollectionView({ collection, onRename, onDelete }: { collection: Collection; onRename: (name: string) => void; onDelete: () => void }) {
  const [settings, setSettings] = useState<ViewSettings>(DEFAULTS);
  const [query, setQuery] = useState("");
  /** pestaña del grupo que se ve; "all" = todos, cada uno con su separador; "" = el primer grupo */
  const [tab, setTab] = useState("");
  const [open, setOpen] = useState<CollectionEntry | null>(null);
  const [peek, setPeek] = useState<{ src: string; x: number; y: number } | null>(null);
  const canPeek = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  /** Cambiar de pestaña; si se había bajado por la página, se vuelve al principio de las cartas */
  function selectTab(key: string) {
    setTab(key);
    const grid = gridRef.current;
    if (grid && grid.getBoundingClientRect().top < 0) grid.scrollIntoView({ block: "start" });
  }

  useEffect(() => {
    setSettings(loadSettings());
    canPeek.current = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const hide = () => setPeek(null);
    window.addEventListener("scroll", hide, { passive: true });
    return () => window.removeEventListener("scroll", hide);
  }, []);

  function update(patch: Partial<ViewSettings>) {
    const next = { ...settings, ...patch };
    // Al cambiar la forma de agrupar, las pestañas son otras
    if (patch.group && patch.group !== settings.group) setTab("");
    setSettings(next);
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // sin localStorage la vista no se recuerda; no pasa nada
    }
  }

  const entries = useMemo(() => collectionEntries(collection.lines, settings.split), [collection.lines, settings.split]);
  const stats = useMemo(() => collectionStats(collection.lines), [collection.lines]);
  const groups = useMemo(() => {
    const q = normalizeName(query);
    const shown = entries.filter(
      (e) => (!q || normalizeName(`${e.card.name} ${e.card.typeLine}`).includes(q)) && (!settings.minPrice || (e.unitCents ?? 0) >= settings.minPrice),
    );
    return groupEntries(shown, settings.group, settings.sort);
  }, [entries, query, settings.group, settings.sort, settings.minPrice]);
  // Se empieza por el primer grupo; si la pestaña elegida se queda vacía (por la búsqueda o
  // el filtro de precio), se pasa al primer grupo que tenga cartas
  const activeTab = settings.group === "none" || tab === "all" ? "all" : groups.some((g) => g.key === tab) ? tab : (groups[0]?.key ?? "all");
  const visible = activeTab === "all" ? groups : groups.filter((g) => g.key === activeTab);
  const shownCount = groups.reduce((s, g) => s + g.count, 0);
  const priciest = useMemo(() => [...entries].filter((e) => e.unitCents != null).sort((a, b) => b.unitCents! - a.unitCents!)[0], [entries]);

  /** Vista ampliada al lado de la carta (a la derecha si cabe; si no, a la izquierda) */
  function showPeek(entry: CollectionEntry, target: HTMLElement) {
    if (!canPeek.current || !entry.card.imageUrl || window.innerWidth < 720) return;
    const r = target.getBoundingClientRect();
    const width = 300;
    const height = Math.round((width * 680) / 488);
    const x = r.right + 14 + width <= window.innerWidth - 8 ? r.right + 14 : r.left - 14 - width;
    const y = Math.min(Math.max(8, r.top + r.height / 2 - height / 2), window.innerHeight - height - 8);
    setPeek({ src: entry.card.imageUrl, x, y });
  }

  return (
    <div>
      {/* Cabecera */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Nombre de la colección</span>
          <input
            value={collection.name}
            onChange={(e) => onRename(e.target.value)}
            className="w-full rounded-lg bg-transparent font-display text-3xl font-semibold tracking-tight outline-none focus:bg-surface-2"
          />
        </label>
        <button type="button" onClick={() => window.confirm(`¿Borrar «${collection.name}» de este navegador?`) && onDelete()} className={ghostButtonClass}>
          <Trash2 aria-hidden="true" className="size-4" />
          Borrar colección
        </button>
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2">
        <Stat label="Cartas" value={String(stats.cards)} extra={stats.tokens ? `+ ${plural(stats.tokens, "ficha", "fichas")}` : undefined} />
        <Stat label="Distintas" value={String(stats.distinct)} />
        <Stat label="Foil" value={String(stats.foil)} />
        <Stat label="Valor hoy" value={formatEuros(stats.valueCents)} extra="Cardmarket" />
        {stats.paidCents > 0 && <Stat label="Al añadirlas" value={formatEuros(stats.paidCents)} />}
        {priciest && <Stat label="La más cara" value={priciest.card.name} extra={formatEuros(priciest.unitCents!)} />}
      </dl>

      {/* Controles, fijos debajo de la cabecera de la web */}
      <div className="sticky top-16 z-20 -mx-4 mt-4 border-b border-line bg-canvas/90 px-4 py-2.5 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <label className="relative w-full sm:w-64">
            <span className="sr-only">Buscar carta</span>
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar carta o tipo…" className={cx(inputClass, "h-9 pl-9")} />
          </label>
          <Select label="Agrupar" value={settings.group} options={GROUP_LABELS} onChange={(group) => update({ group })} />
          <Select label="Ordenar" value={settings.sort} options={SORT_LABELS} onChange={(sort) => update({ sort })} />
          <Select label="Precio" value={String(settings.minPrice)} options={MIN_PRICE_LABELS} onChange={(v) => update({ minPrice: Number(v) })} />
          <label className="flex items-center gap-2 text-ink-3">
            Tamaño
            <input type="range" min={90} max={240} step={4} value={settings.size} onChange={(e) => update({ size: Number(e.target.value) })} className="w-24 accent-brand" />
          </label>
          <label className="flex items-center gap-2 text-ink-3" title="Cada impresión distinta de una carta (p. ej. una versión sin borde) en su propio hueco">
            <input type="checkbox" checked={settings.split} onChange={(e) => update({ split: e.target.checked })} className="accent-brand" />
            Separar versiones
          </label>
        </div>

        {/* Pestañas: todos los grupos o uno solo */}
        {settings.group !== "none" && groups.length > 0 && (
          <div role="tablist" aria-label="Grupos" className="-mx-1 mt-2.5 flex gap-1 overflow-x-auto px-1 pb-0.5">
            {groups.map((g) => (
              <TabButton
                key={g.key}
                active={activeTab === g.key}
                onClick={() => selectTab(g.key)}
                label={g.label}
                count={g.count}
                icon={settings.group === "color" ? <GroupIcon groupKey={g.key} className="size-4" /> : undefined}
              />
            ))}
            <span aria-hidden="true" className="mx-1 w-px shrink-0 self-stretch bg-line" />
            <TabButton active={activeTab === "all"} onClick={() => selectTab("all")} label="Todas" count={shownCount} />
          </div>
        )}
      </div>

      {/* Cada grupo con su separador encima y sus cartas debajo */}
      {visible.length === 0 ? (
        <p className="py-12 text-center text-ink-3">{query || settings.minPrice ? "Ninguna carta coincide con la búsqueda o el filtro de precio." : "No hay cartas."}</p>
      ) : (
        <div ref={gridRef} className="mt-5 scroll-mt-48 space-y-8" onMouseLeave={() => setPeek(null)}>
          {visible.map((group) => (
            <section key={group.key} aria-label={group.label}>
              {/* El separador solo hace falta cuando se ven todos los grupos a la vez */}
              {settings.group !== "none" && activeTab === "all" && <GroupHeading groupKey={group.key} label={group.label} count={group.count} byColor={settings.group === "color"} />}
              <ul className="mt-3 grid gap-x-2.5 gap-y-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${settings.size}px, calc((100% - 20px) / 3)), 1fr))` }}>
                {group.entries.map((entry) => (
                  <li key={entry.key}>
                    <Tile entry={entry} onOpen={() => setOpen(entry)} onHover={(el) => showPeek(entry, el)} onLeave={() => setPeek(null)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {peek && (
        <div aria-hidden="true" className="pointer-events-none fixed z-50 w-[300px] overflow-hidden rounded-card shadow-pop" style={{ left: peek.x, top: peek.y }}>
          <img src={peek.src} alt="" width={488} height={680} className="block aspect-[488/680] w-full" />
        </div>
      )}

      {open && <EntryDialog key={open.key} entry={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Stat({ label, value, extra }: { label: string; value: string; extra?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt>{label}</dt>
      <dd className="font-semibold text-ink tabular-nums">{value}</dd>
      {extra && <dd className="text-ink-3">{extra}</dd>}
    </div>
  );
}

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Record<T, string>; onChange: (value: T) => void }) {
  return (
    <label className="flex items-center gap-2 text-ink-3">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className={cx(inputClass, "h-9 w-auto py-0 text-ink")}>
        {(Object.keys(options) as T[]).map((k) => (
          <option key={k} value={k}>
            {options[k]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Símbolo de maná del grupo de color (dorado para multicolor; nada para tierras y fichas) */
function GroupIcon({ groupKey, className }: { groupKey: string; className: string }) {
  if (SYMBOL[groupKey]) return <img src={symbolUrl(SYMBOL[groupKey])} alt="" className={className} />;
  if (groupKey === "M") return <span aria-hidden="true" className={cx("inline-block rounded-full bg-linear-135 from-[oklch(0.85_0.12_90)] to-[oklch(0.7_0.13_70)] ring-1 ring-black/20", className)} />;
  return null;
}

function TabButton({ active, onClick, label, count, icon }: { active: boolean; onClick: () => void; label: string; count: number; icon?: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition",
        active ? "bg-ink text-canvas" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
      )}
    >
      {icon}
      {label}
      <span className={cx("text-xs tabular-nums", active ? "text-canvas/70" : "text-ink-3")}>{count}</span>
    </button>
  );
}

/** Separador de grupo: título de lado a lado con una franja del color del grupo */
function GroupHeading({ groupKey, label, count, byColor }: { groupKey: string; label: string; count: number; byColor: boolean }) {
  const tint = byColor ? TINT[groupKey] : undefined;
  const bar: CSSProperties = { background: tint ? `color-mix(in oklab, ${tint} 70%, var(--line))` : "var(--line-strong)" };
  return (
    <div className="flex items-center gap-3">
      {byColor && <GroupIcon groupKey={groupKey} className="size-7" />}
      <h2 id={`grupo-${groupKey}`} className="font-display text-2xl font-semibold tracking-tight">
        {label}
      </h2>
      <span className="text-sm text-ink-3 tabular-nums">{plural(count, "carta", "cartas")}</span>
      <span aria-hidden="true" className="h-1 flex-1 rounded-full" style={bar} />
    </div>
  );
}

function Tile({ entry, onOpen, onHover, onLeave }: { entry: CollectionEntry; onOpen: () => void; onHover: (el: HTMLElement) => void; onLeave: () => void }) {
  const { card, quantity, foil, versions } = entry;
  const allFoil = foil === quantity;
  const label = [card.name, quantity > 1 && `${quantity} copias`, foil > 0 && (allFoil ? "foil" : `${foil} foil`), versions > 1 && `${versions} versiones`].filter(Boolean).join(", ");
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={(e) => onHover(e.currentTarget.firstElementChild as HTMLElement)}
      onMouseLeave={onLeave}
      title={label}
      aria-label={label}
      className="group block w-full rounded-card text-left outline-none focus-visible:ring-4 focus-visible:ring-brand/30"
    >
      <span className="relative block">
        <CardImage src={card.imageUrl} alt={`Carta ${card.name}`} size="normal" className="shadow-sm transition group-hover:-translate-y-0.5 group-hover:shadow-card" />
        {allFoil && <span aria-hidden="true" className="finish-foil pointer-events-none absolute inset-0 rounded-card opacity-45 mix-blend-soft-light" />}
        {(quantity > 1 || foil > 0) && (
          <span className="absolute top-[3.5%] right-[4%] flex gap-1">
            {quantity > 1 && <span className="rounded-full bg-ink/85 px-1.5 text-[11px] leading-4 font-bold text-canvas tabular-nums shadow">×{quantity}</span>}
            {foil > 0 && <span className="finish-foil rounded-full px-1.5 text-[11px] leading-4 font-bold shadow">{allFoil ? "✦" : `${foil}✦`}</span>}
          </span>
        )}
      </span>
      <span className="mt-1 flex items-baseline justify-between gap-2 px-0.5 text-xs">
        <span className="truncate text-ink-2">
          {card.name}
          {versions > 1 && <span className="text-ink-3"> · {versions} v.</span>}
        </span>
        <span className="shrink-0 font-medium text-ink tabular-nums" title="Precio de mercado por copia (Cardmarket)">
          {entry.unitCents != null ? formatEuros(entry.unitCents) : "—"}
        </span>
      </span>
    </button>
  );
}

/** Coste de maná con los símbolos de Scryfall: "{2}{U} // {R}" */
function ManaCost({ cost }: { cost: string }) {
  if (!cost) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-0.5 align-middle" aria-label={`Coste ${cost}`}>
      {cost.split(/(\{[^}]+\})/).filter(Boolean).map((part, i) =>
        part.startsWith("{") ? <img key={i} src={symbolUrl(part.slice(1, -1))} alt="" className="size-4" /> : <span key={i} className="px-1 text-ink-3">{part.trim()}</span>,
      )}
    </span>
  );
}

/** Ficha de una carta: imágenes de cada versión, texto y una fila por versión y acabado */
function EntryDialog({ entry, onClose }: { entry: CollectionEntry; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const { card } = entry;
  const versions = [...new Map(entry.lines.map((l) => [l.card.scryfallId, l.card])).values()];
  const images = versions.flatMap((v) => [v.imageUrl, v.imageUrlBack ?? null]).filter((src): src is string => Boolean(src));

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      aria-labelledby="ficha-coleccion"
      className="m-auto w-[min(56rem,calc(100%-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/50"
    >
      <div className="grid gap-6 p-5 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:p-6">
        <div className="mx-auto grid w-56 gap-3 sm:w-full">
          {images.map((src, i) => (
            <CardImage key={src} src={src} alt={`Carta ${card.name}${i ? ` (${i + 1})` : ""}`} eager />
          ))}
        </div>
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <h2 id="ficha-coleccion" className="font-display text-2xl font-semibold text-balance">
              {card.name}
            </h2>
            <button type="button" onClick={() => ref.current?.close()} className={ghostButtonClass} aria-label="Cerrar">
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
          <p className="mt-1 text-sm text-ink-2">
            {card.typeLine} <ManaCost cost={card.manaCost} />
          </p>
          <p className="mt-1 text-sm text-ink-2">
            {card.setName ?? card.setCode.toUpperCase()}
            {card.rarity && ` · ${RARITY[card.rarity] ?? card.rarity}`} · <b className="font-semibold text-ink">{plural(entry.quantity, "copia", "copias")}</b>
            {entry.versions > 1 && ` en ${entry.versions} versiones`}
          </p>
          {card.oracleText && (
            <p lang="en" className="mt-3 rounded-xl bg-surface-2 p-3 text-sm leading-relaxed whitespace-pre-line text-ink-2">
              {card.oracleText}
            </p>
          )}
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="py-1.5 pr-2 font-medium">Versión</th>
                <th className="py-1.5 pr-2 font-medium">Acabado</th>
                <th className="py-1.5 pr-2 text-right font-medium">Copias</th>
                <th className="py-1.5 pr-2 text-right font-medium">Hoy (ud.)</th>
                <th className="py-1.5 text-right font-medium">Al añadirla</th>
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((line) => {
                const unit = unitPrice(line);
                return (
                  <tr key={`${line.card.scryfallId}|${line.finish}`} className="border-b border-line tabular-nums">
                    <td className="py-2 pr-2">
                      <ExternalLink href={`https://scryfall.com/card/${line.card.setCode}/${encodeURIComponent(line.card.collectorNumber)}`} className="inline-flex items-center gap-1 font-medium text-brand-strong hover:underline">
                        {line.card.setCode.toUpperCase()} #{line.card.collectorNumber}
                      </ExternalLink>
                    </td>
                    <td className="py-2 pr-2">
                      {line.finish === "normal" ? "Normal" : <span className="finish-foil rounded-full px-2 py-0.5 text-xs font-semibold">{line.finish === "foil" ? "Foil" : "Etched"}</span>}
                    </td>
                    <td className="py-2 pr-2 text-right">{line.quantity}</td>
                    <td className="py-2 pr-2 text-right">{unit != null ? formatEuros(unit) : "—"}</td>
                    <td className="py-2 text-right">{line.paidCents != null ? formatEuros(Math.round(line.paidCents / line.quantity)) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </dialog>
  );
}
