import type { Metadata } from "next";
import { DeckApp } from "@/components/deck/deck-app";
import { eyebrowClass, pageClass, titleClass } from "@/components/ui";

export const metadata: Metadata = {
  title: "Tu mazo",
  description: "Importa tu mazo de Commander desde ManaBox, míralo de forma visual y decide qué cartas nuevas entran y cuáles salen.",
  robots: { index: false, follow: true },
};

export default function DeckPage() {
  return (
    <div className={pageClass}>
      <p className={eyebrowClass}>Mazos de Commander</p>
      <h1 className={`mt-1 ${titleClass}`}>Tu mazo</h1>
      <p className="mt-2 max-w-2xl text-ink-2">
        Míralo carta a carta, con la curva y el precio, y cuando tengas cartas nuevas te propongo por cuál cambiar cada una y por qué.
      </p>
      <div className="mt-8">
        <DeckApp />
      </div>
    </div>
  );
}
