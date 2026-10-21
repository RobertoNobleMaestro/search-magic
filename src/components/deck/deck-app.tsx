"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { newDeck } from "@/lib/deck/build";
import { loadDecks, saveDecks } from "@/lib/deck/storage";
import type { Deck } from "@/lib/deck/types";
import { Notice, cx, secondaryButtonClass } from "../ui";
import { DeckView } from "./deck-view";
import { ImportPanel, type ImportResult } from "./import-panel";

/** Mazos guardados en este navegador: importar, ver, recomendar cambios */
export function DeckApp() {
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    const stored = loadDecks();
    setDecks(stored);
    setActiveId(stored[0]?.id ?? null);
  }, []);

  function persist(next: Deck[]) {
    setDecks(next);
    setSaveFailed(!saveDecks(next));
  }

  function onImported(result: ImportResult) {
    const deck = newDeck(result.name, result.cards, result.tokens);
    persist([...(decks ?? []), deck]);
    setActiveId(deck.id);
    setMissing(result.missing);
    setImporting(false);
  }

  if (decks === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-3">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        Cargando tus mazos…
      </p>
    );
  }

  const active = decks.find((d) => d.id === activeId) ?? null;
  const importPanel = (
    <ImportPanel
      title={decks.length ? "Importar otro mazo" : "Importa tu mazo"}
      help="Exporta el mazo desde ManaBox (Compartir → CSV) y súbelo aquí, o pega la lista. Se guarda solo en este navegador: no hace falta cuenta."
      submitLabel="Importar mazo"
      onImported={onImported}
    />
  );

  return (
    <div className="space-y-6">
      {saveFailed && <Notice icon={<span aria-hidden="true">!</span>}>Este navegador no deja guardar: el mazo se perderá al cerrar la pestaña.</Notice>}
      {missing.length > 0 && (
        <Notice tone="warn" icon={<span aria-hidden="true">!</span>}>
          No se han encontrado en Scryfall: {missing.join(", ")}.
        </Notice>
      )}

      {decks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Tus mazos">
          {decks.map((d) => (
            <button
              key={d.id}
              type="button"
              role="tab"
              aria-selected={d.id === activeId && !importing}
              onClick={() => {
                setActiveId(d.id);
                setImporting(false);
              }}
              className={cx("rounded-xl px-3.5 py-2 text-sm font-medium", d.id === activeId && !importing ? "bg-ink text-canvas" : "bg-surface-2 text-ink-2 hover:text-ink")}
            >
              {d.name}
            </button>
          ))}
          <button type="button" onClick={() => setImporting(true)} className={secondaryButtonClass}>
            <Plus aria-hidden="true" className="size-4" />
            Otro mazo
          </button>
        </div>
      )}

      {!active || importing ? (
        importPanel
      ) : (
        <DeckView
          key={active.id}
          deck={active}
          onChange={(deck) => persist(decks.map((d) => (d.id === deck.id ? deck : d)))}
          onDelete={() => {
            const rest = decks.filter((d) => d.id !== active.id);
            persist(rest);
            setActiveId(rest[0]?.id ?? null);
          }}
        />
      )}
    </div>
  );
}
