import { Globe, Store as StoreIcon } from "lucide-react";
import type { Condition, Finish, Lang, OfferStore } from "@/lib/data/types";
import { conditionLabel, finishLabel, languageLabel } from "@/lib/format";
import { SparkIcon } from "./icons";
import { cx } from "./ui";

/*
 * Etiquetas pequeñas de una copia y de una tienda (condBadge, langChip, finishChip, setChip y
 * bestBadge de design/index.html). Las clases de cada estado van en mapas con clases literales
 * para que Tailwind las encuentre al compilar.
 */

/** Caja y punto de color de cada estado, con la escala y los colores de Cardmarket */
const CONDITION_CLASS: Record<Condition, [box: string, dot: string]> = {
  MT: ["bg-cond-mt/15 ring-cond-mt/45", "bg-cond-mt"],
  NM: ["bg-cond-nm/15 ring-cond-nm/45", "bg-cond-nm"],
  EX: ["bg-cond-ex/15 ring-cond-ex/50", "bg-cond-ex"],
  GD: ["bg-cond-gd/20 ring-cond-gd/55", "bg-cond-gd"],
  LP: ["bg-cond-lp/15 ring-cond-lp/50", "bg-cond-lp"],
  PL: ["bg-cond-pl/15 ring-cond-pl/45", "bg-cond-pl"],
  PO: ["bg-cond-po/15 ring-cond-po/45", "bg-cond-po"],
};

const chipBase = "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] ring-1 ring-inset";

/** Estado de la copia: código y color de Cardmarket, con el nombre completo (o "Estado ?" si la tienda no lo indica) */
export function ConditionBadge({ condition, showName = false }: { condition: Condition | null; showName?: boolean }) {
  if (!condition) {
    return (
      <span className={cx(chipBase, "font-medium text-ink-3 italic ring-line-strong")} title="La tienda no indica el estado">
        Estado ?
      </span>
    );
  }
  const [box, dot] = CONDITION_CLASS[condition];
  return (
    <span
      className={cx(chipBase, "gap-1 font-mono font-semibold whitespace-nowrap text-ink", box)}
      title={`${condition} · ${conditionLabel(condition)}`}
    >
      <span aria-hidden="true" className={cx("size-1.5 rounded-full", dot)} />
      {condition}
      {showName ? (
        <span className="font-sans font-medium text-ink-2">{conditionLabel(condition)}</span>
      ) : (
        <span className="sr-only"> ({conditionLabel(condition)})</span>
      )}
    </span>
  );
}

/** Idioma: código de Scryfall en mayúsculas y el nombre en el título */
export function LanguageChip({ lang }: { lang: Lang | null }) {
  if (!lang) {
    return (
      <span className={cx(chipBase, "text-ink-3 italic ring-line-strong")} title="Idioma desconocido">
        ?<span className="sr-only"> (idioma desconocido)</span>
      </span>
    );
  }
  return (
    <span className={cx(chipBase, "bg-surface font-mono font-semibold text-ink-2 uppercase ring-line-strong")} title={languageLabel(lang)}>
      {lang}
      <span className="sr-only"> ({languageLabel(lang)})</span>
    </span>
  );
}

/** Acabado: tornasol para foil, metal para etched; las normales no llevan etiqueta */
export function FinishChip({ finish }: { finish: Finish }) {
  if (finish === "foil") {
    return (
      <span className="finish-foil inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold">
        <SparkIcon className="size-2.5" />
        {finishLabel(finish)}
      </span>
    );
  }
  if (finish === "etched") {
    return <span className="finish-etched inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold">{finishLabel(finish)}</span>;
  }
  return null;
}

/** Código de edición en Geist Mono */
export function SetChip({ code, title }: { code: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex h-5 shrink-0 items-center rounded-[5px] bg-surface-2 px-1.5 font-mono text-[10.5px] font-semibold tracking-wide text-ink-2 uppercase ring-1 ring-line ring-inset"
    >
      {code}
    </span>
  );
}

/**
 * Símbolo de la edición (SVG de Scryfall, en negro), decorativo: va junto al código. Caja fija de
 * 16 px para que no salte nada al cargar; en modo oscuro se invierte para que se vea.
 */
export function SetIcon({ src, className }: { src: string | null | undefined; className?: string }) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      decoding="async"
      className={cx("size-4 shrink-0 object-contain opacity-80 dark:invert", className)}
    />
  );
}

/** "Mejor precio": lo único dorado de la página, solo para la oferta más barata con stock */
export function BestBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gold-soft px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-gold-ink ring-1 ring-gold/60 ring-inset">
      <SparkIcon className="size-2.5" />
      Mejor precio
    </span>
  );
}

/** "Tienda física · Barcelona" u "Online · Madrid" */
export function StoreKindBadge({ store, className }: { store: Pick<OfferStore, "local" | "city">; className?: string }) {
  const Icon = store.local ? StoreIcon : Globe;
  return (
    <span
      className={cx(
        "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        store.local ? "bg-brand-soft text-brand-strong" : "bg-surface-2 text-ink-2 ring-1 ring-line ring-inset",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3 shrink-0" />
      <span className="truncate">
        {`${store.local ? "Tienda física" : "Online"}${store.city ? ` · ${store.city}` : ""}`}
      </span>
    </span>
  );
}

/** La oferta sale del stock de Cardmarket que comparte la tienda */
export function CardmarketBadge({ className }: { className?: string }) {
  return (
    <span
      title="La tienda vende esta copia por Cardmarket y nos comparte su stock"
      className={cx(
        "inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-ink-2 ring-1 ring-line ring-inset",
        className,
      )}
    >
      <span aria-hidden="true" className="grid size-3 place-items-center rounded-[3px] bg-ink-2 font-mono text-[8px] leading-none font-bold text-surface">
        C
      </span>
      Vía Cardmarket
    </span>
  );
}
