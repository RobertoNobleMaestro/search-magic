"use client";

import { Scissors, ShieldCheck } from "lucide-react";
import type { DeckEntry } from "@/lib/deck/types";
import { formatEuros } from "@/lib/format";
import { CardImage } from "../card-image";
import { cx } from "../ui";

export type ImageLang = "es" | "en";

/** Imagen de la carta en el idioma elegido (la española solo si Scryfall la tiene) */
export function cardImage(entry: DeckEntry, lang: ImageLang): string | null {
  return lang === "es" ? (entry.card.imageUrlEs ?? entry.card.imageUrl) : entry.card.imageUrl;
}

/** Carta del mazo: imagen, copias, precio y si está protegida o es candidata a salir */
export function CardTile({
  entry,
  lang,
  isProtected = false,
  isCandidate = false,
  highlight,
  onOpen,
}: {
  entry: DeckEntry;
  lang: ImageLang;
  isProtected?: boolean;
  isCandidate?: boolean;
  /** "out" = sale en los cambios elegidos; "in" = entra */
  highlight?: "out" | "in";
  onOpen?: () => void;
}) {
  const { card, quantity } = entry;
  const name = card.nameEs ?? card.name;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cx(
        "group relative block w-full rounded-card text-left transition outline-none focus-visible:ring-4 focus-visible:ring-brand/30",
        highlight === "out" && "opacity-60",
      )}
    >
      <CardImage src={cardImage(entry, lang)} alt={`Carta ${name}`} className="shadow-sm transition group-hover:-translate-y-0.5 group-hover:shadow-card" />
      {quantity > 1 && (
        <span className="absolute top-1.5 left-1.5 rounded-full bg-ink/85 px-2 py-0.5 text-xs font-bold text-canvas tabular-nums">×{quantity}</span>
      )}
      <span className="absolute top-1.5 right-1.5 flex gap-1">
        {isProtected && (
          <span title="No tocar" className="grid size-6 place-items-center rounded-full bg-good text-canvas shadow">
            <ShieldCheck aria-hidden="true" className="size-3.5" />
            <span className="sr-only">No tocar</span>
          </span>
        )}
        {isCandidate && (
          <span title="Candidata a salir" className="grid size-6 place-items-center rounded-full bg-warn text-canvas shadow">
            <Scissors aria-hidden="true" className="size-3.5" />
            <span className="sr-only">Candidata a salir</span>
          </span>
        )}
      </span>
      {highlight && (
        <span
          className={cx(
            "absolute inset-x-1.5 bottom-8 rounded-md px-1.5 py-0.5 text-center text-[11px] font-semibold",
            highlight === "out" ? "bg-ink/85 text-canvas" : "bg-brand text-on-brand",
          )}
        >
          {highlight === "out" ? "Sale" : "Entra"}
        </span>
      )}
      <span className="mt-1 flex items-baseline justify-between gap-2 px-0.5 text-xs">
        <span className="truncate text-ink-2" title={name}>
          {name}
        </span>
        <span className="shrink-0 font-medium text-ink tabular-nums">
          {card.priceEurCents != null ? formatEuros(card.priceEurCents * quantity) : "—"}
        </span>
      </span>
    </button>
  );
}
