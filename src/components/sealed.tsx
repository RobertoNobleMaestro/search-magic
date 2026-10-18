import { Boxes, Gift, Layers, Package, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { SealedSummary } from "@/lib/data/types";
import { formatEuros, plural, sealedFamily, sealedTypeLabel, type SealedFamily } from "@/lib/format";
import { cx } from "./ui";

/** Icono y color de cada familia de producto sellado (clases literales para Tailwind) */
const FAMILY: Record<SealedFamily, { icon: LucideIcon; className: string }> = {
  box: { icon: Boxes, className: "bg-brand-soft text-brand-strong" },
  bundle: { icon: Gift, className: "bg-good-soft text-good" },
  pack: { icon: Package, className: "bg-surface-2 text-ink-2 ring-1 ring-line ring-inset" },
  deck: { icon: Layers, className: "bg-cond-mt/15 text-ink ring-1 ring-cond-mt/30 ring-inset" },
  other: { icon: Package, className: "bg-surface-2 text-ink-3 ring-1 ring-line ring-inset" },
};

const SIZES = {
  sm: ["size-11 rounded-xl", "size-5"],
  md: ["size-14 rounded-2xl", "size-6"],
  lg: ["size-16 rounded-2xl sm:size-20", "size-7 sm:size-9"],
} as const;

/**
 * Hueco de imagen del producto sellado: MTGJSON no trae imágenes, así que se muestra un icono
 * con el color de su familia (caja, bundle, sobre, mazo…).
 */
export function SealedIcon({ category, size = "sm", className }: { category: string | null; size?: keyof typeof SIZES; className?: string }) {
  const { icon: Icon, className: tone } = FAMILY[sealedFamily(category)];
  const [box, icon] = SIZES[size];
  return (
    <span aria-hidden="true" className={cx("grid shrink-0 place-items-center", box, tone, className)}>
      <Icon className={icon} />
    </span>
  );
}

/** Rejilla de productos sellados con su tipo, nombre (MTGJSON, en inglés), precio mínimo y ofertas */
export function SealedProductGrid({ products, showSet = false }: { products: SealedSummary[]; showSet?: boolean }) {
  return (
    // grid-cols-[minmax(0,1fr)] y min-w-0: los nombres largos se recortan en lugar de ensanchar la página
    <ul className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((p) => (
        <li key={p.sealedProductId} className="min-w-0">
          <Link
            href={`/sellado/${p.sealedProductId}`}
            className="flex h-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 transition hover:border-line-strong hover:shadow-card"
          >
            <SealedIcon category={p.category} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {sealedTypeLabel(p.category, p.subtype)}
                {showSet && <span className="font-normal text-ink-3"> · {p.setName}</span>}
              </span>
              <span lang="en" className="block truncate text-xs text-ink-3">
                {p.name}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-sm font-semibold tabular-nums">{p.minPriceCents != null ? formatEuros(p.minPriceCents) : "—"}</span>
              <span className="block text-[11px] text-ink-3">{plural(p.offerCount, "oferta", "ofertas")}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
