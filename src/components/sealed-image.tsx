"use client";

import { Boxes, Gift, Layers, Package, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { SealedSummary } from "@/lib/data/types";
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

/** Por tamaño: la caja (fija, para que nada salte al cargar), el margen de la foto, el símbolo y el icono */
const SIZES = {
  sm: { box: "size-11 rounded-xl", photo: "p-0.5", symbol: "size-6", icon: "size-5" },
  md: { box: "size-14 rounded-2xl", photo: "p-1", symbol: "size-8", icon: "size-6" },
  lg: { box: "size-16 rounded-2xl sm:size-20", photo: "p-1.5", symbol: "size-9 sm:size-11", icon: "size-7 sm:size-9" },
} as const;

type Props = Pick<SealedSummary, "name" | "category" | "imageUrl" | "setIconUrl"> & {
  size?: keyof typeof SIZES;
  /** la imagen principal de una página no debe cargarse en diferido */
  eager?: boolean;
  className?: string;
};

/**
 * Imagen de un producto sellado. MTGJSON no trae fotos, así que, por orden:
 *   - la foto de la tienda con la mejor oferta, entera (object-contain) sobre una caja blanca;
 *   - el símbolo de la edición (SVG de Scryfall) sobre el color de su familia;
 *   - el icono de su familia (caja, bundle, sobre, mazo…).
 * Si una imagen no carga se pasa a la siguiente. <img> normal y no next/image: las fotos vienen de
 * muchas webs y no queremos gastar la cuota de optimización de imágenes de Vercel.
 */
export function SealedImage({ name, category, imageUrl, setIconUrl, size = "sm", eager = false, className }: Props) {
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const markBroken = (src: string) => setBroken((prev) => (prev.has(src) ? prev : new Set(prev).add(src)));
  const photo = imageUrl && !broken.has(imageUrl) ? imageUrl : null;
  const symbol = !photo && setIconUrl && !broken.has(setIconUrl) ? setIconUrl : null;
  const { icon: Icon, className: tone } = FAMILY[sealedFamily(category)];
  const sizes = SIZES[size];

  if (photo) {
    return (
      <span className={cx("grid shrink-0 place-items-center overflow-hidden bg-white ring-1 ring-line ring-inset", sizes.box, sizes.photo, className)}>
        <img
          key={photo}
          src={photo}
          alt={name}
          lang="en"
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : undefined}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => markBroken(photo)}
          // la foto puede fallar antes de hidratar, cuando React aún no escucha onError
          ref={(img) => {
            if (img?.complete && img.naturalWidth === 0) markBroken(photo);
          }}
          className="size-full object-contain"
        />
      </span>
    );
  }

  return (
    <span aria-hidden="true" className={cx("grid shrink-0 place-items-center", sizes.box, tone, className)}>
      {symbol ? (
        <img
          key={symbol}
          src={symbol}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onError={() => markBroken(symbol)}
          // SVG negro: se suaviza en claro y se invierte en oscuro
          className={cx("object-contain opacity-80 dark:invert", sizes.symbol)}
        />
      ) : (
        <Icon className={sizes.icon} />
      )}
    </span>
  );
}
