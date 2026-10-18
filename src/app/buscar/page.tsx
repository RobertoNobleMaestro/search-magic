import { Inbox, Package, SearchX } from "lucide-react";
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
import { formatEuros, plural, sealedTypeLabel } from "@/lib/format";

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
  const [cards, found] = await Promise.all([repo.searchCards(q), repo.searchSealed(q)]);
  // el producto que alguna tienda tiene en stock, primero (sort es estable: se mantiene el orden del repositorio)
  const sealed = [...found].sort((a, b) => Number(b.offerCount > 0) - Number(a.offerCount > 0));
  // un único resultado en total: directamente a su página
  const [onlyCard] = cards;
  const [onlySealed] = sealed;
  if (cards.length === 1 && sealed.length === 0 && onlyCard) redirect(`/carta/${onlyCard.oracleId}`);
  if (sealed.length === 1 && cards.length === 0 && onlySealed) redirect(`/sellado/${onlySealed.sealedProductId}`);

  if (cards.length === 0 && sealed.length === 0) {
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

  // la sección con más resultados va primero si la otra está vacía
  const sealedFirst = cards.length === 0;
  const cardSection = (
    <Section key="cartas" id="cartas" title="Cartas sueltas" count={plural(cards.length, "carta", "cartas")}>
      {cards.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <li key={card.oracleId}>
              <CardResult card={card} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<SearchX />} title="Ninguna carta se llama así">
          Buscamos en los nombres de las cartas en español y en inglés.
        </EmptyState>
      )}
    </Section>
  );
  const sealedSection = (
    <Section key="sellado" id="sellado" title="Producto sellado" count={plural(sealed.length, "producto", "productos")}>
      {sealed.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sealed.map((product) => (
            <li key={product.sealedProductId}>
              <SealedResult product={product} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Package />} title="Ningún producto sellado coincide">
          Para cajas, bundles, sobres o mazos, busca por el nombre de la edición: «Bloomburrow», «Duskmourn»…
        </EmptyState>
      )}
    </Section>
  );

  return (
    <div className={pageClass}>
      <p className={eyebrowClass}>Búsqueda</p>
      <h1 className={`mt-1 ${titleClass}`}>Resultados para «{q}»</h1>
      <p className="mt-2 text-sm text-ink-3">
        {plural(cards.length, "carta suelta", "cartas sueltas")} y {plural(sealed.length, "producto sellado", "productos sellados")}.
        Buscamos en los nombres en español y en inglés.
      </p>
      {sealedFirst ? [sealedSection, cardSection] : [cardSection, sealedSection]}
    </div>
  );
}

function Section({ id, title, count, children }: { id: string; title: string; count: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`resultados-${id}`} className="mt-10">
      <h2 id={`resultados-${id}`} className="flex items-baseline gap-3 font-display text-2xl font-semibold">
        {title}
        <span className="font-sans text-sm font-normal text-ink-3">{count}</span>
      </h2>
      <div className="mt-4">{children}</div>
    </section>
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
          <PriceSummary minPriceCents={card.minPriceCents} offerCount={card.offerCount} />
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
          <PriceSummary minPriceCents={product.minPriceCents} offerCount={product.offerCount} compact />
        </div>
      </div>
    </Link>
  );
}

function PriceSummary({ minPriceCents, offerCount, compact = false }: { minPriceCents: number | null; offerCount: number; compact?: boolean }) {
  if (minPriceCents == null) {
    return (
      <p className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-3">
        <Inbox aria-hidden="true" className="size-3.5" />
        Sin stock ahora mismo
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
