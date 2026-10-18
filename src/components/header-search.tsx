"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { SearchBox } from "./search-box";

/**
 * Caja de búsqueda compacta de la cabecera: en línea desde md y en una segunda fila en móvil.
 * En la portada no se muestra: ya tiene la grande.
 */
export function HeaderSearch() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (pathname === "/") return null;
  const q = pathname === "/buscar" ? (searchParams.get("q") ?? "") : "";
  return (
    <div className="order-last w-full pb-3 md:order-none md:w-auto md:max-w-md md:flex-1 md:pb-0">
      {/* la key vuelve a montar la caja al cambiar de página: empieza vacía o con la búsqueda actual */}
      <SearchBox key={`${pathname}?${q}`} size="compact" initialQuery={q} />
    </div>
  );
}
