"use client";

import { FileUp, LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import { buildEntries, fetchCards } from "@/lib/deck/build";
import { parseDeckText } from "@/lib/deck/manabox";
import type { DeckEntry } from "@/lib/deck/types";
import { plural } from "@/lib/format";
import { buttonClass, cx, inputClass } from "../ui";

export interface ImportResult {
  name: string;
  cards: DeckEntry[];
  tokens: DeckEntry[];
  missing: string[];
}

/**
 * Importar cartas: el CSV que exporta ManaBox (cualquier columna extra da igual) o una lista
 * pegada ("1 Sol Ring", "Command Tower"…). Los datos de cada carta se piden a Scryfall.
 */
export function ImportPanel({
  title,
  help,
  submitLabel,
  onImported,
  compact = false,
}: {
  title: string;
  help: string;
  submitLabel: string;
  onImported: (result: ImportResult) => void;
  compact?: boolean;
}) {
  const fileId = useId();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function readFile(file: File) {
    setFileName(file.name);
    setText(await file.text());
    setErrors([]);
  }

  async function submit() {
    const parsed = parseDeckText(text);
    if (parsed.rows.length === 0) {
      setErrors(parsed.errors.length ? parsed.errors : ["No hay ninguna carta en el texto"]);
      return;
    }
    setBusy(true);
    setErrors([]);
    try {
      const response = await fetchCards(parsed.rows);
      const built = buildEntries(parsed.rows, response);
      const name = fileName?.replace(/\.(csv|txt)$/i, "").trim() || "Mi mazo";
      onImported({ name, ...built });
      setText("");
      setFileName(null);
      if (parsed.errors.length) setErrors(parsed.errors);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "No se han podido pedir las cartas"]);
    } finally {
      setBusy(false);
    }
  }

  const lines = parseDeckText(text).rows;
  const count = lines.reduce((s, r) => s + r.quantity, 0);

  return (
    <section aria-label={title} className={cx("rounded-2xl border border-line bg-surface", compact ? "p-4" : "p-5 sm:p-6")}>
      <h2 className={cx("font-display font-semibold", compact ? "text-lg" : "text-2xl")}>{title}</h2>
      <p className="mt-1 text-sm text-ink-2">{help}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label htmlFor={fileId} className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface-2 px-4 py-2.5 text-sm font-medium hover:border-brand hover:text-brand-strong">
          <FileUp aria-hidden="true" className="size-4" />
          {fileName ?? "Elegir CSV de ManaBox"}
        </label>
        <input
          id={fileId}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void readFile(file);
            e.target.value = "";
          }}
        />
        <span className="text-sm text-ink-3">o pega la lista abajo</span>
      </div>
      <label className="mt-3 block">
        <span className="sr-only">Lista de cartas</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={compact ? 4 : 7}
          placeholder={"1 Sol Ring\n1 Command Tower\n5 Island"}
          className={cx(inputClass, "h-auto py-2 font-mono text-xs leading-relaxed")}
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void submit()} disabled={busy || count === 0} className={cx(buttonClass, "disabled:cursor-not-allowed disabled:opacity-50")}>
          {busy && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
          {busy ? "Pidiendo las cartas a Scryfall…" : submitLabel}
        </button>
        {count > 0 && !busy && <span className="text-sm text-ink-3">{plural(count, "carta", "cartas")} en {plural(lines.length, "línea", "líneas")}</span>}
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="mt-3 space-y-0.5 text-sm text-warn">
          {errors.slice(0, 8).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
