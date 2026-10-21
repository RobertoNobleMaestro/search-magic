"use client";

import { ArrowRight, Check, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { useMemo } from "react";
import { addToPool } from "@/lib/deck/build";
import { applySwaps, displayName, recommendSwaps } from "@/lib/deck/recommend";
import { ROLE_LABEL, evaluateCard } from "@/lib/deck/roles";
import type { Color, Deck, DeckEntry, Swap } from "@/lib/deck/types";
import { formatEuros, plural } from "@/lib/format";
import { CardImage } from "../card-image";
import { buttonClass, cx, ghostButtonClass, inputClass, secondaryButtonClass, smallButtonClass } from "../ui";
import { cardImage, type ImageLang } from "./card-tile";
import { ImportPanel } from "./import-panel";

const isLand = (e: DeckEntry) => /\bLand\b/.test(e.card.typeLine.split(" // ")[0] ?? "");

/**
 * Cartas nuevas (mejoras o compras) y los cambios "sale → entra". El recomendador propone; el
 * usuario puede cambiar qué sale, descartar una carta nueva o meter una que no se propuso.
 */
export function UpgradePanel({
  deck,
  identity,
  lang,
  onChange,
  onOpen,
}: {
  deck: Deck;
  identity: Color[];
  lang: ImageLang;
  onChange: (deck: Deck) => void;
  onOpen: (entry: DeckEntry) => void;
}) {
  const pool = useMemo(() => deck.pool.filter((e) => !deck.dismissedIds.includes(e.card.oracleId)), [deck.pool, deck.dismissedIds]);
  const recommendation = useMemo(
    () =>
      recommendSwaps({
        cards: deck.cards,
        pool,
        commanderId: deck.commanderId,
        protectedIds: deck.protectedIds,
        cutCandidateIds: deck.cutCandidateIds,
      }),
    [deck.cards, pool, deck.commanderId, deck.protectedIds, deck.cutCandidateIds],
  );
  const swaps = deck.swaps.length > 0 ? deck.swaps : recommendation.swaps;
  const find = (list: DeckEntry[], oracleId: string) => list.find((e) => e.card.oracleId === oracleId);
  const inIds = new Set(swaps.map((s) => s.inId));
  const rejectedIds = new Set(recommendation.rejected.map((r) => r.card.oracleId));
  // cartas nuevas que podrían entrar pero no tienen pareja
  const unpaired = pool.filter((e) => !inIds.has(e.card.oracleId) && !rejectedIds.has(e.card.oracleId));
  const whyNot = new Map(recommendation.notBetter.map((r) => [r.card.oracleId, r.reason]));

  const update = (patch: Partial<Deck>) => onChange({ ...deck, ...patch, updatedAt: new Date().toISOString() });
  const setSwaps = (next: Swap[]) => update({ swaps: next });

  /** Qué puede salir por una carta nueva: del mismo tipo (tierra por tierra), sin comandante ni protegidas */
  function outOptions(incoming: DeckEntry, current?: Swap): DeckEntry[] {
    const taken = new Map<string, number>();
    for (const s of swaps) if (s !== current) taken.set(s.outId, (taken.get(s.outId) ?? 0) + 1);
    return deck.cards
      .filter((e) => e.card.oracleId !== deck.commanderId && !deck.protectedIds.includes(e.card.oracleId))
      .filter((e) => isLand(e) === isLand(incoming))
      .filter((e) => (taken.get(e.card.oracleId) ?? 0) < e.quantity)
      .sort((a, b) => evaluateCard(a.card, identity).score - evaluateCard(b.card, identity).score || displayName(a.card).localeCompare(displayName(b.card), "es"));
  }

  function chooseOut(incoming: DeckEntry, outId: string, current?: Swap) {
    const swap: Swap = { outId, inId: incoming.card.oracleId, reason: "Lo has elegido tú.", source: "manual" };
    setSwaps(current ? swaps.map((s) => (s === current ? swap : s)) : [...swaps, swap]);
  }

  function dismiss(inId: string) {
    update({ dismissedIds: [...deck.dismissedIds, inId], swaps: swaps.filter((s) => s.inId !== inId) });
  }

  function apply() {
    const next = applySwaps(deck, swaps);
    onChange({ ...next, swaps: [] });
  }

  if (deck.pool.length === 0) {
    return (
      <ImportPanel
        compact
        title="Cartas nuevas"
        help="Importa las cartas que te han dado o que has comprado (otro CSV de ManaBox o una lista) y te propongo por cuál cambiar cada una."
        submitLabel="Añadir y recomendar cambios"
        onImported={(r) => onChange(addToPool(deck, r.cards))}
      />
    );
  }

  const priceDelta = swaps.reduce((sum, s) => sum + (find(pool, s.inId)?.card.priceEurCents ?? 0) - (find(deck.cards, s.outId)?.card.priceEurCents ?? 0), 0);

  return (
    <section aria-labelledby="cambios" className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="cambios" className="font-display text-2xl font-semibold">
            Cambios propuestos
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            {plural(pool.length, "carta nueva", "cartas nuevas")} · {plural(swaps.length, "cambio", "cambios")}. Cada carta nueva sustituye a la más floja de su mismo papel; las
            tierras, a tierras. El mazo sigue en 100 y dentro de la identidad del comandante.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(deck.swaps.length > 0 || deck.dismissedIds.length > 0) && (
            <button type="button" onClick={() => update({ swaps: [], dismissedIds: [] })} className={secondaryButtonClass}>
              <RotateCcw aria-hidden="true" className="size-4" />
              Volver a la propuesta
            </button>
          )}
          <button type="button" onClick={() => update({ pool: [], swaps: [], dismissedIds: [] })} className={ghostButtonClass}>
            <Trash2 aria-hidden="true" className="size-4" />
            Quitar las cartas nuevas
          </button>
        </div>
      </div>

      {swaps.length > 0 && (
        <>
          <ol className="mt-5 space-y-3">
            {swaps.map((swap) => {
              const out = find(deck.cards, swap.outId);
              const incoming = find(pool, swap.inId);
              if (!out || !incoming) return null;
              const evIn = evaluateCard(incoming.card, identity);
              const evOut = evaluateCard(out.card, identity);
              return (
                <li key={`${swap.inId}-${swap.outId}`} className="grid gap-4 rounded-xl border border-line p-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:p-4">
                  <div className="flex items-center gap-2">
                    <PairCard entry={out} lang={lang} label="Sale" onOpen={() => onOpen(out)} />
                    <ArrowRight aria-label="por" className="size-5 shrink-0 text-ink-3" />
                    <PairCard entry={incoming} lang={lang} label="Entra" onOpen={() => onOpen(incoming)} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium">
                      <span className="text-ink-3 line-through decoration-ink-3/60">{displayName(out.card)}</span> → {displayName(incoming.card)}
                    </p>
                    <p className="mt-1 text-xs text-ink-3">
                      {ROLE_LABEL[evOut.role]}, nota {evOut.score} → {ROLE_LABEL[evIn.role]}, nota {evIn.score}
                      {swap.source === "manual" && " · elegido por ti"}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-ink-2">{swap.reason}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2 text-sm">
                        <span className="text-ink-3">Que salga:</span>
                        <select value={swap.outId} onChange={(e) => chooseOut(incoming, e.target.value, swap)} className={cx(inputClass, "h-9 w-auto max-w-72 py-0")}>
                          {outOptions(incoming, swap).map((e) => (
                            <option key={e.card.oracleId} value={e.card.oracleId}>
                              {displayName(e.card)} (nota {evaluateCard(e.card, identity).score})
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="button" onClick={() => dismiss(swap.inId)} className={smallButtonClass}>
                        <Undo2 aria-hidden="true" className="size-3.5" />
                        No meter esta carta
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="button" onClick={apply} className={buttonClass}>
              <Check aria-hidden="true" className="size-4" />
              Aplicar {plural(swaps.length, "cambio", "cambios")}
            </button>
            <span className="text-sm text-ink-3">
              Diferencia de precio: {priceDelta >= 0 ? "+" : "−"}
              {formatEuros(Math.abs(priceDelta))} (lo que entra menos lo que sale, a precio de Cardmarket)
            </span>
          </div>
        </>
      )}

      {unpaired.length > 0 && (
        <details className="mt-6" open={swaps.length === 0}>
          <summary className="cursor-pointer text-sm font-medium text-ink-2">
            {plural(unpaired.length, "carta nueva no mejora", "cartas nuevas no mejoran")} ninguna del mazo
          </summary>
          <ul className="mt-3 space-y-2">
            {unpaired.map((e) => {
              const options = outOptions(e);
              return (
                <li key={e.card.oracleId} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-2.5">
                  <button type="button" onClick={() => onOpen(e)} className="shrink-0">
                    <CardImage src={cardImage(e, lang)} alt={`Carta ${displayName(e.card)}`} className="w-12" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{displayName(e.card)}</p>
                    <p className="text-xs text-ink-3">{whyNot.get(e.card.oracleId) ?? "sin pareja"}</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-ink-3">Meterla por:</span>
                    <select defaultValue="" onChange={(ev) => ev.target.value && chooseOut(e, ev.target.value)} className={cx(inputClass, "h-9 w-auto max-w-64 py-0")}>
                      <option value="">Elige una carta…</option>
                      {options.map((o) => (
                        <option key={o.card.oracleId} value={o.card.oracleId}>
                          {displayName(o.card)} (nota {evaluateCard(o.card, identity).score})
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {recommendation.rejected.length > 0 && (
        <div className="mt-6">
          <p className="text-sm font-medium text-ink-2">No pueden entrar</p>
          <ul className="mt-2 space-y-1 text-sm">
            {recommendation.rejected.map((r) => (
              <li key={r.card.oracleId} className="text-ink-2">
                <b className="font-medium text-ink">{displayName(r.card)}</b>: {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 border-t border-line pt-5">
        <ImportPanel
          compact
          title="Añadir más cartas nuevas"
          help="Otro CSV de ManaBox o una lista: se suman a las que ya hay y se recalcula la propuesta."
          submitLabel="Añadir"
          onImported={(r) => onChange(addToPool(deck, r.cards))}
        />
      </div>
    </section>
  );
}

function PairCard({ entry, lang, label, onOpen }: { entry: DeckEntry; lang: ImageLang; label: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="relative w-24 shrink-0 sm:w-28">
      <CardImage src={cardImage(entry, lang)} alt={`${label}: ${displayName(entry.card)}`} className="shadow-sm" />
      <span className={cx("absolute inset-x-1 bottom-1 rounded-md py-0.5 text-center text-[11px] font-semibold", label === "Sale" ? "bg-ink/85 text-canvas" : "bg-brand text-on-brand")}>
        {label}
      </span>
    </button>
  );
}
