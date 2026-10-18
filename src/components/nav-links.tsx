"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Buscar", section: ["/", "/buscar", "/carta", "/sellado"] },
  { href: "/tiendas", label: "Tiendas", section: ["/tiendas"] },
];

function inSection(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`)));
}

/** Navegación principal; marca la sección en la que se está */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Principal" className="ml-auto">
      <ul className="flex items-center gap-0.5">
        {LINKS.map((link) => {
          const current = inSection(pathname, link.section);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={pathname === link.href ? "page" : undefined}
                data-current={current || undefined}
                className="rounded-lg px-3 py-2 text-sm font-medium text-ink-2 transition hover:bg-surface-2 hover:text-ink data-current:bg-surface-2 data-current:text-ink"
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
