import Link from "next/link";
import { Suspense } from "react";
import { HeaderSearch } from "./header-search";
import { LogoMark, Wordmark } from "./icons";
import { NavLinks } from "./nav-links";
import { containerClass, cx } from "./ui";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className={cx(containerClass, "flex min-h-16 flex-wrap items-center gap-x-3 gap-y-0 sm:gap-x-6")}>
        <Link href="/" className="flex h-16 shrink-0 items-center gap-2.5" aria-label="search-magic, ir al inicio">
          <LogoMark className="size-8 shrink-0" />
          <Wordmark />
        </Link>
        {/* useSearchParams necesita un Suspense alrededor */}
        <Suspense fallback={null}>
          <HeaderSearch />
        </Suspense>
        <NavLinks />
      </div>
    </header>
  );
}
