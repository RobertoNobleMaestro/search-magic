import Link from "next/link";
import type { SealedOffer } from "@/lib/data/types";
import { stockLabel } from "@/lib/format";
import { BestBadge, CardmarketBadge, LanguageChip, StoreKindBadge } from "../badges";
import { cx } from "../ui";
import { UpdatedAgo } from "../updated-ago";
import { OfferLink, PriceBlock } from "./offer-list";

/** Ofertas de un producto sellado, de la más barata a la más cara; "Mejor precio" para la más barata con stock */
export function SealedOfferList({ offers, now, productName }: { offers: SealedOffer[]; now: Date; productName: string }) {
  const best = offers.find((o) => o.inStock) ?? null;
  return (
    <ul aria-label={`Ofertas de ${productName}`} className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
      {offers.map((offer) => {
        const isBest = offer === best;
        return (
          <li
            key={offer.listingId}
            className={cx(
              "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5 md:grid-cols-[minmax(0,1fr)_9rem_7rem_auto]",
              isBest && "bg-gold-soft/40 shadow-[inset_3px_0_0_var(--gold)]",
              !offer.inStock && "opacity-75",
            )}
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/tiendas/${offer.store.id}`}
                  className={cx("font-medium underline-offset-4 hover:text-brand-strong hover:underline", offer.inStock ? "text-ink" : "text-ink-2")}
                >
                  {offer.store.name}
                </Link>
                {isBest && <BestBadge />}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                <StoreKindBadge store={offer.store} />
                {offer.source === "cardmarket_csv" && <CardmarketBadge />}
                <UpdatedAgo iso={offer.scrapedAt} now={now} />
                {offer.matchConfidence < 1 && (
                  <span className="italic" title="No estamos del todo seguros de que sea este producto: revísalo en la tienda">
                    · producto probable
                  </span>
                )}
              </p>
            </div>
            <div className="row-start-2 flex items-center gap-2 md:row-start-auto">
              <LanguageChip lang={offer.language} />
              <span className={cx("text-sm", offer.inStock ? "text-ink-2" : "font-medium text-ink-3")}>
                {stockLabel(offer.inStock, offer.quantity)}
              </span>
            </div>
            <div className="text-right">
              <PriceBlock offer={offer} large />
            </div>
            <div className="row-start-2 justify-self-end md:row-start-auto">
              <OfferLink offer={offer} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
