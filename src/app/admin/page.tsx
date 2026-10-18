import { Lock, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { firstParam, type SearchParams } from "@/components/search-params";
import { StatusBadge } from "@/components/status-badge";
import { ExternalLink, Notice, cx, linkClass, pageClass, panelClass, smallButtonClass } from "@/components/ui";
import { getRepository, type ScrapeRun, type UnmatchedListing } from "@/lib/data";
import { formatDateTime, formatDuration, formatEuros, plural, sourceLabel, timeAgo } from "@/lib/format";

export const metadata: Metadata = {
  title: "Panel interno",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 20;

const KIND_LABELS: Record<UnmatchedListing["kind"], string> = { single: "Carta suelta", sealed: "Sellado" };

type Props = { searchParams: Promise<SearchParams> };

export default async function AdminPage({ searchParams }: Props) {
  const page = Math.max(1, Number.parseInt(firstParam((await searchParams).pagina) ?? "", 10) || 1);
  const repo = await getRepository();
  const [runs, stores, unmatched] = await Promise.all([
    repo.listLatestRuns(),
    repo.listStores(),
    repo.listUnmatched({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  ]);
  const now = new Date();
  const storeNames = new Map(stores.map((s) => [s.id, s.name]));
  const pages = Math.max(1, Math.ceil(unmatched.total / PAGE_SIZE));
  // la contraseña la comprueba src/proxy.ts; aquí solo se avisa si no hay
  const unprotected = !process.env.ADMIN_PASSWORD;

  const sortedRuns = [...runs].sort(
    (a, b) => (storeNames.get(a.storeId) ?? a.storeId).localeCompare(storeNames.get(b.storeId) ?? b.storeId, "es") || a.source.localeCompare(b.source),
  );
  const okStores = stores.filter((s) => s.lastStatus === "ok").length;
  const latestRun = runs.reduce<ScrapeRun | null>((max, r) => (!max || r.startedAt > max.startedAt ? r : max), null);

  return (
    <div className={pageClass}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Panel interno</h1>
        <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-3">
          <Lock aria-hidden="true" className="size-3" />
          Privado
        </span>
      </div>
      <p className="mt-2 text-sm text-ink-2">Estado del scraping y anuncios que el emparejador no ha sabido asignar.</p>

      {unprotected && (
        <Notice tone="warn" icon={<TriangleAlert aria-hidden="true" />} className="mt-4">
          Panel sin proteger: define ADMIN_PASSWORD para pedir contraseña (HTTP Basic).
        </Notice>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Tiendas al día" value={`${okStores}/${stores.length}`} sub="última ejecución OK" />
        <Kpi label="Ejecuciones" value={String(runs.length)} sub="una por tienda y fuente" />
        <Kpi label="Sin emparejar" value={String(unmatched.total)} sub="pendientes de revisar" tone={unmatched.total > 0 ? "text-warn" : undefined} />
        <Kpi
          label="Última ejecución"
          value={latestRun ? timeAgo(latestRun.startedAt, now) : "—"}
          sub={latestRun ? (storeNames.get(latestRun.storeId) ?? latestRun.storeId) : "todavía ninguna"}
        />
      </div>

      <section aria-labelledby="ejecuciones" className="mt-10">
        <h2 id="ejecuciones" className="font-display text-xl font-semibold">
          Última ejecución por tienda y fuente
        </h2>
        <TableBox minWidth="min-w-[880px]">
          <thead className={theadClass}>
            <tr>
              <Th className="pl-4">Tienda</Th>
              <Th>Fuente</Th>
              <Th>Estado</Th>
              <Th>Inicio</Th>
              <Th>Duración</Th>
              <Th className="text-right">Encontrados</Th>
              <Th className="text-right">Emparejados</Th>
              <Th className="pr-4 text-right">Sin emparejar</Th>
            </tr>
          </thead>
          <tbody>
            {sortedRuns.map((run) => (
              <RunRows key={run.id} run={run} storeName={storeNames.get(run.storeId) ?? run.storeId} now={now} />
            ))}
            {runs.length === 0 && <EmptyRow colSpan={8}>Todavía no hay ejecuciones.</EmptyRow>}
          </tbody>
        </TableBox>
      </section>

      <section aria-labelledby="sin-emparejar" className="mt-10">
        <h2 id="sin-emparejar" className="font-display text-xl font-semibold">
          Sin emparejar <span className="font-sans text-base font-normal text-ink-3">{unmatched.total}</span>
        </h2>
        <p className="mt-1 text-sm text-ink-3">No se muestran en la web hasta que se emparejan con una carta o un producto sellado.</p>
        <TableBox minWidth="min-w-[860px]">
          <thead className={theadClass}>
            <tr>
              <Th className="pl-4">Título en la tienda</Th>
              <Th>Tipo</Th>
              <Th>Fuente</Th>
              <Th>Tienda</Th>
              <Th className="text-right">Precio</Th>
              <Th>Mejor candidata</Th>
              <Th className="pr-4">
                <span className="sr-only">Enlace</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {unmatched.items.map((item) => (
              <UnmatchedRow key={item.listingId} item={item} storeName={storeNames.get(item.storeId) ?? item.storeId} />
            ))}
            {unmatched.items.length === 0 && (
              <EmptyRow colSpan={7}>{unmatched.total === 0 ? "No hay listados sin emparejar." : "No hay listados en esta página."}</EmptyRow>
            )}
          </tbody>
        </TableBox>
        <Pagination page={page} pages={pages} total={unmatched.total} />
      </section>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className={`${panelClass} px-4 py-3.5`}>
      <p className="text-xs font-medium text-ink-3">{label}</p>
      <p className={cx("mt-1 text-2xl font-semibold tabular-nums", tone)}>{value}</p>
      <p className="truncate text-xs text-ink-3">{sub}</p>
    </div>
  );
}

function RunRows({ run, storeName, now }: { run: ScrapeRun; storeName: string; now: Date }) {
  return (
    <>
      <tr className="border-t border-line align-top">
        <Td className="pl-4 font-medium whitespace-nowrap">
          <Link href={`/tiendas/${run.storeId}`} className="underline-offset-4 hover:text-brand-strong hover:underline">
            {storeName}
          </Link>
        </Td>
        <Td className="whitespace-nowrap text-ink-2">{sourceLabel(run.source)}</Td>
        <Td>
          <StatusBadge status={run.status} />
        </Td>
        <Td className="whitespace-nowrap text-ink-2">
          <p>{formatDateTime(run.startedAt)}</p>
          <p className="text-xs text-ink-3">{timeAgo(run.startedAt, now)}</p>
        </Td>
        <Td className="whitespace-nowrap text-ink-2">
          {run.finishedAt ? formatDuration(Date.parse(run.finishedAt) - Date.parse(run.startedAt)) : "—"}
        </Td>
        <Td className="text-right tabular-nums">{run.found}</Td>
        <Td className="text-right tabular-nums">{run.matched}</Td>
        <Td className={cx("pr-4 text-right tabular-nums", run.unmatched ? "font-semibold text-warn" : "text-ink-3")}>{run.unmatched}</Td>
      </tr>
      {run.error && (
        <tr>
          <td colSpan={8} className="px-4 pb-3">
            <p
              className={cx(
                "flex items-center gap-2 rounded-lg px-3 py-2 font-mono text-xs",
                run.status === "error" ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn",
              )}
            >
              <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
              {run.error}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

function UnmatchedRow({ item, storeName }: { item: UnmatchedListing; storeName: string }) {
  return (
    <tr className="border-t border-line align-top">
      <Td className="max-w-sm pl-4">
        <p className="font-mono text-[13px] break-words text-ink">{item.rawTitle}</p>
      </Td>
      <Td className="whitespace-nowrap text-ink-2">{KIND_LABELS[item.kind]}</Td>
      <Td className="whitespace-nowrap text-ink-2">{sourceLabel(item.source)}</Td>
      <Td className="whitespace-nowrap">{storeName}</Td>
      <Td className="text-right whitespace-nowrap tabular-nums">{formatEuros(item.priceCents)}</Td>
      <Td className="min-w-48">
        {item.bestGuess ? (
          <>
            <p className="truncate text-sm">
              <span className="text-ink-3">¿Es </span>
              <Link href={`/carta/${item.bestGuess.oracleId}`} lang="en" className={linkClass}>
                {item.bestGuess.nameEn}
              </Link>
              <span className="text-ink-3">?</span>
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-3">
                <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.round(item.bestGuess.confidence * 100)}%` }} />
              </span>
              <span className="text-xs text-ink-3 tabular-nums">{Math.round(item.bestGuess.confidence * 100)} %</span>
            </div>
          </>
        ) : (
          <span className="text-sm text-ink-3 italic">Sin candidata</span>
        )}
      </Td>
      <Td className="pr-4 text-right">
        <ExternalLink href={item.url} className={smallButtonClass} label={`«${item.rawTitle}» en ${storeName}`}>
          Ver
        </ExternalLink>
      </Td>
    </tr>
  );
}

function Pagination({ page, pages, total }: { page: number; pages: number; total: number }) {
  if (total <= PAGE_SIZE && page === 1) return null;
  const href = (p: number) => (p === 1 ? "/admin" : `/admin?pagina=${p}`);
  return (
    <nav aria-label="Paginación" className="mt-4 flex items-center justify-between gap-4 text-sm">
      {page > 1 ? (
        <Link href={href(Math.min(page - 1, pages))} className={linkClass}>
          ← Anterior
        </Link>
      ) : (
        <span />
      )}
      <span className="text-ink-2">
        Página {page} de {pages} · {plural(total, "listado", "listados")}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className={linkClass}>
          Siguiente →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

const theadClass = "bg-surface-2 text-left text-xs text-ink-3";

function TableBox({ children, minWidth }: { children: ReactNode; minWidth: string }) {
  return (
    <div className={`${panelClass} mt-4 overflow-x-auto`}>
      <table className={cx("w-full text-left text-sm", minWidth)}>{children}</table>
    </div>
  );
}

function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th scope="col" className={cx("px-3 py-2.5 font-medium whitespace-nowrap", className)}>
      {children}
    </th>
  );
}

function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cx("px-3 py-3", className)}>{children}</td>;
}

function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr className="border-t border-line">
      <td colSpan={colSpan} className="px-3 py-6 text-center text-ink-3">
        {children}
      </td>
    </tr>
  );
}
