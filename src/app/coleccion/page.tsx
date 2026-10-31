import type { Metadata } from "next";
import { CollectionApp } from "@/components/collection/collection-app";
import { eyebrowClass } from "@/components/ui";

export const metadata: Metadata = {
  title: "Tu colección",
  description: "Sube el CSV de ManaBox y mira todas tus cartas ordenadas por color, tipo, rareza o coste, con las repetidas juntas y su precio.",
  robots: { index: false, follow: true },
};

export default function CollectionPage() {
  return (
    // Más ancha que las demás páginas: así caben más cartas por fila y hay menos scroll
    <div className="mx-auto w-full max-w-[100rem] px-4 py-8 sm:px-6 sm:py-10">
      <p className={eyebrowClass}>Tu colección</p>
      <div className="mt-2">
        <CollectionApp />
      </div>
    </div>
  );
}
