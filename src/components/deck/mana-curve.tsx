import { plural } from "@/lib/format";

/**
 * Curva de maná: cuántas cartas (sin contar tierras) cuestan 0, 1, … 6 y 7 o más.
 * Una sola serie: un color, sin leyenda; el valor de cada barra sale al pasar por encima o al
 * enfocarla, y la tabla oculta lo da a los lectores de pantalla.
 */
export function ManaCurve({ curve, average }: { curve: number[]; average: number }) {
  const max = Math.max(1, ...curve);
  const labels = curve.map((_, i) => (i === curve.length - 1 ? `${i}+` : String(i)));
  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-ink">Curva de maná</span>
        <span className="text-ink-3">coste medio {average.toFixed(2).replace(".", ",")}</span>
      </figcaption>
      <div aria-hidden="true" className="mt-3 flex h-32 items-end gap-1.5 border-b border-line-strong">
        {curve.map((count, i) => (
          <div key={labels[i]} className="group relative flex h-full flex-1 items-end">
            <div
              tabIndex={0}
              title={`${labels[i]} de maná: ${plural(count, "carta", "cartas")}`}
              style={{ height: `${(count / max) * 100}%` }}
              className="min-h-px w-full rounded-t-[4px] bg-brand transition outline-none group-hover:bg-brand-strong focus-visible:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
            />
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-canvas opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
              {count}
            </span>
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="mt-1 flex gap-1.5 text-center text-[11px] text-ink-3 tabular-nums">
        {labels.map((l) => (
          <span key={l} className="flex-1">
            {l}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Cartas por coste de maná (sin tierras)</caption>
        <thead>
          <tr>
            <th scope="col">Coste</th>
            <th scope="col">Cartas</th>
          </tr>
        </thead>
        <tbody>
          {curve.map((count, i) => (
            <tr key={labels[i]}>
              <th scope="row">{labels[i]}</th>
              <td>{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
