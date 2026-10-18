import { CalendarDays, Info, Inbox, SlidersHorizontal, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, type ReactNode } from "react";
import { SetChip } from "@/components/badges";
import {
  cityOptions,
  countActiveFilters,
  filtersHref,
  languageOptions,
  parseFilters,
  sealedFilterState,
  toSealedOfferFilters,
  type FilterState,
} from "@/components/offers/filters";
import { OfferFiltersForm } from "@/components/offers/filters-form";
import { SealedOfferList } from "@/components/offers/sealed-offer-list";
import { SealedIcon } from "@/components/sealed";
import type { SearchParams } from "@/components/search-params";
import { EmptyState, cx, eyebrowClass, linkClass, pageClass, secondaryButtonClass } from "@/components/ui";
import { UpdatedAgo } from "@/components/updated-ago";
import { getRepository, type SealedOffer, type SealedSummary } from "@/lib/data";
import { formatDate, formatEuros, languageLabel, plural, sealedTypeLabel } from "@/lib/format";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
};

/** sealedProductId de MTGJSON (UUID) */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const loadProduct = cache(async (id: string) => {
  if (!UUID.test(id)) return null;
  const repo = await getRepository();
  return repo.getSealedProduct(id);
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await loadProduct((await params).id);
  if (!product) return { title: "Producto no encontrado" };
  const price =
    product.minPriceCents != null
      ? `desde ${formatEuros(product.minPriceCents)} en ${plural(product.offerCount, "oferta", "ofertas")}`
      : "ahora mismo sin stock";
  return {
    title: product.name,
    description: `${sealedTypeLabel(product.category, product.subtype)} de ${product.setName}: precio y stock en tiendas de Barcelona, L'Hospitalet y online, ${price}.`,
  };
}

export default async function SealedPage({ params, searchParams }: Props) {
  const { id } = await params;
  const product = await loadProduct(id);
  if (!product) notFound();

  const filters = sealedFilterState(parseFilters(await searchParams));
  const repo = await getRepository();
  const [allOffers, offers, related] = await Promise.all([
    repo.getSealedOffers(id),
    repo.getSealedOffers(id, toSealedOfferFilters(filters)),
    relatedProducts(product),
  ]);
  const now = new Date();
  const pathname = `/sellado/${id}`;

  const inStock = offers.filter((o) => o.inStock);
  const best = inStock[0] ?? null;
  const storeCount = new Set(inStock.map((o) => o.store.id)).size;
  const freshest = allOffers.reduce<string | null>(
    (max, o) => (!max || Date.parse(o.scrapedAt) > Date.parse(max) ? o.scrapedAt : max),
    null,
  );
  const typeLabel = sealedTypeLabel(product.category, product.subtype);

  return (
    <div className={pageClass}>
      <nav aria-label="Migas de pan" className="text-sm text-ink-3">
        <span>Sellado</span>
        <span aria-hidden="true" className="mx-1.5">
          /
        </span>
        <Link href={`/buscar?q=${encodeURIComponent(product.setName)}`} className="hover:text-ink-2">
          {product.setName}
        </Link>
        <span aria-hidden="true" className="mx-1.5">
          /
        </span>
        <span className="text-ink-2">{typeLabel}</span>
      </nav>

      <header className="mt-4 flex items-start gap-4 sm:items-center sm:gap-6">
        <SealedIcon category={product.category} size="lg" />
        <div className="min-w-0">
          <p className={eyebrowClass}>Producto sellado · {typeLabel}</p>
          <h1 lang="en" className="mt-1 font-display text-[1.9rem] leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl">
            {product.name}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
            <span className="inline-flex items-center gap-2">
              <SetChip code={product.setCode} title={product.setName} />
              {product.setName}
            </span>
            {product.releaseDate && (
              <span className="inline-flex items-center gap-1.5 text-ink-3">
                <CalendarDays aria-hidden="true" className="size-3.5" />
                {`A la venta desde el ${formatDate(product.releaseDate)}`}
              </span>
            )}
          </p>
        </div>
      </header>

      <dl className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {best ? (
          <Tile label="Mejor precio" value={formatEuros(best.priceCents)} gold>
            {best.store.name} · {best.store.local ? "tienda física" : "online"}
          </Tile>
        ) : (
          <Tile label="Mejor precio" value="—">
            {countActiveFilters(filters) > 0 ? "Sin stock con estos filtros" : "Sin stock ahora mismo"}
          </Tile>
        )}
        <Tile label="Ofertas con stock" value={String(inStock.length)}>
          en {plural(storeCount, "tienda", "tiendas")}
        </Tile>
        <Tile label="Actualizado" value={freshest ? <UpdatedAgo iso={freshest} now={now} /> : "—"} className="col-span-2 lg:col-span-1">
          <Link href="/tiendas" className={linkClass}>
            Estado de las tiendas
          </Link>
        </Tile>
      </dl>

      <section aria-labelledby="ofertas" className="mt-12">
        <h2 id="ofertas" className="font-display text-2xl font-semibold">
          Ofertas
        </h2>
        <p className="mt-0.5 text-sm text-ink-3">{plural(offers.length, "oferta", "ofertas")} · de la más barata a la más cara</p>

        <div className="mt-4">
          <OfferFiltersForm
            pathname={pathname}
            filters={filters}
            variant="sealed"
            cities={cityOptions(
              allOffers.map((o) => o.store),
              filters.cities,
            )}
            languages={languageOptions(
              allOffers.map((o) => o.language),
              filters.languages,
              languageLabel,
            )}
          />
        </div>

        <div className="mt-5">
          {offers.length > 0 ? (
            <SealedOfferList offers={offers} now={now} productName={product.name} />
          ) : (
            <NoOffers all={allOffers} filters={filters} pathname={pathname} />
          )}
        </div>

        <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-ink-3">
          <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span>
            El precio y el stock los publica cada tienda en su web: confírmalos antes de ir. No hay precio de referencia de
            Cardmarket para producto sellado, así que aquí no hay comparación en %.
          </span>
        </p>
      </section>

      {related.length > 0 && (
        <section aria-labelledby="relacionados" className="mt-14">
          <h2 id="relacionados" className="font-display text-xl font-semibold">
            Más producto de {product.setName}
          </h2>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((p) => (
              <li key={p.sealedProductId}>
                <Link
                  href={`/sellado/${p.sealedProductId}`}
                  className="flex h-full items-center gap-3 rounded-2xl border border-line bg-surface p-3 transition hover:border-line-strong hover:shadow-card"
                >
                  <SealedIcon category={p.category} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{sealedTypeLabel(p.category, p.subtype)}</span>
                    <span lang="en" className="block truncate text-xs text-ink-3">
                      {p.name}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-semibold tabular-nums">
                      {p.minPriceCents != null ? formatEuros(p.minPriceCents) : "—"}
                    </span>
                    <span className="block text-[11px] text-ink-3">{plural(p.offerCount, "oferta", "ofertas")}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Otros productos de la misma edición, los que tienen stock primero */
async function relatedProducts(product: SealedSummary): Promise<SealedSummary[]> {
  const repo = await getRepository();
  const found = await repo.searchSealed(product.setName, 40);
  return found
    .filter((p) => p.setCode === product.setCode && p.sealedProductId !== product.sealedProductId)
    .sort((a, b) => Number(b.offerCount > 0) - Number(a.offerCount > 0))
    .slice(0, 9);
}

function Tile({
  label,
  value,
  gold = false,
  className,
  children,
}: {
  label: string;
  value: ReactNode;
  gold?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("min-w-0 rounded-2xl border px-4 py-3", gold ? "border-gold/60 bg-gold-soft" : "border-line bg-surface", className)}>
      <dt className={cx("text-xs font-medium", gold ? "text-gold-ink" : "text-ink-3")}>{label}</dt>
      <dd className="mt-0.5 text-[1.4rem] leading-tight font-semibold tabular-nums">{value}</dd>
      <dd className="mt-0.5 truncate text-xs text-ink-2">{children}</dd>
    </div>
  );
}

function NoOffers({ all, filters, pathname }: { all: SealedOffer[]; filters: FilterState; pathname: string }) {
  if (all.length === 0) {
    return (
      <EmptyState icon={<Inbox />} title="Ninguna tienda tiene este producto ahora mismo">
        Revisamos las tiendas cada 6–12 horas; vuelve a mirar más adelante.
      </EmptyState>
    );
  }
  const withSoldOut = filters.inStockOnly && (
    <Link href={filtersHref(pathname, { ...filters, inStockOnly: false })} scroll={false} replace className={secondaryButtonClass}>
      Ver también las agotadas
    </Link>
  );
  if (countActiveFilters(filters) === 0) {
    return (
      <EmptyState icon={<Inbox />} title="Ahora mismo no hay ofertas con stock" action={withSoldOut}>
        Hay {plural(all.length, "oferta agotada", "ofertas agotadas")} por si quieres preguntar en la tienda.
      </EmptyState>
    );
  }
  return (
    <EmptyState
      icon={<SlidersHorizontal />}
      title="Ninguna oferta con estos filtros"
      action={
        <>
          <Link href={pathname} scroll={false} replace className={secondaryButtonClass}>
            <X aria-hidden="true" className="size-4" />
            Quitar filtros
          </Link>
          {withSoldOut}
        </>
      }
    >
      Prueba a quitar algún filtro.{filters.localOnly && " Puede que solo lo tengan tiendas online."}
    </EmptyState>
  );
}
