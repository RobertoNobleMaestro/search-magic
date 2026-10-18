import { CircleHelp } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Offer, Printing } from "@/lib/data/types";
import { formatConfidence, formatEuros, formatPercentDiff, priceDiffPercent, stockLabel } from "@/lib/format";
import { BestBadge, CardmarketBadge, ConditionBadge, FinishChip, LanguageChip, SetChip, StoreKindBadge } from "../badges";
import { ExternalLink, cx, smallButtonClass } from "../ui";
import { UpdatedAgo } from "../updated-ago";

interface Props {
  /** ya ordenadas por precio ascendente */
  offers: Offer[];
  now: Date;
  /** nombre de la carta, para el título de la tabla */
  cardName: string;
}

/** Diferencia con Cardmarket que se considera una buena oferta (en verde) */
const GOOD_DEAL_PERCENT = -5;

/**
 * Ofertas de una carta (offerRow y offerCard de la maqueta): tabla en escritorio y tarjetas en
 * pantallas estrechas. "Mejor precio" solo para la más barata con stock.
 */
export function OfferList({ offers, now, cardName }: Props) {
  const best = offers.find((o) => o.inStock) ?? null;
  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface lg:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Ofertas de {cardName}, de la más barata a la más cara</caption>
          <thead className="bg-surface-2 text-xs text-ink-3">
            <tr>
              <Th className="pl-4">Tienda</Th>
              <Th>Edición</Th>
              <Th>Copia</Th>
              <Th>Stock</Th>
              <Th className="text-right">
                Precio <span className="font-normal">· vs. Cardmarket</span>
              </Th>
              <Th className="pr-4">
                <span className="sr-only">Enlace</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {offers.map((offer) => {
              const isBest = offer === best;
              return (
                <tr
                  key={offer.listingId}
                  className={cx("border-t border-line align-top transition", isBest ? "bg-gold-soft/50" : "hover:bg-surface-2/60")}
                >
                  <td className={cx("py-3 pr-3 pl-4", isBest && "shadow-[inset_3px_0_0_var(--gold)]")}>
                    <StoreCell offer={offer} best={isBest} now={now} />
                  </td>
                  <td className="px-3 py-3">
                    <PrintingInfo printing={offer.printing} confidence={offer.matchConfidence} />
                  </td>
                  <td className="px-3 py-3">
                    <CopyChips offer={offer} nowrap />
                  </td>
                  <td className={cx("px-3 py-3 whitespace-nowrap", offer.inStock ? "text-ink-2" : "font-medium text-ink-3")}>
                    {stockLabel(offer.inStock, offer.quantity)}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <PriceBlock offer={offer} />
                  </td>
                  <td className="py-3 pr-4 pl-3 text-right">
                    <OfferLink offer={offer} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:hidden">
        {offers.map((offer) => (
          <li key={offer.listingId}>
            <OfferCard offer={offer} best={offer === best} now={now} />
          </li>
        ))}
      </ul>
    </>
  );
}

function OfferCard({ offer, best, now }: { offer: Offer; best: boolean; now: Date }) {
  return (
    <article
      className={cx(
        "relative flex h-full flex-col rounded-2xl border p-4 transition",
        best ? "border-gold/70 bg-gold-soft/50" : "border-line bg-surface",
        !offer.inStock && "opacity-75",
      )}
    >
      {best && (
        <span className="absolute -top-2.5 left-3">
          <BestBadge />
        </span>
      )}
      <div className="flex items-start justify-between gap-3">
        <StoreCell offer={offer} best={false} now={now} />
        <div className="shrink-0 text-right">
          <PriceBlock offer={offer} large />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1">
        <CopyChips offer={offer} />
        <span className="ml-1 font-mono text-[11px] text-ink-3">
          {offer.printing ? (
            `${offer.printing.setCode.toUpperCase()} #${offer.printing.collectorNumber}`
          ) : (
            <i className="font-sans" title="La tienda no indica la edición o no la hemos reconocido">
              Edición ?
            </i>
          )}
          {offer.printing && offer.matchConfidence < 1 && (
            <i className="font-sans" title={`Coincidencia del ${formatConfidence(offer.matchConfidence)}`}>
              {" "}
              · probable
            </i>
          )}
        </span>
        <span className={cx("ml-auto text-xs", offer.inStock ? "text-ink-2" : "font-medium text-ink-3")}>
          {stockLabel(offer.inStock, offer.quantity)}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-end gap-3 border-t border-line pt-3">
        <OfferLink offer={offer} />
      </div>
    </article>
  );
}

function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th scope="col" className={cx("px-3 py-2.5 font-medium whitespace-nowrap", className)}>
      {children}
    </th>
  );
}

/** Tienda, tipo (física u online) y ciudad, antigüedad del dato y si sale de Cardmarket */
function StoreCell({ offer, best, now }: { offer: Offer; best: boolean; now: Date }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          href={`/tiendas/${offer.store.id}`}
          className={cx("font-medium underline-offset-4 hover:text-brand-strong hover:underline", offer.inStock ? "text-ink" : "text-ink-2")}
        >
          {offer.store.name}
        </Link>
        {best && <BestBadge />}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
        <StoreKindBadge store={offer.store} />
        {offer.source === "cardmarket_csv" && <CardmarketBadge />}
        <UpdatedAgo iso={offer.scrapedAt} now={now} />
      </div>
    </div>
  );
}

/** Edición de la copia; si no se ha identificado o es dudosa, se dice */
function PrintingInfo({ printing, confidence }: { printing: Printing | null; confidence: number }) {
  if (!printing) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-sm text-ink-3 italic"
        title="La tienda no indica la edición o no la hemos reconocido"
      >
        <CircleHelp aria-hidden="true" className="size-3.5 shrink-0" />
        Edición sin identificar
      </span>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <SetChip code={printing.setCode} />
      <div className="min-w-0">
        <p className="max-w-[15rem] truncate text-sm text-ink-2" title={printing.setName}>
          {printing.setName}
        </p>
        <p className="font-mono text-[11px] text-ink-3">
          #{printing.collectorNumber}
          {confidence < 1 && (
            <>
              {" · "}
              <span className="font-sans italic" title={`Coincidencia del ${formatConfidence(confidence)}`}>
                edición probable
              </span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function CopyChips({ offer, nowrap = false }: { offer: Offer; nowrap?: boolean }) {
  return (
    <div className={cx("flex items-center gap-1", nowrap ? "whitespace-nowrap" : "flex-wrap")}>
      <ConditionBadge condition={offer.condition} />
      <LanguageChip lang={offer.language} />
      <FinishChip finish={offer.finish} />
    </div>
  );
}

/** El precio manda; debajo, el % frente a Cardmarket (verde solo si está al menos un 5 % por debajo) */
export function PriceBlock({ offer, large = false }: { offer: Pick<Offer, "priceCents" | "inStock"> & { referencePriceCents?: number | null }; large?: boolean }) {
  const reference = offer.referencePriceCents ?? null;
  const percent = priceDiffPercent(offer.priceCents, reference);
  return (
    <>
      <p className={cx("font-semibold tabular-nums", large ? "text-xl" : "text-lg", offer.inStock ? "text-ink" : "text-ink-3")}>
        {formatEuros(offer.priceCents)}
      </p>
      {percent != null && reference != null && (
        <p
          className={cx("text-xs tabular-nums", percent <= GOOD_DEAL_PERCENT ? "font-medium text-good" : "text-ink-3")}
          title={`Cardmarket: ${formatEuros(reference)}`}
        >
          {formatPercentDiff(percent)}
          <span className="sr-only"> respecto a Cardmarket ({formatEuros(reference)})</span>
        </p>
      )}
    </>
  );
}

/** "Ver en tienda" o, si la oferta sale del stock de Cardmarket, "Ver en Cardmarket" con su aclaración */
export function OfferLink({ offer }: { offer: Pick<Offer, "url" | "source" | "store"> }) {
  if (offer.source === "cardmarket_csv") {
    return (
      <span className="inline-flex flex-col items-end gap-1">
        <ExternalLink href={offer.url} className={smallButtonClass} label={`(${offer.store.name})`}>
          Ver en Cardmarket
        </ExternalLink>
        <span className="text-[11px] leading-tight whitespace-nowrap text-ink-3">La tienda vende por Cardmarket</span>
      </span>
    );
  }
  return (
    <ExternalLink href={offer.url} className={smallButtonClass} label={`(${offer.store.name})`}>
      Ver en tienda
    </ExternalLink>
  );
}
