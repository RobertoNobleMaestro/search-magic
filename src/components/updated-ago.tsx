import { TriangleAlert } from "lucide-react";
import { STALE_HOURS, formatDateTime, isStale, timeAgo } from "@/lib/format";
import { cx } from "./ui";

interface Props {
  /** null = nunca se ha actualizado */
  iso: string | null;
  /** el mismo instante para toda la página */
  now: Date;
  /** texto delante: "actualizado" → "actualizado hace 3 h" */
  prefix?: string;
  className?: string;
}

/** "hace 3 h", en ámbar y con aviso si los datos tienen más de 24 h (freshness de la maqueta) */
export function UpdatedAgo({ iso, now, prefix, className }: Props) {
  const lead = prefix ? `${prefix} ` : "";
  if (!iso) {
    return (
      <span className={cx("inline-flex items-center gap-1 font-medium whitespace-nowrap text-warn", className)}>
        <TriangleAlert aria-hidden="true" className="size-3 shrink-0" />
        {lead}sin datos
      </span>
    );
  }
  const stale = isStale(iso, now);
  return (
    <time
      dateTime={iso}
      title={stale ? `${formatDateTime(iso)} · datos de hace más de ${STALE_HOURS} h: puede haber cambiado` : formatDateTime(iso)}
      className={cx("inline-flex items-center gap-1 whitespace-nowrap", stale && "font-medium text-warn", className)}
    >
      {stale && <TriangleAlert aria-hidden="true" className="size-3 shrink-0" />}
      {lead}
      {timeAgo(iso, now)}
      {stale && <span className="sr-only"> (datos de hace más de {STALE_HOURS} horas)</span>}
    </time>
  );
}
