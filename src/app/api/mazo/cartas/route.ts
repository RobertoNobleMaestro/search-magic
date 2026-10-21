import { NextResponse } from "next/server";
import { getRepository } from "@/lib/data";
import { fetchDeckCards, identifierKey } from "@/lib/deck/scryfall";
import type { CardIdentifier } from "@/lib/deck/types";
import { normalizeName } from "@/lib/normalize";

/** Como mucho por petición: un mazo de Commander con fichas y algo de margen */
const MAX_IDENTIFIERS = 250;

function isIdentifier(value: unknown): value is CardIdentifier {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id === "string") return /^[0-9a-f-]{36}$/i.test(v.id);
  if (typeof v.set === "string" && typeof v.collector_number === "string") return v.set.length <= 8 && v.collector_number.length <= 12;
  return typeof v.name === "string" && v.name.length > 0 && v.name.length <= 150;
}

/**
 * POST /api/mazo/cartas { identifiers: [{ id } | { set, collector_number } | { name }] }
 * → { cards: [{ key, card }], notFound: [key] }
 * Los nombres que Scryfall no reconoce (p. ej. en español) se buscan antes en nuestro catálogo.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON no válido" }, { status: 400 });
  }
  const identifiers = (body as { identifiers?: unknown })?.identifiers;
  if (!Array.isArray(identifiers) || identifiers.length === 0 || identifiers.length > MAX_IDENTIFIERS || !identifiers.every(isIdentifier)) {
    return NextResponse.json({ error: `Hacen falta entre 1 y ${MAX_IDENTIFIERS} cartas` }, { status: 400 });
  }

  try {
    const first = await fetchDeckCards(identifiers);
    // Nombres no encontrados: puede que estén en español; nuestro catálogo da el nombre en inglés
    const retry: Array<{ original: string; english: CardIdentifier }> = [];
    const missingNames = identifiers.filter((id): id is { name: string } => "name" in id && first.notFound.includes(identifierKey(id)));
    if (missingNames.length > 0) {
      const repo = await getRepository();
      for (const { name } of missingNames) {
        const [hit] = await repo.autocomplete(name, 1);
        if (hit && normalizeName(hit.matchedName) === normalizeName(name)) retry.push({ original: identifierKey({ name }), english: { name: hit.nameEn } });
      }
    }
    if (retry.length === 0) return NextResponse.json(first);
    const second = await fetchDeckCards(retry.map((r) => r.english));
    const recovered = new Map(second.cards.map((c) => [c.key, c.card]));
    const cards = [...first.cards];
    const notFound = first.notFound.filter((key) => {
      const r = retry.find((x) => x.original === key);
      const card = r ? recovered.get(identifierKey(r.english)) : undefined;
      if (card) cards.push({ key, card });
      return !card;
    });
    return NextResponse.json({ cards, notFound });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error al pedir las cartas a Scryfall" }, { status: 502 });
  }
}
