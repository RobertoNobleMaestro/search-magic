import { Info, Inbox, SlidersHorizontal, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, type ReactNode } from "react";
import { SetChip } from "@/components/badges";
import { CardImage } from "@/components/card-image";
import {
  cityOptions,
  countActiveFilters,
  filtersHref,
  languageOptions,
  parseFilters,
  toOfferFilters,
  type FilterState,
} from "@/components/offers/filters";
import { OfferFiltersForm } from "@/components/offers/filters-form";
import { OfferList } from "@/components/offers/offer-list";
import type { SearchParams } from "@/components/search-params";
import { EmptyState, cx, eyebrowClass, linkClass, pageClass, secondaryButtonClass } from "@/components/ui";
import { UpdatedAgo } from "@/components/updated-ago";
import { getRepository, type Offer, type Printing } from "@/lib/data";
import { formatEuros, languageLabel, plural } from "@/lib/format";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// generateMetadata y la página comparten la consulta dentro de la misma petición
const loadCard = cache(async (id: string) => {
  if (!UUID.test(id)) return null;
  const repo = await getRepository();
  return repo.getCard(id);
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await loadCard((await params).id);
  if (!data) return { title: "Carta no encontrada" };
  const { card } = data;
  const name = card.nameEs && card.nameEs !== card.nameEn ? `${card.nameEs} (${card.nameEn})` : card.nameEn;
  const price =
    card.minPriceCents != null
      ? `desde ${formatEuros(card.minPriceCents)} en ${plural(card.offerCount, "oferta", "ofertas")}`
      : "ahora mismo sin stock";
  return {
    title: name,
    description: `Precio y stock de ${name} en tiendas físicas de Barcelona y L'Hospitalet y tiendas online de España: ${price}.`,
  };
}

export default async function CardPage({ params, searchParams }: Props) {
  const { id } = await params;
  const data = await loadCard(id);
  if (!data) notFound();
  const { card, printings } = data;

  const sets = uniqueSets(printings);
  const parsed = parseFilters(await searchParams);
  // solo vale una edición de esta carta, con el código tal como lo guarda el catálogo
  const filters: FilterState = {
    ...parsed,
    setCode: sets.find((s) => s.code.toLowerCase() === parsed.setCode)?.code ?? null,
  };

  const repo = await getRepository();
  const [allOffers, offers] = await Promise.all([repo.getOffers(id), repo.getOffers(id, toOfferFilters(filters))]);
  const now = new Date();
  const pathname = `/carta/${id}`;

  const inStock = offers.filter((o) => o.inStock);
  const best = inStock[0] ?? null;
  const storeCount = new Set(inStock.map((o) => o.store.id)).size;
  const reference = referencePrice(printings, filters);
  const freshest = latest(allOffers.map((o) => o.scrapedAt));

  const shown = (filters.setCode && printings.find((p) => p.setCode === filters.setCode && p.imageUrl)) || null;
  const imageUrl = shown?.imageUrl ?? card.imageUrl ?? printings.find((p) => p.imageUrl)?.imageUrl ?? null;
  const title = card.nameEs ?? card.nameEn;
  const subtitle = card.nameEs && card.nameEs !== card.nameEn ? card.nameEn : null;

  return (
    <div className={pageClass}>
      <nav aria-label="Migas de pan" className="text-sm text-ink-3">
        <Link href="/" className="hover:text-ink-2">
          Cartas
        </Link>
        <span aria-hidden="true" className="mx-1.5">
          /
        </span>
        <span className="text-ink-2">{title}</span>
      </nav>

      <div className="mt-4 grid grid-cols-[104px_minmax(0,1fr)] gap-x-4 gap-y-6 sm:grid-cols-[176px_minmax(0,1fr)] sm:gap-x-8 lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-x-12">
        <div className="sm:row-span-2">
          <CardImage src={imageUrl} alt={shown ? `${card.nameEn} (${shown.setName})` : `Carta ${card.nameEn}`} eager className="shadow-card" />
        </div>
        <div className="min-w-0 self-center sm:self-end">
          <h1
            lang={card.nameEs ? "es" : "en"}
            className="font-display text-[1.9rem] leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl"
          >
            {title}
          </h1>
          {subtitle && (
            <p lang="en" className="mt-1.5 font-display text-base text-ink-2 italic sm:text-lg">
              {subtitle}
            </p>
          )}
        </div>
        <div className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2">
          <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {best ? (
              <Tile label="Mejor precio" value={formatEuros(best.priceCents)} gold>
                {best.store.name} · {best.store.local ? "tienda física" : "online"}
              </Tile>
            ) : (
              <Tile label="Mejor precio" value="—">
                {countActiveFilters(filters) > 0 ? "Sin stock con estos filtros" : "Sin stock ahora mismo"}
              </Tile>
            )}
            <Tile label="Cardmarket" value={reference ? formatEuros(reference.cents) : "—"}>
              {reference ? reference.note : "Sin precio de referencia"}
            </Tile>
            <Tile label="Ofertas con stock" value={String(inStock.length)}>
              en {plural(storeCount, "tienda", "tiendas")}
            </Tile>
            <Tile label="Actualizado" value={freshest ? <UpdatedAgo iso={freshest} now={now} /> : "—"}>
              <Link href="/tiendas" className={linkClass}>
                Estado de las tiendas
              </Link>
            </Tile>
          </dl>

          {sets.length > 1 && (
            <div className="mt-6">
              <p className={eyebrowClass}>Ediciones</p>
              <ul className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
                {[{ code: null, name: "Todas" }, ...sets].map(({ code, name }) => {
                  const count = allOffers.filter((o) => o.inStock && (!code || o.printing?.setCode === code)).length;
                  const active = filters.setCode === code;
                  return (
                    <li key={code ?? "todas"} className="shrink-0">
                      <Link
                        href={filtersHref(pathname, { ...filters, setCode: code })}
                        scroll={false}
                        replace
                        aria-current={active ? "true" : undefined}
                        title={name}
                        className={cx(
                          "inline-flex items-center gap-2 rounded-full border py-1.5 pr-3 text-sm transition",
                          code ? "pl-2" : "pl-3",
                          active
                            ? "border-brand bg-brand-soft text-brand-strong"
                            : "border-line bg-surface text-ink-2 hover:border-line-strong",
                        )}
                      >
                        {code && <SetChip code={code} />}
                        <span className="max-w-[14rem] truncate font-medium">{name}</span>
                        <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-semibold text-ink-3 tabular-nums">
                          {count}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>

      <section aria-labelledby="ofertas" className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="ofertas" className="font-display text-2xl font-semibold">
              Ofertas
            </h2>
            <p className="mt-0.5 text-sm text-ink-3">
              {plural(offers.length, "oferta", "ofertas")} · de la más barata a la más cara
            </p>
          </div>
        </div>

        <div className="mt-4">
          <OfferFiltersForm
            pathname={pathname}
            filters={filters}
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
            <OfferList offers={offers} now={now} cardName={title} />
          ) : (
            <NoOffers all={allOffers} filters={filters} pathname={pathname} name={title} />
          )}
        </div>

        <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-ink-3">
          <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span>
            El precio y el stock los publica cada tienda en su web o en Cardmarket: confírmalos antes de ir. Las tiendas
            físicas venden las cartas sueltas por Cardmarket con el stock que nos comparten. La diferencia en % compara con
            el precio de Cardmarket de la misma edición y acabado.
          </span>
        </p>
      </section>
    </div>
  );
}

function Tile({ label, value, gold = false, children }: { label: string; value: ReactNode; gold?: boolean; children: ReactNode }) {
  return (
    <div className={cx("min-w-0 rounded-2xl border px-4 py-3", gold ? "border-gold/60 bg-gold-soft" : "border-line bg-surface")}>
      <dt className={cx("text-xs font-medium", gold ? "text-gold-ink" : "text-ink-3")}>{label}</dt>
      <dd className="mt-0.5 text-[1.4rem] leading-tight font-semibold tabular-nums">{value}</dd>
      <dd className="mt-0.5 truncate text-xs text-ink-2">{children}</dd>
    </div>
  );
}

function NoOffers({ all, filters, pathname, name }: { all: Offer[]; filters: FilterState; pathname: string; name: string }) {
  if (all.length === 0) {
    return (
      <EmptyState icon={<Inbox />} title={`Ninguna tienda tiene ${name} ahora mismo`}>
        Revisamos las tiendas cada 6–12 horas; vuelve a mirar más adelante.
      </EmptyState>
    );
  }
  const withSoldOut = filters.inStockOnly && (
    <Link href={filtersHref(pathname, { ...filters, inStockOnly: false })} scroll={false} replace className={secondaryButtonClass}>
      Ver también las agotadas
    </Link>
  );
  const inStock = all.filter((o) => o.inStock).length;
  // solo está el filtro por defecto (con stock): todo lo que hay está agotado
  if (countActiveFilters(filters) === 0) {
    return (
      <EmptyState icon={<Inbox />} title={`Ahora mismo ninguna tienda tiene ${name}`} action={withSoldOut}>
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
      {inStock > 0
        ? `Hay ${plural(inStock, "oferta con stock", "ofertas con stock")} de ${name} si quitas algún filtro.`
        : "Prueba a quitar algún filtro."}
      {filters.localOnly && " Puede que solo la tengan tiendas online."}
    </EmptyState>
  );
}

/** Ediciones distintas de la carta, en el orden de las impresiones */
function uniqueSets(printings: Printing[]): Array<{ code: string; name: string }> {
  const sets = new Map<string, string>();
  for (const p of printings) if (!sets.has(p.setCode)) sets.set(p.setCode, p.setName);
  return [...sets].map(([code, name]) => ({ code, name }));
}

/** Precio de Cardmarket más bajo de la edición y el acabado elegidos (o de todas) */
function referencePrice(printings: Printing[], filters: FilterState): { cents: number; note: string } | null {
  const pool = filters.setCode ? printings.filter((p) => p.setCode === filters.setCode) : printings;
  const foil = filters.finish === "foil";
  if (filters.finish === "etched") return null;
  const prices = pool.map((p) => (foil ? p.priceEurFoilCents : p.priceEurCents)).filter((p): p is number => p != null);
  if (!prices.length) return null;
  const finish = foil ? "foil" : "normal";
  const note = filters.setCode ? `${filters.setCode.toUpperCase()} · ${finish}` : `edición más barata · ${finish}`;
  return { cents: Math.min(...prices), note };
}

function latest(dates: string[]): string | null {
  return dates.reduce<string | null>((max, d) => (!max || Date.parse(d) > Date.parse(max) ? d : max), null);
}
