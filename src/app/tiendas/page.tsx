import { Check, Globe, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { OFFERING_LABELS, TONE_CLASS, compareStores, storeHealth, storeOfferings, type HealthTone } from "@/components/stores";
import { ExternalLink, cx, eyebrowClass, linkClass, pageClass } from "@/components/ui";
import { getRepository, type ScrapeRun, type Store } from "@/lib/data";
import { WEB_REFRESH_HOURS, platformLabel, plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "Tiendas",
  description:
    "Tiendas físicas de Barcelona y L'Hospitalet y tiendas online de España cuyo stock de cartas sueltas y producto sellado compara search-magic.",
};

export default async function StoresPage() {
  await connection();
  const repo = await getRepository();
  const [stores, runs] = await Promise.all([repo.listStores(), repo.listLatestRuns()]);
  const now = new Date();
  const sorted = [...stores].sort(compareStores);
  const local = sorted.filter((s) => s.local);
  const online = sorted.filter((s) => !s.local);
  const runsByStore = Map.groupBy(runs, (r) => r.storeId);

  const counts: Record<HealthTone, number> = { good: 0, warn: 0, bad: 0 };
  for (const s of stores) counts[storeHealth(s, now, runsByStore.get(s.id)).tone]++;

  return (
    <div className={pageClass}>
      <p className={eyebrowClass}>De dónde salen los precios</p>
      <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">Tiendas</h1>
      <p className="mt-3 max-w-3xl leading-relaxed text-pretty text-ink-2">
        Las tiendas físicas de Barcelona y L&apos;Hospitalet venden el producto sellado en su web y las cartas sueltas por
        Cardmarket, con el stock que nos comparten. Las tiendas online del resto de España venden ambas cosas en su web.
        Revisamos la web de cada tienda cada {WEB_REFRESH_HOURS} horas (alguna muy grande, una vez por semana), respetando su
        robots.txt, y actualizamos su stock de Cardmarket cada vez que nos comparte uno nuevo. Si una revisión falla,
        seguimos enseñando los últimos datos buenos y avisamos de su antigüedad.
      </p>

      {stores.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2 text-sm">
          {(
            [
              ["good", "al día"],
              ["warn", "con datos parciales o viejos"],
              ["bad", "con error"],
            ] as const
          )
            .filter(([tone]) => counts[tone] > 0)
            .map(([tone, label]) => (
              <span
                key={tone}
                className={cx("inline-flex items-center gap-2 rounded-full px-3 py-1 font-medium", TONE_CLASS[tone].soft, TONE_CLASS[tone].text)}
              >
                <span aria-hidden="true" className={cx("size-1.5 rounded-full", TONE_CLASS[tone].dot)} />
                {counts[tone]} {label}
              </span>
            ))}
        </div>
      )}

      {stores.length === 0 && <p className="mt-8 text-ink-2">Todavía no hay tiendas.</p>}

      <Group id="fisicas" icon={<MapPin aria-hidden="true" className="size-5 text-ink-3" />} title="Tiendas físicas en Barcelona y L'Hospitalet" stores={local}>
        {local.map((store) => (
          <StoreCard key={store.id} store={store} runs={runsByStore.get(store.id) ?? []} now={now} />
        ))}
      </Group>

      <Group id="online" icon={<Globe aria-hidden="true" className="size-5 text-ink-3" />} title="Tiendas online (resto de España)" stores={online}>
        {online.map((store) => (
          <StoreCard key={store.id} store={store} runs={runsByStore.get(store.id) ?? []} now={now} />
        ))}
      </Group>

      <StoreOwnerNote contact={contactHref(process.env.SEARCH_MAGIC_CONTACT)} />
    </div>
  );
}

/** El mismo contacto que va en el User-Agent del worker (SEARCH_MAGIC_CONTACT): correo o URL */
function contactHref(contact: string | undefined): { href: string; text: string } | null {
  const value = contact?.trim();
  if (!value) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { href: `mailto:${value}`, text: value };
  if (/^https?:\/\//i.test(value) && URL.canParse(value)) return { href: value, text: new URL(value).host };
  return null;
}

function StoreOwnerNote({ contact }: { contact: { href: string; text: string } | null }) {
  return (
    <aside className="mt-12 rounded-2xl border border-line bg-brand-soft/60 p-6">
      <h2 className="font-display text-lg font-semibold">¿Tienes una tienda?</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-2">
        {contact ? (
          <>
            Si quieres aparecer, compartir tu stock de Cardmarket para que salgan tus cartas sueltas o que dejemos de revisar
            tu web, escríbenos a{" "}
            <a href={contact.href} className={linkClass}>
              {contact.text}
            </a>
            .
          </>
        ) : (
          <>
            Nuestro robot se identifica en cada visita a tu web con un User-Agent que dice cómo contactarnos: por ahí puedes
            pedirnos aparecer, compartir tu stock de Cardmarket para que salgan tus cartas sueltas o que dejemos de revisar tu
            web.
          </>
        )}
      </p>
    </aside>
  );
}

function Group({ id, icon, title, stores, children }: { id: string; icon: ReactNode; title: string; stores: Store[]; children: ReactNode }) {
  if (stores.length === 0) return null;
  return (
    <section aria-labelledby={`tiendas-${id}`} className="mt-10">
      <h2 id={`tiendas-${id}`} className="flex items-center gap-2 font-display text-xl font-semibold">
        {icon}
        {title}
        <span className="font-sans text-sm font-normal text-ink-3">{stores.length}</span>
      </h2>
      <ul className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{children}</ul>
    </section>
  );
}

function StoreCard({ store, runs, now }: { store: Store; runs: ScrapeRun[]; now: Date }) {
  const health = storeHealth(store, now, runs);
  const tone = TONE_CLASS[health.tone];
  const offerings = storeOfferings(store, runs);
  return (
    <li className="flex flex-col rounded-2xl border border-line bg-surface p-5">
      <div className="flex-1 pb-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-xl leading-tight font-semibold">
            <Link href={`/tiendas/${store.id}`} className="underline-offset-4 hover:text-brand-strong hover:underline">
              {store.name}
            </Link>
          </h3>
          {store.platform && (
            <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-3">
              {platformLabel(store.platform)}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-sm leading-snug text-ink-3">
          {store.address ?? `Solo online · ${store.city}${store.province && store.province !== store.city ? ` (${store.province})` : ""}`}
        </p>

        {offerings.length > 0 && (
          <ul className="mt-4 space-y-1.5 text-sm text-ink-2" aria-label="Qué ofrece">
            {offerings.map((o) => (
              <li key={o} className="flex items-center gap-2">
                <Check aria-hidden="true" className="size-4 shrink-0 text-good" />
                {OFFERING_LABELS[o]}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-end justify-between gap-3 border-t border-line pt-4">
        <div className="min-w-0">
          <p className={cx("inline-flex items-center gap-1.5 text-sm font-medium", tone.text)}>
            <span aria-hidden="true" className={cx("size-2 rounded-full", tone.dot)} />
            {health.label}
          </p>
          {health.note && <p className="mt-0.5 text-xs text-ink-3">{health.note}</p>}
        </div>
        {store.website && (
          <ExternalLink href={store.website} className={cx(linkClass, "inline-flex shrink-0 items-center gap-1 text-sm")} label={`de ${store.name}`}>
            Web
          </ExternalLink>
        )}
      </div>
    </li>
  );
}
