import type { Color } from "@/lib/deck/types";

const PIP: Record<Color, { name: string; className: string }> = {
  W: { name: "blanco", className: "bg-[#f6f1d5] text-[#5c5333]" },
  U: { name: "azul", className: "bg-[#b9d8ef] text-[#173f5f]" },
  B: { name: "negro", className: "bg-[#cbc2bf] text-[#2b2422]" },
  R: { name: "rojo", className: "bg-[#f3b9a1] text-[#6b2310]" },
  G: { name: "verde", className: "bg-[#a9d4b4] text-[#1d4a2a]" },
};

/** Símbolos de maná de una identidad de color, con la letra (el color nunca va solo) */
export function ColorPips({ colors }: { colors: Color[] }) {
  if (colors.length === 0) return <span className="text-sm text-ink-3">Incoloro</span>;
  return (
    <span className="inline-flex gap-1" role="img" aria-label={`Identidad: ${colors.map((c) => PIP[c].name).join(", ")}`}>
      {colors.map((c) => (
        <span key={c} aria-hidden="true" className={`grid size-6 place-items-center rounded-full text-xs font-bold ring-1 ring-black/10 ${PIP[c].className}`}>
          {c}
        </span>
      ))}
    </span>
  );
}
