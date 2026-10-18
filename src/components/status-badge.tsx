import { statusLabel, type RunStatus } from "@/lib/format";
import { cx } from "./ui";

const STATUS_CLASS: Record<RunStatus | "none", string> = {
  ok: "bg-good-soft text-good",
  partial: "bg-warn-soft text-warn",
  error: "bg-bad-soft text-bad",
  skipped: "bg-surface-2 text-ink-3",
  running: "bg-brand-soft text-brand-strong",
  none: "bg-surface-2 text-ink-3",
};

/** Estado del scraping de una tienda o de una ejecución: OK, Parcial, Error, Omitida… */
export function StatusBadge({ status, className }: { status: RunStatus | null; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        STATUS_CLASS[status ?? "none"],
        className,
      )}
    >
      <span aria-hidden="true" className={cx("size-1.5 rounded-full bg-current", status === "running" && "animate-pulse")} />
      {statusLabel(status)}
    </span>
  );
}
