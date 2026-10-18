import { Package } from "lucide-react";
import Link from "next/link";
import { cx } from "./ui";

/** Búsquedas de ejemplo: cartas sueltas y producto sellado */
const EXAMPLES: Array<{ q: string; sealed?: boolean }> = [
  { q: "Relámpago" },
  { q: "Sol Ring" },
  { q: "Contrahechizo" },
  { q: "Ragavan" },
  { q: "Bloomburrow", sealed: true },
  { q: "Bundle Duskmourn", sealed: true },
];

/** Búsquedas de ejemplo como enlaces a /buscar */
export function ExampleSearches({ className }: { className?: string }) {
  return (
    <div className={cx("flex flex-wrap items-center gap-2 text-sm text-ink-3", className)}>
      <span>Prueba con</span>
      <ul className="flex flex-wrap gap-2">
        {EXAMPLES.map(({ q, sealed }) => (
          <li key={q}>
            <Link
              href={`/buscar?q=${encodeURIComponent(q)}`}
              title={sealed ? "Producto sellado" : "Carta suelta"}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 font-medium text-ink-2 transition hover:border-brand/50 hover:text-brand-strong"
            >
              {sealed && <Package aria-hidden="true" className="size-3.5 text-ink-3" />}
              {q}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
