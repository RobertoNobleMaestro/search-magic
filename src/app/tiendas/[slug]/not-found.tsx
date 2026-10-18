import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function StoreNotFound() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-20 text-center">
      <p className="text-sm font-semibold text-brand-strong">Error 404</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">No encontramos esta tienda</h1>
      <p className="mt-3 text-ink-2">Puede que ya no esté en la lista o que el enlace esté mal.</p>
      <Link href="/tiendas" className={`${buttonClass} mt-8`}>
        Ver todas las tiendas
      </Link>
    </div>
  );
}
