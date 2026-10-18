import Link from "next/link";
import { LogoMark, Wordmark } from "./icons";
import { containerClass, cx } from "./ui";

const footerLink = "underline underline-offset-2 hover:text-ink-2";

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-line">
      <div className={cx(containerClass, "flex flex-col gap-6 py-10 sm:flex-row sm:items-start sm:justify-between")}>
        <div className="max-w-2xl space-y-3 text-xs leading-relaxed text-ink-3">
          <div className="flex items-center gap-2">
            <LogoMark className="size-6 shrink-0" />
            <Wordmark className="text-sm" />
          </div>
          <p>
            Datos e imágenes de cartas:{" "}
            <a href="https://scryfall.com" className={footerLink}>
              Scryfall
            </a>
            . Producto sellado:{" "}
            <a href="https://mtgjson.com" className={footerLink}>
              MTGJSON
            </a>
            . Precio de referencia:{" "}
            <a href="https://www.cardmarket.com" className={footerLink}>
              Cardmarket
            </a>
            , a través de Scryfall. Los precios y el stock son los que publica cada tienda en su web o en Cardmarket y pueden
            no estar al día: confírmalos antes de ir.
          </p>
          <p>
            search-magic es contenido de fans no oficial, permitido por la{" "}
            <a href="https://company.wizards.com/en/legal/fancontentpolicy" className={footerLink}>
              Política de contenido de fans
            </a>{" "}
            de Wizards of the Coast. No está aprobado ni respaldado por Wizards ni afiliado a las tiendas. Algunas partes de
            los materiales utilizados son propiedad de Wizards of the Coast. ©Wizards of the Coast LLC.
          </p>
        </div>
        <nav aria-label="Pie" className="flex gap-5 text-sm text-ink-2">
          <Link href="/" className="hover:text-ink">
            Buscar
          </Link>
          <Link href="/tiendas" className="hover:text-ink">
            Tiendas
          </Link>
        </nav>
      </div>
    </footer>
  );
}
