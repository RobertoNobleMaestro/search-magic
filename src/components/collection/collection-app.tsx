"use client";

import { FileUp, LoaderCircle, Plus } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { buildLines, fetchCollectionCards, newCollection } from "@/lib/collection/build";
import { loadCollections, saveCollections } from "@/lib/collection/storage";
import type { Collection } from "@/lib/collection/types";
import { parseDeckText } from "@/lib/deck/manabox";
import { Notice, cx, secondaryButtonClass } from "../ui";
import { CollectionView } from "./collection-view";

/** Colecciones guardadas en este navegador: importar el CSV de ManaBox y verlas */
export function CollectionApp() {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    const stored = loadCollections();
    setCollections(stored);
    setActiveId(stored[0]?.id ?? null);
  }, []);

  function persist(next: Collection[]) {
    setCollections(next);
    setSaveFailed(!saveCollections(next));
  }

  if (collections === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-3">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        Cargando tus colecciones…
      </p>
    );
  }

  const active = collections.find((c) => c.id === activeId) ?? null;

  return (
    <div className="space-y-5">
      {saveFailed && <Notice icon={<span aria-hidden="true">!</span>}>Este navegador no deja guardar: la colección se perderá al cerrar la pestaña.</Notice>}
      {missing.length > 0 && (
        <Notice tone="warn" icon={<span aria-hidden="true">!</span>}>
          No se han encontrado en Scryfall: {missing.join(", ")}.
        </Notice>
      )}

      {collections.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Tus colecciones">
          {collections.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === activeId && !importing}
              onClick={() => {
                setActiveId(c.id);
                setImporting(false);
              }}
              className={cx("rounded-xl px-3.5 py-2 text-sm font-medium", c.id === activeId && !importing ? "bg-ink text-canvas" : "bg-surface-2 text-ink-2 hover:text-ink")}
            >
              {c.name || "Sin nombre"}
            </button>
          ))}
          <button type="button" onClick={() => setImporting(true)} className={secondaryButtonClass}>
            <Plus aria-hidden="true" className="size-4" />
            Otra colección
          </button>
        </div>
      )}

      {!active || importing ? (
        <CollectionImport
          first={collections.length === 0}
          onImported={(collection, notFound) => {
            persist([...collections, collection]);
            setActiveId(collection.id);
            setMissing(notFound);
            setImporting(false);
          }}
        />
      ) : (
        <CollectionView
          key={active.id}
          collection={active}
          onRename={(name) => persist(collections.map((c) => (c.id === active.id ? { ...c, name } : c)))}
          onDelete={() => {
            const rest = collections.filter((c) => c.id !== active.id);
            persist(rest);
            setActiveId(rest[0]?.id ?? null);
            setMissing([]);
          }}
        />
      )}
    </div>
  );
}

/** Subir el CSV de ManaBox (botón o arrastrándolo encima); los datos de las cartas vienen de Scryfall */
function CollectionImport({ first, onImported }: { first: boolean; onImported: (collection: Collection, missing: string[]) => void }) {
  const fileId = useId();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function importFile(file: File) {
    const parsed = parseDeckText(await file.text());
    if (parsed.rows.length === 0) {
      setErrors(parsed.errors.length ? parsed.errors : ["No hay ninguna carta en el archivo"]);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const response = await fetchCollectionCards(parsed.rows);
      const { lines, missing } = buildLines(parsed.rows, response);
      const name = file.name.replace(/\.(csv|txt)$/i, "").trim().replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase()) || "Mi colección";
      onImported(newCollection(name, lines), missing);
      if (parsed.errors.length) setErrors(parsed.errors);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "No se han podido pedir las cartas"]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Importar colección"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && !busy) void importFile(file);
      }}
      className={cx("rounded-2xl border-2 border-dashed bg-surface px-6 py-10 text-center transition", dragging ? "border-brand bg-brand-soft" : "border-line-strong")}
    >
      <FileUp aria-hidden="true" className="mx-auto size-8 text-ink-3" />
      <h2 className="mt-3 font-display text-2xl font-semibold">{first ? "Sube tu colección" : "Sube otra colección"}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-2">
        Exporta las cartas desde ManaBox (Compartir → CSV) y súbelas aquí o arrastra el archivo encima. Se guarda solo en este navegador.
      </p>
      <label
        htmlFor={fileId}
        className={cx("mt-5 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-on-brand shadow-sm hover:bg-brand-strong", busy && "pointer-events-none opacity-60")}
      >
        {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <FileUp aria-hidden="true" className="size-4" />}
        {busy ? "Pidiendo las cartas a Scryfall…" : "Elegir CSV de ManaBox"}
      </label>
      <input
        id={fileId}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
          e.target.value = "";
        }}
      />
      {errors.length > 0 && (
        <ul role="alert" className="mt-4 space-y-0.5 text-sm text-warn">
          {errors.slice(0, 8).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
