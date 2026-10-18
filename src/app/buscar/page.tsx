import { ChevronDown, Inbox, Package, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { SetChip } from "@/components/badges";
import { CardImage } from "@/components/card-image";
import { ExampleSearches } from "@/components/example-searches";
import { SealedImage } from "@/components/sealed-image";
import { firstParam, type SearchParams } from "@/components/search-params";
import { EmptyState, eyebrowClass, pageClass, titleClass } from "@/components/ui";
import { getRepository, type CardSummary, type SealedSummary } from "@/lib/data";
import { availabilityLabel, formatEuros, plural, sealedTypeLabel } from "@/lib/format";

type Props = { searchParams: Promise<SearchParams> };

function readQuery(params: SearchParams): string {
  return (firstParam(params.q) ?? "").trim().slice(0, 100);
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = readQuery(await searchParams);
  return {
    title: q ? `Resultados para «${q}»` : "Buscar",
    robots: { index: false, follow: true },
  };
}

/**
 * Lo que alguna tienda tiene (con stock primero, luego agotado) y lo que no tiene ninguna, que va al
 * final y plegado: el catálogo es enorme y casi ninguna carta está en una tienda.
 * sort es estable, así que dentro de cada grupo se mantiene el orden de relevancia del repositorio.
 */
function splitByStores<T extends { offerCount: number; soldOutCount: number }>(items: T[]) {
  const inStores = items
    .filter((i) => i.offerCount > 0 || i.soldOutCount > 0)
    .sort((a, b) => Number(b.offerCount > 0) - Number(a.offerCount > 0));
  const nowhere = items.filter((i) => i.offerCount === 0 && i.soldOutCount === 0);
  return { total: items.length, inStores, nowhere };
}

export default async function SearchPage({ searchParams }: Props) {
  const q = readQuery(await searchParams);
  if (!q) {
    return (
      <div className={`${pageClass} max-w-2xl text-center`}>
        <h1 className={titleClass}>Buscar</h1>
        <p className="mt-3 text-ink-2">
          Escribe el nombre de una carta, en inglés o en español, o el de una edición para ver su producto sellado.
        </p>
        <ExampleSearches className="mt-6 justify-center" />
      </div>
    );
  }

  const repo = await getRepository();
  const [foundCards, foundSealed] = await Promise.all([repo.searchCards(q), repo.searchSealed(q)]);
  // un único resultado en total: directamente a su página
  const [onlyCard] = foundCards;
  const [onlySealed] = foundSealed;
  if (foundCards.length === 1 && foundSealed.length === 0 && onlyCard) redirect(`/carta/${onlyCard.oracleId}`);
  if (foundSealed.length === 1 && foundCards.length === 0 && onlySealed) redirect(`/sellado/${onlySealed.sealedProductId}`);

  if (foundCards.length === 0 && foundSealed.length === 0) {
    return (
      <div className={`${pageClass} max-w-3xl`}>
        <p className={eyebrowClass}>Búsqueda</p>
        <h1 className={`mt-1 ${titleClass}`}>Sin resultados</h1>
        <EmptyState icon={<SearchX />} title={`No encontramos «${q}»`} className="mt-8">
          Revisa cómo se escribe o prueba de otra forma: en inglés o en español («Lightning Bolt» o «Relámpago»), con una
          parte del nombre o con el nombre de la edición para el producto sellado. No hace falta escribir tildes.
        </EmptyState>
        <ExampleSearches className="mt-6 justify-center" />
      </div>
    );
  }

  const cards = splitByStores(foundCards);
  const sealed = splitByStores(foundSealed);
  // va primero la sección que alguna tienda tiene; si ninguna, la que tiene resultados
  const sealedFirst =
    cards.inStores.length === 0 && (sealed.inStores.length > 0 || (cards.total === 0 && sealed.total > 0));

  const cardSection = (
    <Section key="cartas" id="cartas" title="Cartas sueltas" count={inStoresCount(cards.total, cards.inStores.length, "carta", "cartas")}>
      {cards.total === 0 ? (
        <EmptyState icon={<SearchX />} title="Ninguna carta se llama así">
          Buscamos en los nombres de las cartas en español y en inglés.
        </EmptyState>
      ) : (
        <>
          {cards.inStores.length > 0 && (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cards.inStores.map((card) => (
                <li key={card.oracleId}>
                  <CardResult card={card} />
                </li>
              ))}
            </ul>
          )}
          {cards.nowhere.length > 0 && (
            <NotInStores
              summary={`${plural(cards.nowhere.length, "carta", "cartas")} que ${cards.inStores.length > 0 ? "tampoco tiene" : "no tiene"} ninguna tienda`}
              open={cards.inStores.length === 0}
            >
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cards.nowhere.map((card) => (
                  <li key={card.oracleId}>
                    <CardResult card={card} />
                  </li>
                ))}
              </ul>
            </NotInStores>
          )}
        </>
      )}
    </Section>
  );

  const sealedSection = (
    <Section
      key="sellado"
      id="sellado"
      title="Producto sellado"
      count={inStoresCount(sealed.total, sealed.inStores.length, "producto", "productos")}
    >
      {sealed.total === 0 ? (
        <EmptyState icon={<Package />} title="Ningún producto sellado coincide">
          Para cajas, bundles, sobres o mazos, busca por el nombre de la edición: «Bloomburrow», «Duskmourn»…
        </EmptyState>
      ) : (
        <>
          {sealed.inStores.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sealed.inStores.map((product) => (
                <li key={product.sealedProductId}>
                  <SealedResult product={product} />
                </li>
              ))}
            </ul>
          )}
          {sealed.nowhere.length > 0 && (
            <NotInStores
              summary={`${plural(sealed.nowhere.length, "producto", "productos")} que ${sealed.inStores.length > 0 ? "tampoco tiene" : "no tiene"} ninguna tienda`}
              open={sealed.inStores.length === 0}
            >
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sealed.nowhere.map((product) => (
                  <li key={product.sealedProductId}>
                    <SealedResult product={product} />
                  </li>
                ))}
              </ul>
            </NotInStores>
          )}
        </>
      )}
    </Section>
  );

  return (
    <div className={pageClass}>
      <p className={eyebrowClass}>Búsqueda</p>
      <h1 className={`mt-1 ${titleClass}`}>Resultados para «{q}»</h1>
      <p className="mt-2 text-sm text-ink-3">
        {plural(cards.total, "carta suelta", "cartas sueltas")} y {plural(sealed.total, "producto sellado", "productos sellados")}.
        Buscamos en los nombres en español y en inglés; primero lo que tiene alguna tienda.
      </p>
      {sealedFirst ? [sealedSection, cardSection] : [cardSection, sealedSection]}
    </div>
  );
}

/** "12 cartas · 3 en alguna tienda" */
function inStoresCount(total: number, inStores: number, one: string, many: string): string {
  return `${plural(total, one, many)} · ${inStores} en alguna tienda`;
}

function Section({ id, title, count, children }: { id: string; title: string; count: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`resultados-${id}`} className="mt-10">
      <h2 id={`resultados-${id}`} className="flex flex-wrap items-baseline gap-x-3 font-display text-2xl font-semibold">
        {title}
        <span className="font-sans text-sm font-normal text-ink-3">{count}</span>
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Resultados que no tiene ninguna tienda: plegados, salvo que no haya nada más que enseñar */
function NotInStores({ summary, open, children }: { summary: string; open: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group mt-6 rounded-2xl border border-line bg-surface-2/50">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronDown aria-hidden="true" className="size-4 transition group-open:rotate-180" />
        {summary}
      </summary>
      <div className="px-3 pb-3 sm:px-4 sm:pb-4">{children}</div>
    </details>
  );
}

function CardResult({ card }: { card: CardSummary }) {
  const title = card.nameEs ?? card.nameEn;
  return (
    <Link
      href={`/carta/${card.oracleId}`}
      className="group flex h-full gap-4 rounded-2xl border border-line bg-surface p-3 pr-4 transition hover:border-line-strong hover:shadow-card"
    >
      <CardImage src={card.imageUrl} alt={`Carta ${card.nameEn}`} size="small" className="w-24 shrink-0 shadow-sm sm:w-28" />
      <div className="flex min-w-0 flex-1 flex-col py-1">
        <h3
          lang={card.nameEs ? "es" : "en"}
          className="font-display text-xl leading-tight font-semibold text-balance transition group-hover:text-brand-strong"
        >
          {title}
        </h3>
        {card.nameEs && card.nameEs !== card.nameEn && (
          <p lang="en" className="mt-0.5 text-sm text-ink-3">
            {card.nameEn}
          </p>
        )}
        <div className="mt-auto pt-4">
          <PriceSummary item={card} gender="f" />
        </div>
      </div>
    </Link>
  );
}

function SealedResult({ product }: { product: SealedSummary }) {
  return (
    <Link
      href={`/sellado/${product.sealedProductId}`}
      className="group flex h-full gap-3 rounded-2xl border border-line bg-surface p-3 pr-4 transition hover:border-line-strong hover:shadow-card"
    >
      <SealedImage
        name={product.name}
        category={product.category}
        imageUrl={product.imageUrl}
        setIconUrl={product.setIconUrl}
        size="md"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="font-medium leading-snug text-balance transition group-hover:text-brand-strong">
          {sealedTypeLabel(product.category, product.subtype)}
        </h3>
        <p lang="en" className="mt-0.5 text-xs text-ink-3">
          {product.name}
        </p>
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-2">
          <SetChip code={product.setCode} />
          <span className="truncate">{product.setName}</span>
        </p>
        <div className="mt-auto pt-3">
          <PriceSummary item={product} gender="m" compact />
        </div>
      </div>
    </Link>
  );
}

type PriceInfo = { minPriceCents: number | null; offerCount: number; soldOutCount: number };

function PriceSummary({ item, gender, compact = false }: { item: PriceInfo; gender: "f" | "m"; compact?: boolean }) {
  const { minPriceCents, offerCount, soldOutCount } = item;
  if (minPriceCents == null) {
    // sin precio = ninguna oferta con stock: o está agotado, o no lo tiene nadie
    return (
      <p className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-3">
        <Inbox aria-hidden="true" className="size-3.5" />
        {availabilityLabel(0, soldOutCount, gender)}
      </p>
    );
  }
  if (compact) {
    return (
      <p className="flex items-baseline gap-2">
        <span className="text-xs text-ink-3">Desde</span>
        <span className="text-lg font-semibold tabular-nums">{formatEuros(minPriceCents)}</span>
        <span className="text-xs text-ink-2">{plural(offerCount, "oferta", "ofertas")}</span>
      </p>
    );
  }
  return (
    <>
      <p className="text-xs text-ink-3">Desde</p>
      <p className="text-2xl font-semibold tabular-nums">{formatEuros(minPriceCents)}</p>
      <p className="text-xs text-ink-2">{plural(offerCount, "oferta", "ofertas")}</p>
    </>
  );
}
