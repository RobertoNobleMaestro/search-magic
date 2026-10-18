import type { Repository } from "./types";

export * from "./types";

let current: Promise<Repository> | undefined;

/**
 * Implementación activa del contrato de datos:
 *   DATA_SOURCE=db  → Neon/PostgreSQL (./repository)
 *   otro valor o sin definir → datos de ejemplo en memoria (./mock)
 */
export function getRepository(): Promise<Repository> {
  current ??=
    process.env.DATA_SOURCE === "db"
      ? import("./repository").then((m) => m.createDbRepository())
      : import("./mock").then((m) => m.createMockRepository());
  return current;
}
