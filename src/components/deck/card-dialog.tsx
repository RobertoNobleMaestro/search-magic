"use client";

import { Scissors, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { ROLE_LABEL, type CardEvaluation } from "@/lib/deck/roles";
import type { DeckEntry } from "@/lib/deck/types";
import { formatEuros } from "@/lib/format";
import { CardImage } from "../card-image";
import { cx, ghostButtonClass, secondaryButtonClass } from "../ui";
import { cardImage, type ImageLang } from "./card-tile";

/** Ficha de una carta: texto, papel, nota con sus motivos y marcas de "no tocar" o "candidata" */
export function CardDialog({
  entry,
  evaluation,
  lang,
  isCommander,
  isProtected,
  isCandidate,
  onToggleProtected,
  onToggleCandidate,
  onClose,
}: {
  entry: DeckEntry;
  evaluation: CardEvaluation;
  lang: ImageLang;
  isCommander: boolean;
  isProtected: boolean;
  isCandidate: boolean;
  onToggleProtected?: () => void;
  onToggleCandidate?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const { card } = entry;
  const parts = [...evaluation.parts].sort((a, b) => b.points - a.points);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      aria-labelledby="ficha-carta"
      className="m-auto w-[min(56rem,calc(100%-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/50"
    >
      <div className="grid gap-6 p-5 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:p-6">
        <CardImage src={cardImage(entry, lang)} alt={`Carta ${card.nameEs ?? card.name}`} eager className="mx-auto w-56 sm:w-full" />
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="ficha-carta" className="font-display text-2xl font-semibold text-balance">
                {card.nameEs ?? card.name}
              </h2>
              {card.nameEs && card.nameEs !== card.name && (
                <p lang="en" className="text-sm text-ink-3">
                  {card.name}
                </p>
              )}
            </div>
            <button type="button" onClick={() => ref.current?.close()} className={ghostButtonClass} aria-label="Cerrar">
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
          <p className="mt-2 text-sm text-ink-2">
            {card.typeLine}
            {card.manaCost && <span className="ml-2 font-mono text-xs text-ink-3">{card.manaCost}</span>}
          </p>
          <p className="mt-1 text-sm text-ink-2">
            {card.setCode.toUpperCase()} #{card.collectorNumber} ·{" "}
            {card.priceEurCents != null ? `${formatEuros(card.priceEurCents)} en Cardmarket` : "sin precio de referencia"}
            {entry.quantity > 1 && ` · ${entry.quantity} copias`}
          </p>
          {card.oracleText && (
            <p lang="en" className="mt-3 rounded-xl bg-surface-2 p-3 text-sm leading-relaxed whitespace-pre-line text-ink-2">
              {card.oracleText}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {evaluation.roles.map((r) => (
              <span key={r} className={cx("rounded-full px-2.5 py-0.5 text-xs font-medium", r === evaluation.role ? "bg-brand-soft text-brand-strong" : "bg-surface-2 text-ink-2")}>
                {ROLE_LABEL[r]}
              </span>
            ))}
            <span className="ml-auto text-sm text-ink-2">
              Nota para el mazo: <b className="font-semibold text-ink tabular-nums">{evaluation.score}</b>
            </span>
          </div>
          {parts.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {parts.map((p) => (
                <li key={p.reason} className="flex gap-2">
                  <span className={cx("w-9 shrink-0 text-right font-semibold tabular-nums", p.points > 0 ? "text-good" : p.points < 0 ? "text-warn" : "text-ink-3")}>
                    {p.points > 0 ? `+${p.points}` : p.points}
                  </span>
                  <span className="text-ink-2">{p.reason}</span>
                </li>
              ))}
            </ul>
          )}

          {isCommander ? (
            <p className="mt-5 text-sm text-ink-3">Es tu comandante: nunca se propone para salir.</p>
          ) : (
            (onToggleProtected || onToggleCandidate) && (
              <div className="mt-5 flex flex-wrap gap-2">
                {onToggleProtected && (
                  <button type="button" onClick={onToggleProtected} aria-pressed={isProtected} className={cx(secondaryButtonClass, isProtected && "border-good text-good")}>
                    <ShieldCheck aria-hidden="true" className="size-4" />
                    {isProtected ? "Protegida: no se toca" : "No tocar"}
                  </button>
                )}
                {onToggleCandidate && (
                  <button type="button" onClick={onToggleCandidate} aria-pressed={isCandidate} className={cx(secondaryButtonClass, isCandidate && "border-warn text-warn")}>
                    <Scissors aria-hidden="true" className="size-4" />
                    {isCandidate ? "Candidata a salir" : "Marcar como candidata a salir"}
                  </button>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </dialog>
  );
}
