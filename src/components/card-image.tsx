import { cx } from "./ui";

interface Props {
  src: string | null;
  alt: string;
  /** "small" pide a Scryfall la miniatura (146 × 204) en vez de la imagen normal (488 × 680) */
  size?: "small" | "normal";
  /** la imagen principal de una página no debe cargarse en diferido */
  eager?: boolean;
  className?: string;
}

/**
 * Imagen de carta servida por cards.scryfall.io, con la proporción y las esquinas de una carta
 * física. El ancho lo pone className; mientras carga (o si no hay imagen) se ve el nombre.
 */
export function CardImage({ src, alt, size = "normal", eager = false, className }: Props) {
  return (
    <div className={cx("relative aspect-[488/680] overflow-hidden rounded-card bg-surface-3", className)}>
      <span aria-hidden="true" className="absolute inset-0 grid place-items-center p-3 text-center font-display text-sm text-ink-3">
        {src ? alt.replace(/^Carta /, "") : "Sin imagen"}
      </span>
      {src ? (
        <img
          src={size === "small" ? src.replace("/normal/", "/small/") : src}
          alt={alt}
          width={488}
          height={680}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : undefined}
          decoding="async"
          className="relative block size-full object-cover"
        />
      ) : (
        <span role="img" aria-label={alt} className="absolute inset-0" />
      )}
    </div>
  );
}
