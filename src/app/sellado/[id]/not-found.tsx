import { ExampleSearches } from "@/components/example-searches";
import { SearchBox } from "@/components/search-box";

export default function SealedNotFound() {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-20 text-center">
      <p className="text-sm font-semibold text-brand-strong">Error 404</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">No encontramos este producto</h1>
      <p className="mt-3 text-ink-2">
        El enlace no corresponde a ningún producto sellado del catálogo. Prueba a buscarlo por su edición:
      </p>
      <div className="mt-6 text-left">
        <SearchBox size="large" />
      </div>
      <ExampleSearches className="mt-5 justify-center" />
    </div>
  );
}
