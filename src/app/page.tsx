import { ArrowRight, Globe, Scale, Search, Store as StoreIcon } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { CardImage } from "@/components/card-image";
import { ExampleSearches } from "@/components/example-searches";
import { SparkIcon } from "@/components/icons";
import { SearchBox } from "@/components/search-box";
import { TONE_CLASS, compareStores, storeHealth } from "@/components/stores";
import { containerClass, cx, eyebrowClass, linkClass } from "@/components/ui";
import { getRepository, type CardSummary, type Repository } from "@/lib/data";
import { formatEuros, plural, timeAgo } from "@/lib/format";

const STEPS = [
  {
    icon: Search,
    title: "Busca en español o en inglés",
    text: "«Relámpago» o «Lightning Bolt», una edición o un producto sellado: lo encontramos aunque la tienda lo escriba de otra forma.",
  },
  {
    icon: Scale,
    title: "Compara cada copia",
    text: "Precio, estado, idioma, acabado y edición, con el precio de Cardmarket como referencia en las cartas sueltas.",
  },
  {
    icon: StoreIcon,
    title: "Ve a la tienda",
    text: "Te llevamos a su web o a su perfil de Cardmarket para comprar o reservar. Nosotros no vendemos nada.",
  },
];

/** Cartas del abanico de la portada: nombre que se busca y texto de la etiqueta */
const FAN = [
  { q: "Sheoldred, the Apocalypse", label: "Sheoldred" },
  { q: "Ragavan, Nimble Pilferer", label: "Ragavan" },
  { q: "Lightning Bolt", label: "Relámpago" },
];

export default async function HomePage() {
  // los datos cambian con cada scraping: nada de prerenderizar en el build
  await connection();
  const repo = await getRepository();
  const [stores, fan] = await Promise.all([repo.listStores(), loadFan(repo)]);
  const now = new Date();

  const local = stores.filter((s) => s.local);
  const online = stores.filter((s) => !s.local);
  const lastUpdate = stores.reduce<string | null>(
    (latest, s) => (s.lastScrapedAt && (!latest || Date.parse(s.lastScrapedAt) > Date.parse(latest)) ? s.lastScrapedAt : latest),
    null,
  );
  const [first, second, third] = fan;

  return (
    <>
      <section className="relative overflow-x-clip">
        <div aria-hidden="true" className="hero-glow pointer-events-none absolute inset-0" />
        <div
          className={cx(
            containerClass,
            "relative grid grid-cols-[minmax(0,1fr)] items-center gap-12 pt-10 pb-16 sm:pt-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:pt-20 lg:pb-24",
          )}
        >
          <div>
            {stores.length > 0 && (
              <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-xs font-medium text-ink-2 backdrop-blur">
                <span aria-hidden="true" className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-50" />
                  <span className="relative inline-flex size-2 rounded-full bg-good" />
                </span>
                <span>
                  {plural(local.length, "tienda física", "tiendas físicas")} y {online.length} online
                  {lastUpdate && ` · actualizado ${timeAgo(lastUpdate, now)}`}
                </span>
              </p>
            )}
            <h1 className="mt-6 font-display text-[2.5rem] leading-[1.04] font-semibold tracking-tight text-balance sm:text-6xl lg:text-[4rem]">
              Tus cartas y tu sellado <em className="font-medium text-brand-strong">al mejor precio</em> sin recorrerte todas
              las tiendas.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-pretty text-ink-2">
              Busca una carta suelta o un producto sellado de Magic y compara precio, estado, idioma y edición en las tiendas
              físicas de Barcelona y L&apos;Hospitalet y en tiendas online de toda España.
            </p>
            <div className="mt-8 max-w-xl">
              <SearchBox size="large" />
            </div>
            <ExampleSearches className="mt-4" />
          </div>

          {first && second && third && (
            <div aria-hidden="true" className="relative hidden h-[470px] lg:block">
              <FanCard card={first} label={FAN[0]!.label} className="top-12 left-[2%] w-[47%] -rotate-9" tag="left-2" />
              <FanCard card={second} label={FAN[1]!.label} className="top-16 right-0 w-[47%] rotate-8" tag="right-2" />
              <FanCard
                card={third}
                label={`${FAN[2]!.label} desde`}
                className="top-0 left-1/2 z-10 w-[51%] -translate-x-1/2"
                tag="left-1/2 -translate-x-1/2"
                spark
              />
            </div>
          )}
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <ol className={cx(containerClass, "grid gap-8 py-12 md:grid-cols-3 md:gap-10")}>
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="flex gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand-strong">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <div>
                <p className="text-xs font-semibold text-ink-3">Paso {i + 1}</p>
                <h2 className="mt-0.5 font-display text-lg font-semibold">{title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-2">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="datos" className={cx(containerClass, "pt-14")}>
        <p className={eyebrowClass}>De dónde salen los datos</p>
        <h2 id="datos" className="mt-1 font-display text-2xl font-semibold sm:text-3xl">
          Tiendas de tu barrio y tiendas online
        </h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <DataSource
            icon={<StoreIcon aria-hidden="true" className="size-5" />}
            title="Tiendas físicas de Barcelona y L'Hospitalet"
            count={plural(local.length, "tienda", "tiendas")}
            highlight
          >
            <li>
              <strong className="font-medium text-ink">Producto sellado</strong> (cajas, sobres, bundles, mazos): lo leemos de
              su web.
            </li>
            <li>
              <strong className="font-medium text-ink">Cartas sueltas</strong>: las venden por Cardmarket y nos comparten su
              stock. Te enlazamos a su perfil para comprarlas o pedir que te las reserven.
            </li>
          </DataSource>
          <DataSource
            icon={<Globe aria-hidden="true" className="size-5" />}
            title="Tiendas online del resto de España"
            count={plural(online.length, "tienda", "tiendas")}
          >
            <li>
              <strong className="font-medium text-ink">Cartas sueltas y sellado</strong>: los leemos de su propia web, con
              envío a casa.
            </li>
            <li>Activa «Solo tiendas físicas» en una carta si quieres comprar en mano.</li>
          </DataSource>
        </div>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink-3">
          Revisamos cada tienda cada 6–12 horas, respetando su robots.txt y sin pasar de una petición por segundo. Nunca
          consultamos en directo: lo que ves es la última revisión. Si vas a ir a por algo concreto, confírmalo antes con la
          tienda.
        </p>
      </section>

      {stores.length > 0 && (
        <section aria-labelledby="tiendas" className={cx(containerClass, "pt-14")}>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className={eyebrowClass}>Dónde buscamos</p>
              <h2 id="tiendas" className="mt-1 font-display text-2xl font-semibold sm:text-3xl">
                Tiendas que comparamos
              </h2>
            </div>
            <Link href="/tiendas" className={cx(linkClass, "inline-flex shrink-0 items-center gap-1 text-sm")}>
              Ver todas
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...stores].sort(compareStores).map((store) => {
              const health = storeHealth(store, now);
              const tone = TONE_CLASS[health.tone];
              return (
                <li key={store.id}>
                  <Link
                    href={`/tiendas/${store.id}`}
                    className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 transition hover:border-line-strong"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 font-display text-base font-semibold text-ink-2">
                      {store.name.replace(/^(El|La|Los|Las) /, "").charAt(0)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{store.name}</span>
                      <span className="block truncate text-xs text-ink-3">
                        {store.local ? "Tienda física" : "Online"} · {store.city}
                      </span>
                    </span>
                    <span className={cx("inline-flex shrink-0 items-center gap-1.5 text-xs", tone.text)}>
                      <span aria-hidden="true" className={cx("size-1.5 rounded-full", tone.dot)} />
                      {health.tone === "good" && store.lastScrapedAt ? timeAgo(store.lastScrapedAt, now) : health.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

async function loadFan(repo: Repository): Promise<Array<CardSummary | undefined>> {
  const results = await Promise.all(FAN.map(({ q }) => repo.searchCards(q, 1)));
  return results.map((r) => r[0]).map((c) => (c?.imageUrl ? c : undefined));
}

function FanCard({ card, label, className, tag, spark = false }: { card: CardSummary; label: string; className: string; tag: string; spark?: boolean }) {
  return (
    <figure className={cx("absolute transition duration-300 hover:-translate-y-2", className)}>
      <CardImage src={card.imageUrl} alt={`Carta ${card.nameEn}`} eager className="shadow-pop" />
      <figcaption
        className={cx(
          "absolute -bottom-4 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium whitespace-nowrap text-ink-2 shadow-card",
          tag,
        )}
      >
        {spark && <SparkIcon className="-mt-0.5 mr-1 inline size-3 text-gold-ink" />}
        {label}
        {card.minPriceCents != null && (
          <>
            {spark ? " " : " · "}
            <b className="font-semibold text-ink tabular-nums">{formatEuros(card.minPriceCents)}</b>
          </>
        )}
      </figcaption>
    </figure>
  );
}

function DataSource({
  icon,
  title,
  count,
  highlight = false,
  children,
}: {
  icon: ReactNode;
  title: string;
  count: string;
  highlight?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cx("rounded-2xl border p-5", highlight ? "border-brand/30 bg-brand-soft/60" : "border-line bg-surface")}>
      <div className="flex items-center gap-3">
        <span className={cx("grid size-10 shrink-0 place-items-center rounded-xl", highlight ? "bg-surface text-brand-strong" : "bg-surface-2 text-ink-2")}>
          {icon}
        </span>
        <div>
          <h3 className="font-display text-lg leading-tight font-semibold">{title}</h3>
          <p className="text-xs text-ink-3">{count}</p>
        </div>
      </div>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-2 marker:text-ink-3">{children}</ul>
    </div>
  );
}
