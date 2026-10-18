"use client";

import Link from "next/link";
import { useEffect } from "react";
import { buttonClass, secondaryButtonClass } from "@/components/ui";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-20 text-center">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Algo ha fallado</h1>
      <p className="mt-3 text-ink-2">No hemos podido cargar esta página. Vuelve a intentarlo en unos segundos.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={() => retry()} className={buttonClass}>
          Reintentar
        </button>
        <Link href="/" className={secondaryButtonClass}>
          Ir a la portada
        </Link>
      </div>
    </div>
  );
}
