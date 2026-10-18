import { ArrowLeft, Check, MapPin, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache, type ReactNode } from "react";
import { StoreKindBadge } from "@/components/badges";
import { StatusBadge } from "@/components/status-badge";
import { OFFERING_LABELS, TONE_CLASS, storeHealth, storeOfferings } from "@/components/stores";
import { ExternalLink, Notice, buttonClass, cx, linkClass, pageClass, panelClass, secondaryButtonClass } from "@/components/ui";
import { UpdatedAgo } from "@/components/updated-ago";
import { getRepository, type ScrapeRun } from "@/lib/data";
import { STALE_HOURS, cardmarketProfileUrl, formatDateTime, isStale, platformLabel, plural, sourceLabel } from "@/lib/format";

type Props = { params: Promise<{ slug: string }> };

const loadStore = cache(async (slug: string) => {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const repo = await getRepository();
  return repo.getStore(slug);
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const store = await loadStore((await params).slug);
  if (!store) return { title: "Tienda no encontrada" };
  const kind = store.local ? "tienda física" : "tienda online";
  return {
    title: store.name,
    description: `${store.name}, ${kind} (${store.city}): qué vende, dónde está y cuándo revisamos su stock de Magic por última vez.`,
  };
}

export default async function StorePage({ params }: Props) {
  await connection();
  const store = await loadStore((await params).slug);
  if (!store) notFound();
  const now = new Date();
  const health = storeHealth(store, now, store.latestRuns);
  const offerings = storeOfferings(store, store.latestRuns);
  const mapsUrl = store.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${store.name}, ${store.address}`)}`
    : null;
  const cardmarketUrl = store.cardmarketUser ? cardmarketProfileUrl(store.cardmarketUser) : null;

  return (
    <div className={`${pageClass} max-w-3xl`}>
      <Link href="/tiendas" className={cx(linkClass, "inline-flex items-center gap-1 text-sm")}>
        <ArrowLeft aria-hidden="true" className="size-4" />
        Todas las tiendas
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-balance">{store.name}</h1>
        <StoreKindBadge store={store} className="text-xs" />
      </div>
      <p className={cx("mt-2 inline-flex items-center gap-1.5 text-sm font-medium", TONE_CLASS[health.tone].text)}>
        <span aria-hidden="true" className={cx("size-2 rounded-full", TONE_CLASS[health.tone].dot)} />
        {health.label}
        {health.note && <span className="font-normal text-ink-3">· {health.note}</span>}
      </p>

      {(mapsUrl || store.website || cardmarketUrl) && (
        <div className="mt-6 flex flex-wrap gap-3">
          {mapsUrl && (
            <ExternalLink href={mapsUrl} className={buttonClass} label={`a ${store.name} en Google Maps`}>
              <MapPin aria-hidden="true" className="size-4" />
              Cómo llegar
            </ExternalLink>
          )}
          {store.website && (
            <ExternalLink href={store.website} className={secondaryButtonClass} label={`de ${store.name}`}>
              Web de la tienda
            </ExternalLink>
          )}
          {cardmarketUrl && (
            <ExternalLink href={cardmarketUrl} className={secondaryButtonClass} label={`de ${store.name}`}>
              Perfil en Cardmarket
            </ExternalLink>
          )}
        </div>
      )}

      {isStale(store.lastScrapedAt, now) && (
        <Notice tone="warn" icon={<TriangleAlert aria-hidden="true" />} className="mt-6">
          {store.lastScrapedAt
            ? `Los datos de esta tienda tienen más de ${STALE_HOURS} h: el stock puede no estar al día.`
            : "Todavía no tenemos datos de esta tienda."}
        </Notice>
      )}

      {offerings.length > 0 && (
        <section aria-labelledby="ofrece" className="mt-8">
          <h2 id="ofrece" className="font-display text-xl font-semibold">
            Qué encontrarás
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {offerings.map((o) => (
              <li key={o} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-2">
                <Check aria-hidden="true" className="size-4 shrink-0 text-good" />
                {OFFERING_LABELS[o]}
              </li>
            ))}
          </ul>
        </section>
      )}

      <dl className={`${panelClass} mt-8 divide-y divide-line`}>
        <Row label="Dirección">{store.address ?? <span className="text-ink-3">Tienda solo online</span>}</Row>
        <Row label="Ciudad">
          {store.city}
          {store.province && store.province !== store.city && <span className="text-ink-3"> ({store.province})</span>}
        </Row>
        <Row label="Web">
          {store.website ? (
            <ExternalLink href={store.website} className={cx(linkClass, "inline-flex items-center gap-1")}>
              {hostname(store.website)}
            </ExternalLink>
          ) : (
            <span className="text-ink-3">No tiene web con tienda</span>
          )}
        </Row>
        {store.platform && <Row label="Plataforma">{platformLabel(store.platform)}</Row>}
        <Row label="Cardmarket">
          {cardmarketUrl && store.cardmarketUser ? (
            <ExternalLink href={cardmarketUrl} className={cx(linkClass, "inline-flex items-center gap-1")}>
              {store.cardmarketUser}
            </ExternalLink>
          ) : (
            <span className="text-ink-3">No nos comparte stock de Cardmarket</span>
          )}
        </Row>
        <Row label="Productos emparejados">
          {store.listingCount} <span className="text-ink-3">({store.inStockCount} con stock)</span>
        </Row>
        <Row label="Última actualización">
          <UpdatedAgo iso={store.lastScrapedAt} now={now} />
          {store.lastScrapedAt && <span className="ml-2 text-ink-3">({formatDateTime(store.lastScrapedAt)})</span>}
        </Row>
      </dl>

      <section aria-labelledby="revisiones" className="mt-8">
        <h2 id="revisiones" className="font-display text-xl font-semibold">
          Últimas revisiones
        </h2>
        <p className="mt-1 text-sm text-ink-3">La última ejecución de cada fuente de datos de la tienda.</p>
        {store.latestRuns.length > 0 ? (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {store.latestRuns.map((run) => (
              <RunCard key={run.id} run={run} now={now} />
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-ink-2">Todavía no hemos revisado esta tienda.</p>
        )}
      </section>
    </div>
  );
}

function RunCard({ run, now }: { run: ScrapeRun; now: Date }) {
  return (
    <li className={`${panelClass} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{sourceLabel(run.source)}</p>
        <StatusBadge status={run.status} />
      </div>
      <p className="mt-1 text-sm text-ink-3">
        {run.finishedAt ? (
          <>
            Terminó <UpdatedAgo iso={run.finishedAt} now={now} />
          </>
        ) : (
          <>Empezó {formatDateTime(run.startedAt)}</>
        )}
      </p>
      <p className="mt-2 text-sm text-ink-2 tabular-nums">
        {plural(run.found, "listado", "listados")} · {run.matched} emparejados
        {run.unmatched > 0 && <span className="text-warn"> · {run.unmatched} sin emparejar</span>}
      </p>
      {run.error && (
        <p
          className={cx(
            "mt-3 flex items-start gap-2 rounded-lg px-3 py-2 font-mono text-xs",
            run.status === "error" ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn",
          )}
        >
          <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {run.error}
        </p>
      )}
    </li>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
