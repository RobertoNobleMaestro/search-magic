import { Search } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import { connection } from "next/server";
import { SealedProductGrid } from "@/components/sealed";
import { buttonClass, cx, eyebrowClass, inputClass, pageClass, titleClass } from "@/components/ui";
import { getRepository, type Repository, type SealedSummary } from "@/lib/data";

export const metadata: Metadata = {
  title: "Producto sellado",
  description:
    "Cajas de sobres, bundles, sobres y kits de presentación de Magic: precio y stock en las tiendas de Barcelona, L'Hospitalet y online.",
};

/** Una sección por tipo de producto; la búsqueda devuelve primero lo que tiene ofertas y lo más reciente */
const SECTIONS: Array<{ title: string; q: string }> = [
  { title: "Cajas de sobres", q: "booster box" },
  { title: "Bundles", q: "bundle" },
  { title: "Sobres", q: "booster pack" },
  { title: "Kits de presentación", q: "prerelease kit" },
];
const PER_SECTION = 6;

/** Productos con alguna oferta (sin cajas de cajas, que despistan en un escaparate) */
async function section(repo: Repository, q: string): Promise<SealedSummary[]> {
  const found = await repo.searchSealed(q, PER_SECTION * 4);
  return found.filter((p) => p.offerCount > 0 && !p.category?.endsWith("_case")).slice(0, PER_SECTION);
}

export default async function SealedIndexPage() {
  await connection();
  const repo = await getRepository();
  const sections = await Promise.all(SECTIONS.map(async (s) => ({ ...s, products: await section(repo, s.q) })));
  const filled = sections.filter((s) => s.products.length > 0);

  return (
    <div className={pageClass}>
      <p className={eyebrowClass}>Cajas, bundles, sobres y mazos</p>
      <h1 className={cx(titleClass, "mt-1")}>Producto sellado</h1>
      <p className="mt-3 max-w-3xl leading-relaxed text-pretty text-ink-2">
        Las tiendas físicas de Barcelona y L&apos;Hospitalet venden el producto sellado en su web, igual que las tiendas online.
        Busca una edición para comparar todos sus productos.
      </p>

      <Form action="/buscar" role="search" className="mt-6 flex max-w-xl gap-2">
        <label htmlFor="sellado-q" className="sr-only">
          Edición o producto
        </label>
        <input
          id="sellado-q"
          name="q"
          type="search"
          required
          maxLength={100}
          placeholder="Bloomburrow, Bundle Duskmourn…"
          className={cx(inputClass, "min-w-0 flex-1")}
        />
        <button type="submit" className={buttonClass}>
          <Search aria-hidden="true" className="size-4" />
          Buscar
        </button>
      </Form>

      {filled.map((s) => (
        <section key={s.q} aria-labelledby={`sellado-${s.q.replace(/ /g, "-")}`} className="mt-12">
          <h2 id={`sellado-${s.q.replace(/ /g, "-")}`} className="font-display text-xl font-semibold">
            {s.title}
          </h2>
          <SealedProductGrid products={s.products} showSet />
        </section>
      ))}
      {filled.length === 0 && <p className="mt-12 text-ink-3">Todavía no hay producto sellado con ofertas.</p>}
    </div>
  );
}
