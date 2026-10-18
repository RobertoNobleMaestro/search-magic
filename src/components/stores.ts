import type { ListingSource, ScrapeRun, Store, StoreInfo } from "@/lib/data/types";
import { isStale, timeAgo } from "@/lib/format";

/** Qué ofrece una tienda y de dónde lo sacamos */
export type Offering = "sealed_web" | "singles_cardmarket" | "singles_web";

export const OFFERING_LABELS: Record<Offering, string> = {
  sealed_web: "Sellado en su web",
  singles_cardmarket: "Cartas sueltas vía Cardmarket",
  singles_web: "Cartas sueltas en su web",
};

/**
 * Lo que ofrece una tienda según su configuración y sus últimas ejecuciones:
 *   - web rastreable (platform) o ejecución "web" → sellado en su web; las tiendas online
 *     venden además cartas sueltas en ella (las físicas las venden por Cardmarket)
 *   - usuario de Cardmarket o ejecución "cardmarket_csv" → cartas sueltas vía Cardmarket
 */
export function storeOfferings(
  store: Pick<StoreInfo, "local" | "website" | "platform" | "cardmarketUser">,
  runs: Pick<ScrapeRun, "source">[] = [],
): Offering[] {
  const sources = new Set<ListingSource>(runs.map((r) => r.source));
  const web = sources.has("web") || (store.website != null && store.platform != null);
  const cardmarket = sources.has("cardmarket_csv") || store.cardmarketUser != null;
  const out: Offering[] = [];
  if (web && !store.local) out.push("singles_web");
  if (cardmarket) out.push("singles_cardmarket");
  if (web) out.push("sealed_web");
  return out;
}

export type HealthTone = "good" | "warn" | "bad";

export interface StoreHealth {
  tone: HealthTone;
  label: string;
  /** explicación corta; vacía si todo va bien */
  note: string;
}

type RunState = Pick<ScrapeRun, "source" | "status" | "finishedAt">;

const SHORT_SOURCE: Record<ListingSource, string> = { web: "Web", cardmarket_csv: "Cardmarket" };

/** Cómo va una fuente, en pocas palabras: "falló la última revisión", "al día"… */
function runState(run: RunState, now: Date): string {
  if (run.status === "error") return "falló la última revisión";
  if (run.status === "partial") return "revisión parcial";
  if (run.status === "running") return "revisando";
  if (run.status === "skipped") return "sin revisar";
  return run.finishedAt && !isStale(run.finishedAt, now) ? "al día" : "hace más de un día";
}

/**
 * Resumen del estado de los datos de una tienda (storeStatus de la maqueta). Con `runs` (la última
 * ejecución de cada fuente), si una fuente falla pero otra está al día no se pinta toda la tienda
 * como rota: aviso, con el estado de cada fuente ("Web: falló la última revisión · Cardmarket: al día").
 */
export function storeHealth(store: Pick<Store, "lastStatus" | "lastScrapedAt">, now: Date, runs: RunState[] = []): StoreHealth {
  const age = store.lastScrapedAt ? timeAgo(store.lastScrapedAt, now) : null;
  if (!age) return { tone: "warn", label: "Sin datos todavía", note: "Aún no hemos completado ninguna revisión" };
  const latest = [...new Map(runs.map((r) => [r.source, r] as const).reverse()).values()].reverse();
  if (latest.length > 1) {
    const failing = latest.some((r) => r.status === "error" || r.status === "partial");
    const healthy = latest.some((r) => r.status === "ok" && r.finishedAt && !isStale(r.finishedAt, now));
    if (failing && healthy) {
      const note = latest.map((r) => `${SHORT_SOURCE[r.source]}: ${runState(r, now)}`).join(" · ");
      return { tone: "warn", label: `Datos de ${age}`, note };
    }
  }
  if (store.lastStatus === "error") return { tone: "bad", label: `Datos de ${age}`, note: "La última revisión falló" };
  if (store.lastStatus === "partial") return { tone: "warn", label: `Parcial · ${age}`, note: "Algunas páginas no respondieron" };
  if (isStale(store.lastScrapedAt, now)) return { tone: "warn", label: `Datos de ${age}`, note: "Hace más de un día que no se revisa" };
  return { tone: "good", label: `Al día · ${age}`, note: "" };
}

export const TONE_CLASS: Record<HealthTone, { dot: string; text: string; soft: string }> = {
  good: { dot: "bg-good", text: "text-good", soft: "bg-good-soft" },
  warn: { dot: "bg-warn", text: "text-warn", soft: "bg-warn-soft" },
  bad: { dot: "bg-bad", text: "text-bad", soft: "bg-bad-soft" },
};

/** Las tiendas físicas primero; dentro de cada grupo, por ciudad y nombre */
export function compareStores(a: Pick<StoreInfo, "local" | "city" | "name">, b: Pick<StoreInfo, "local" | "city" | "name">): number {
  return Number(b.local) - Number(a.local) || a.city.localeCompare(b.city, "es") || a.name.localeCompare(b.name, "es");
}
