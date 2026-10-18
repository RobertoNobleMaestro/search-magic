import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

/** Une clases condicionales: cx("a", activo && "b") */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/*
 * Clases compartidas, las del objeto UI de design/index.html: todas con los tokens de
 * src/app/globals.css (nada de violet-* ni neutral-*).
 */

/** Ancho y márgenes de las páginas */
export const containerClass = "mx-auto w-full max-w-6xl px-4 sm:px-6";
export const pageClass = `${containerClass} py-8 sm:py-12`;

/** Enlace de texto con el color de acento */
export const linkClass = "font-medium text-brand-strong underline-offset-4 hover:underline";

/** Botones (también para enlaces con aspecto de botón) */
export const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand shadow-sm transition hover:bg-brand-strong";
export const secondaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface px-3.5 py-2 text-sm font-medium text-ink transition hover:bg-surface-2";
export const ghostButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-ink-2 transition hover:bg-surface-2 hover:text-ink";
export const smallButtonClass =
  "inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-ink transition hover:border-brand hover:text-brand-strong";

/** Caja con borde para agrupar contenido */
export const panelClass = "rounded-2xl border border-line bg-surface";

/** Antetítulo en versalitas pequeñas */
export const eyebrowClass = "text-xs font-semibold tracking-[0.12em] text-ink-3 uppercase";

/** Campo de texto y selector */
export const inputClass =
  "h-10 w-full rounded-xl border border-line-strong bg-surface px-3 text-sm text-ink outline-none transition placeholder:text-ink-3 focus:border-brand focus:ring-4 focus:ring-brand/15";

/** Título de página en Fraunces */
export const titleClass = "font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl";

/** Enlace a una web de fuera (tiendas, Cardmarket): pestaña nueva, sin referer y sin pasar posicionamiento */
export function ExternalLink({
  href,
  children,
  className,
  label,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  /** texto para lectores de pantalla en lugar del aviso genérico */
  label?: string;
}) {
  return (
    // relative: el sr-only (absolute) queda dentro del enlace y no se escapa de una caja con scroll
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={cx("relative", className)}>
      {children}
      <ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only">{label ? ` ${label}` : ""} (se abre en una pestaña nueva)</span>
    </a>
  );
}

/** Vacío con icono, título y texto (sin resultados, sin ofertas…) */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-12 text-center", className)}>
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-surface-2 text-ink-3 [&>svg]:size-6">
        {icon}
      </span>
      <p className="mt-4 font-display text-xl font-semibold text-balance">{title}</p>
      {children && <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-pretty text-ink-2">{children}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Aviso en línea: informativo (gris) o de cuidado (ámbar) */
export function Notice({ tone = "info", icon, children, className }: { tone?: "info" | "warn"; icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <p
      className={cx(
        "flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-sm leading-relaxed [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
        tone === "warn" ? "bg-warn-soft text-warn" : "bg-surface-2 text-ink-2",
        className,
      )}
    >
      {icon}
      <span>{children}</span>
    </p>
  );
}
