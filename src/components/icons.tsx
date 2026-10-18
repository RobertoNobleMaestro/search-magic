/**
 * Iconos propios. El resto son de lucide-react; todos heredan el color del texto y son
 * decorativos (aria-hidden).
 */

type IconProps = { className?: string };

/** Destello de cuatro puntas: "Mejor precio" y foil */
export function SparkIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 2c.6 5.5 4.5 9.4 10 10-5.5.6-9.4 4.5-10 10-.6-5.5-4.5-9.4-10-10 5.5-.6 9.4-4.5 10-10Z" />
    </svg>
  );
}

/** Logotipo: lupa con destello dorado sobre violeta de maná */
export function LogoMark({ className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <circle cx="14" cy="14" r="7.2" fill="none" stroke="var(--on-brand)" strokeWidth="2.6" />
      <path d="m19.4 19.4 5.4 5.4" stroke="var(--on-brand)" strokeWidth="3" strokeLinecap="round" />
      <path
        d="M14 9.4c.3 2.5 2.1 4.3 4.6 4.6-2.5.3-4.3 2.1-4.6 4.6-.3-2.5-2.1-4.3-4.6-4.6 2.5-.3 4.3-2.1 4.6-4.6Z"
        fill="var(--gold)"
      />
    </svg>
  );
}

/** Logotipo y nombre: "search" en Geist y "magic" en Fraunces cursiva */
export function Wordmark({ className = "text-[17px]" }: { className?: string }) {
  return (
    <span className={`${className} font-semibold tracking-tight text-ink`}>
      search<span className="font-display font-semibold text-brand-strong italic">magic</span>
    </span>
  );
}
