import { Boxes, Gift, Layers, Package, type LucideIcon } from "lucide-react";
import { sealedFamily, type SealedFamily } from "@/lib/format";
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
