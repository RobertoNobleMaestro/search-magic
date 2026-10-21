"use client";

import { AlertTriangle, Check, ClipboardCopy, Scissors, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { exportList, matchNames } from "@/lib/deck/build";
import { deckIdentity, deckSize, displayName, validateDeck } from "@/lib/deck/recommend";
import { cardRoles, evaluateCard } from "@/lib/deck/roles";
import { averageCmc, groupByType, manaCurve, totalPrice } from "@/lib/deck/stats";
import type { Deck, DeckEntry } from "@/lib/deck/types";
import { formatEuros, plural } from "@/lib/format";
import { CardImage } from "../card-image";
import { Notice, cx, ghostButtonClass, inputClass, panelClass, secondaryButtonClass, smallButtonClass } from "../ui";
import { CardDialog } from "./card-dialog";
import { CardTile, cardImage, type ImageLang } from "./card-tile";
import { ColorPips } from "./color-pips";
import { ManaCurve } from "./mana-curve";
import { UpgradePanel } from "./upgrade-panel";

/** El mazo de forma visual: comandante, curva, papeles, cartas por tipo y los cambios propuestos */
export function DeckView({ deck, onChange, onDelete }: { deck: Deck; onChange: (deck: Deck) => void; onDelete: () => void }) {
  const [lang, setLang] = useState<ImageLang>("es");
  const [open, setOpen] = useState<DeckEntry | null>(null);
  const [copied, setCopied] = useState(false);

  const identity = useMemo(() => deckIdentity(deck.cards, deck.commanderId), [deck.cards, deck.commanderId]);
  const commander = deck.cards.find((e) => e.card.oracleId === deck.commanderId) ?? null;
  const problems = validateDeck(deck);
  const groups = groupByType(deck.cards, deck.commanderId);
  const price = totalPrice(deck.cards);
  const legends = deck.cards.filter((e) => /\bLegendary\b/.test(e.card.typeLine) && /\bCreature\b/.test(e.card.typeLine));
  const roleCount = (roles: string[]) =>
    deck.cards.filter((e) => cardRoles(e.card).some((r) => roles.includes(r))).reduce((s, e) => s + e.quantity, 0);

  const update = (patch: Partial<Deck>) => onChange({ ...deck, ...patch, updatedAt: new Date().toISOString() });
  /** Solo las cartas del mazo (no las nuevas ni las fichas) se marcan como protegidas o candidatas */
  const inDeck = (entry: DeckEntry) => deck.cards.some((e) => e.card.oracleId === entry.card.oracleId);
  const toggle = (list: "protectedIds" | "cutCandidateIds", id: string) => {
    const other = list === "protectedIds" ? "cutCandidateIds" : "protectedIds";
    const on = deck[list].includes(id);
    update({ [list]: on ? deck[list].filter((x) => x !== id) : [...deck[list], id], [other]: deck[other].filter((x) => x !== id), swaps: [] });
  };

  async function copyList() {
    try {
      await navigator.clipboard.writeText(exportList(deck));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Cabecera */}
      <section className={cx(panelClass, "grid gap-5 p-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:p-6")}>
        <div className="w-36 sm:w-44">
          {commander ? (
            <button type="button" onClick={() => setOpen(commander)} className="block w-full">
              <CardImage src={cardImage(commander, lang)} alt={`Comandante: ${displayName(commander.card)}`} eager className="shadow-card" />
            </button>
          ) : (
            <div className="grid aspect-[488/680] place-items-center rounded-card border border-dashed border-line-strong p-3 text-center text-sm text-ink-3">Elige el comandante</div>
          )}
        </div>
        <div className="min-w-0">
          <label className="block">
            <span className="sr-only">Nombre del mazo</span>
            <input
              value={deck.name}
              onChange={(e) => update({ name: e.target.value })}
              className="w-full rounded-lg bg-transparent font-display text-3xl font-semibold tracking-tight outline-none focus:bg-surface-2 sm:text-4xl"
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-ink-3">Comandante</span>
              <select
                value={deck.commanderId ?? ""}
                onChange={(e) => update({ commanderId: e.target.value || null, swaps: [] })}
                className={cx(inputClass, "h-9 w-auto max-w-72 py-0")}
              >
                <option value="">Elige…</option>
                {legends.map((e) => (
                  <option key={e.card.oracleId} value={e.card.oracleId}>
                    {displayName(e.card)}
                  </option>
                ))}
              </select>
            </label>
            <ColorPips colors={identity} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Cartas" value={`${deckSize(deck.cards)}/100`} note={deck.tokens.length ? `+ ${plural(deckSize(deck.tokens), "ficha", "fichas")} aparte` : "sin fichas"} />
            <Stat label="Precio" value={formatEuros(price.cents)} note={price.missing ? `${price.missing} sin precio` : "Cardmarket, vía Scryfall"} />
            <Stat label="Tierras" value={String(groups.find((g) => g.key === "land")?.count ?? 0)} note={`${roleCount(["ramp"])} de rampa`} />
            <Stat label="Robo · eliminación" value={`${roleCount(["draw"])} · ${roleCount(["removal", "counter"])}`} note={`${plural(roleCount(["wipe"]), "barrido", "barridos")}`} />
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Idioma de las imágenes" className="inline-flex rounded-xl border border-line-strong p-0.5 text-sm">
              {(["es", "en"] as const).map((l) => (
                <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)} className={cx("rounded-lg px-3 py-1 font-medium", lang === l ? "bg-surface-2 text-ink" : "text-ink-3")}>
                  {l === "es" ? "Español" : "Inglés"}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => void copyList()} className={secondaryButtonClass}>
              {copied ? <Check aria-hidden="true" className="size-4" /> : <ClipboardCopy aria-hidden="true" className="size-4" />}
              {copied ? "Lista copiada" : "Copiar lista"}
            </button>
            <button
              type="button"
              onClick={() => window.confirm(`¿Borrar «${deck.name}» de este navegador?`) && onDelete()}
              className={ghostButtonClass}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Borrar mazo
            </button>
          </div>
        </div>
      </section>

      {problems.length > 0 && (
        <Notice tone="warn" icon={<AlertTriangle />}>
          {problems.join(". ")}.
        </Notice>
      )}

      {/* Curva */}
      <section className={cx(panelClass, "p-4 sm:p-6")}>
        <ManaCurve curve={manaCurve(deck.cards)} average={averageCmc(deck.cards)} />
      </section>

      {/* Cambios */}
      <UpgradePanel deck={deck} identity={identity} lang={lang} onChange={onChange} onOpen={setOpen} />

      <Preferences deck={deck} onChange={onChange} />

      {/* Cartas por tipo */}
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`grupo-${group.key}`}>
          <h2 id={`grupo-${group.key}`} className="flex items-baseline gap-2 font-display text-xl font-semibold">
            {group.label}
            <span className="font-sans text-sm font-normal text-ink-3">{group.count}</span>
          </h2>
          <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {group.entries.map((entry) => (
              <li key={entry.card.oracleId}>
                <CardTile
                  entry={entry}
                  lang={lang}
                  isProtected={deck.protectedIds.includes(entry.card.oracleId)}
                  isCandidate={deck.cutCandidateIds.includes(entry.card.oracleId)}
                  onOpen={() => setOpen(entry)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {deck.tokens.length > 0 && (
        <details className={cx(panelClass, "p-4")}>
          <summary className="cursor-pointer font-medium">Fichas ({deckSize(deck.tokens)}): no cuentan para las 100</summary>
          <ul className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {deck.tokens.map((entry) => (
              <li key={entry.card.oracleId}>
                <CardTile entry={entry} lang={lang} onOpen={() => setOpen(entry)} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {open && (
        <CardDialog
          key={open.card.oracleId}
          entry={open}
          evaluation={evaluateCard(open.card, identity)}
          lang={lang}
          isCommander={open.card.oracleId === deck.commanderId}
          isProtected={deck.protectedIds.includes(open.card.oracleId)}
          isCandidate={deck.cutCandidateIds.includes(open.card.oracleId)}
          onToggleProtected={inDeck(open) ? () => toggle("protectedIds", open.card.oracleId) : undefined}
          onToggleCandidate={inDeck(open) ? () => toggle("cutCandidateIds", open.card.oracleId) : undefined}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2.5">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
      <dd className="text-xs text-ink-3">{note}</dd>
    </div>
  );
}

/** "No tocar" y "candidatas a salir": se marcan en cada carta o pegando nombres de golpe */
function Preferences({ deck, onChange }: { deck: Deck; onChange: (deck: Deck) => void }) {
  const [protectedText, setProtectedText] = useState("");
  const [candidateText, setCandidateText] = useState("");
  const [unknown, setUnknown] = useState<string[]>([]);
  const nameOf = (id: string) => {
    const card = deck.cards.find((e) => e.card.oracleId === id)?.card;
    return card ? displayName(card) : null;
  };

  function mark() {
    const p = matchNames(deck.cards, protectedText);
    const c = matchNames(deck.cards, candidateText);
    const protectedIds = [...new Set([...deck.protectedIds, ...p.ids])].filter((id) => id !== deck.commanderId);
    const cutCandidateIds = [...new Set([...deck.cutCandidateIds, ...c.ids])].filter((id) => !protectedIds.includes(id));
    onChange({ ...deck, protectedIds, cutCandidateIds, swaps: [], updatedAt: new Date().toISOString() });
    setUnknown([...p.unknown, ...c.unknown]);
    setProtectedText("");
    setCandidateText("");
  }

  return (
    <details className={cx(panelClass, "p-4 sm:p-5")}>
      <summary className="cursor-pointer font-medium">
        Lo que no se toca y las candidatas a salir{" "}
        <span className="text-sm font-normal text-ink-3">
          ({deck.protectedIds.length} protegidas · {deck.cutCandidateIds.length} candidatas)
        </span>
      </summary>
      <p className="mt-2 text-sm text-ink-2">
        Las protegidas nunca se proponen para salir; las candidatas salen antes. También se marcan desde cada carta. Pega nombres en inglés o en español, uno por línea.
      </p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <ChipList icon={<ShieldCheck aria-hidden="true" className="size-3.5" />} title="No tocar" ids={deck.protectedIds} nameOf={nameOf} onRemove={(id) => onChange({ ...deck, protectedIds: deck.protectedIds.filter((x) => x !== id), swaps: [] })}>
          <textarea value={protectedText} onChange={(e) => setProtectedText(e.target.value)} rows={4} placeholder={"Sol Ring\nArcane Signet"} className={cx(inputClass, "h-auto py-2 text-sm")} />
        </ChipList>
        <ChipList icon={<Scissors aria-hidden="true" className="size-3.5" />} title="Candidatas a salir" ids={deck.cutCandidateIds} nameOf={nameOf} onRemove={(id) => onChange({ ...deck, cutCandidateIds: deck.cutCandidateIds.filter((x) => x !== id), swaps: [] })}>
          <textarea value={candidateText} onChange={(e) => setCandidateText(e.target.value)} rows={4} placeholder={"Mind's Dilation\nEvolving Wilds"} className={cx(inputClass, "h-auto py-2 text-sm")} />
        </ChipList>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={mark} disabled={!protectedText.trim() && !candidateText.trim()} className={cx(secondaryButtonClass, "disabled:opacity-50")}>
          Marcar
        </button>
        {unknown.length > 0 && <span className="text-sm text-warn">No están en el mazo: {unknown.join(", ")}</span>}
      </div>
    </details>
  );
}

function ChipList({
  icon,
  title,
  ids,
  nameOf,
  onRemove,
  children,
}: {
  icon: ReactNode;
  title: string;
  ids: string[];
  nameOf: (id: string) => string | null;
  onRemove: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-sm font-medium">
        {icon}
        {title}
      </p>
      {ids.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {ids.map((id) => (
            <li key={id}>
              <button type="button" onClick={() => onRemove(id)} className={smallButtonClass} title="Quitar">
                {nameOf(id) ?? "?"} ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="mt-2 block">
        <span className="sr-only">{title}: nombres, uno por línea</span>
        {children}
      </label>
    </div>
  );
}
