import type { NextRequest } from "next/server";
import { getRepository } from "@/lib/data";

const MAX_SUGGESTIONS = 8;
/** Igual que en la caja de búsqueda: por debajo de 3 caracteres la consulta es lenta y poco útil */
const MIN_CHARS = 3;

/** GET /api/autocompletar?q=rel → CardSuggestion[] (vacío con menos de 3 caracteres) */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < MIN_CHARS) return Response.json([]);
  const repo = await getRepository();
  return Response.json(await repo.autocomplete(q, MAX_SUGGESTIONS));
}
