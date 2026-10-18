import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Imágenes de cartas servidas por Scryfall
  images: {
    remotePatterns: [{ protocol: "https", hostname: "cards.scryfall.io" }],
  },
  // El driver de Postgres se queda fuera del bundle del servidor
  serverExternalPackages: ["pg"],
};

export default nextConfig;
