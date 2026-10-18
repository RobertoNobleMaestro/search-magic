import Link from "next/link";
import type { SealedSummary } from "@/lib/data/types";
import { formatEuros, plural, sealedTypeLabel } from "@/lib/format";
import { SealedImage } from "./sealed-image";

/** Rejilla de productos sellados con su foto, tipo, nombre (MTGJSON, en inglés), precio mínimo y ofertas */
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
            <SealedImage name={p.name} category={p.category} imageUrl={p.imageUrl} setIconUrl={p.setIconUrl} />
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
