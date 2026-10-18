import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass, secondaryButtonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Página no encontrada" };

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-20 text-center">
      <p className="text-sm font-semibold text-brand-strong">Error 404</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">No encontramos esta página</h1>
      <p className="mt-3 text-ink-2">Puede que el enlace esté mal escrito o que la página ya no exista.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/" className={buttonClass}>
          Buscar una carta o un producto
        </Link>
        <Link href="/tiendas" className={secondaryButtonClass}>
          Ver tiendas
        </Link>
      </div>
    </div>
  );
}
