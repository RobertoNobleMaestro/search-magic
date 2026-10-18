import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

// Geist para la interfaz, Geist Mono para los códigos y Fraunces para nombres de carta y títulos
const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const fraunces = Fraunces({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-fraunces" });

export const metadata: Metadata = {
  title: {
    default: "search-magic · Cartas y sellado de Magic en tiendas de Barcelona, L'Hospitalet y online",
    template: "%s · search-magic",
  },
  description:
    "Busca una carta o un producto sellado de Magic: The Gathering y compara precio, estado, idioma y stock en las tiendas físicas de Barcelona y L'Hospitalet y en tiendas online de España.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${geist.variable} ${geistMono.variable} ${fraunces.variable}`}>
      <body className="flex min-h-dvh flex-col bg-canvas font-sans text-ink antialiased">
        <a
          href="#contenido"
          className="sr-only rounded-xl bg-brand px-4 py-2 text-on-brand focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
        >
          Saltar al contenido
        </a>
        <SiteHeader />
        <main id="contenido" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
