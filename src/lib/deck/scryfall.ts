import { projectContact } from "@/lib/contact";
import { normalizeName } from "@/lib/normalize";
import { identifierKey } from "./manabox";
import type { CardIdentifier, Color, DeckCard } from "./types";

export { identifierKey };

/**
 * Datos de cartas para los mazos, pedidos a la API de Scryfall desde el servidor.
 * - /cards/collection: hasta 75 cartas por petición (por id, por edición y número o por nombre).
 * - La impresión en español (nombre e imagen): una búsqueda "lang:es" por cada 15 cartas.
 * Scryfall pide un User-Agent identificado y no más de unas 10 peticiones por segundo; aquí
 * van con 150 ms de separación y, si responde 429, se espera y se reintenta.
 */

const API = "https://api.scryfall.com";
const DELAY_MS = 150;
const COLLECTION_BATCH = 75;
/** Scryfall no admite más de 20 condiciones anidadas por búsqueda (con 15 cartas por lote va bien) */
const SPANISH_BATCH = 15;
const CACHE_MS = 12 * 60 * 60 * 1000;

interface ScryfallFace {
  name: string;
  printed_name?: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  colors?: Color[];
  image_uris?: { normal?: string };
}

interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  printed_name?: string;
  lang: string;
  set: string;
  collector_number: string;
  layout: string;
  type_line: string;
  mana_cost?: string;
  cmc: number;
  colors?: Color[];
  color_identity: Color[];
  oracle_text?: string;
  keywords?: string[];
  image_uris?: { normal?: string };
  card_faces?: ScryfallFace[];
  prices?: { eur?: string | null; eur_foil?: string | null };
  legalities?: Record<string, string>;
  edhrec_rank?: number;
}

const cache = new Map<string, { card: DeckCard; at: number }>();
let lastRequest = 0;

async function scryfall(path: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequest + DELAY_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "User-Agent": `search-magic/0.1 (+${projectContact()})`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      cache: "no-store",
    });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get("retry-after")) || 2 ** attempt) * 1000));
      continue;
    }
    return res;
  }
}

function cents(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function imageOf(card: Pick<ScryfallCard, "image_uris" | "card_faces">): string | null {
  return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? null;
}

function joinFaces(card: ScryfallCard, field: "oracle_text" | "mana_cost"): string {
  const own = card[field];
  if (own) return own;
  return (card.card_faces ?? []).map((f) => f[field] ?? "").filter(Boolean).join(" // ");
}

export function toDeckCard(c: ScryfallCard): DeckCard {
  const colors = c.colors ?? [...new Set((c.card_faces ?? []).flatMap((f) => f.colors ?? []))];
  return {
    scryfallId: c.id,
    oracleId: c.oracle_id ?? c.card_faces?.map((f) => f.name).join("|") ?? c.id,
    name: c.name,
    nameEs: null,
    setCode: c.set,
    collectorNumber: c.collector_number,
    typeLine: c.type_line,
    manaCost: joinFaces(c, "mana_cost"),
    cmc: c.cmc,
    colors,
    colorIdentity: c.color_identity,
    oracleText: joinFaces(c, "oracle_text"),
    keywords: c.keywords ?? [],
    imageUrl: imageOf(c),
    imageUrlEs: null,
    priceEurCents: cents(c.prices?.eur) ?? cents(c.prices?.eur_foil),
    legalCommander: c.legalities?.commander === "legal",
    isToken: c.layout === "token" || c.layout === "double_faced_token" || /\bToken\b/.test(c.type_line),
    edhrecRank: c.edhrec_rank ?? null,
  };
}

function keysOf(card: DeckCard): string[] {
  const names = [card.name, ...card.name.split(" // ")];
  return [
    `id:${card.scryfallId}`,
    `set:${card.setCode}:${card.collectorNumber}`,
    ...names.map((n) => `name:${normalizeName(n)}`),
  ];
}

/** Cartas por identificador (en lotes de 75), con caché por Scryfall ID */
async function fetchCollection(identifiers: CardIdentifier[]): Promise<DeckCard[]> {
  const out: DeckCard[] = [];
  const pending: CardIdentifier[] = [];
  for (const id of identifiers) {
    const hit = "id" in id ? cache.get(id.id.toLowerCase()) : undefined;
    if (hit && Date.now() - hit.at < CACHE_MS) out.push(hit.card);
    else pending.push(id);
  }
  for (let i = 0; i < pending.length; i += COLLECTION_BATCH) {
    const res = await scryfall("/cards/collection", {
      method: "POST",
      body: JSON.stringify({ identifiers: pending.slice(i, i + COLLECTION_BATCH) }),
    });
    if (!res.ok) throw new Error(`Scryfall respondió ${res.status} a /cards/collection`);
    const data = (await res.json()) as { data: ScryfallCard[] };
    out.push(...data.data.map(toDeckCard));
  }
  return out;
}

/** Nombre e imagen en español para las cartas que tienen esa impresión en Scryfall */
async function addSpanish(cards: DeckCard[]): Promise<void> {
  const wanted = cards.filter((c) => c.nameEs == null && !c.isToken);
  for (let i = 0; i < wanted.length; i += SPANISH_BATCH) {
    const batch = wanted.slice(i, i + SPANISH_BATCH);
    const query = `lang:es (${batch.map((c) => `(set:${c.setCode} cn:"${c.collectorNumber}")`).join(" or ")})`;
    let url: string | null = `/cards/search?unique=prints&q=${encodeURIComponent(query)}`;
    while (url) {
      const res = await scryfall(url);
      if (res.status === 404) break; // ninguna tiene impresión en español
      if (!res.ok) throw new Error(`Scryfall respondió ${res.status} a la búsqueda en español`);
      const page = (await res.json()) as { data: ScryfallCard[]; has_more: boolean; next_page?: string };
      for (const es of page.data) {
        const target = batch.find((c) => c.setCode === es.set && c.collectorNumber === es.collector_number);
        if (!target) continue;
        target.nameEs = es.printed_name ?? (es.card_faces?.every((f) => f.printed_name) ? es.card_faces.map((f) => f.printed_name).join(" // ") : null);
        target.imageUrlEs = imageOf(es);
      }
      url = page.has_more && page.next_page ? page.next_page.replace(API, "") : null;
    }
  }
}

/**
 * Cartas de Scryfall para los identificadores pedidos, cada una con su clave (identifierKey).
 * Devuelve también las claves que no se han encontrado.
 */
export async function fetchDeckCards(identifiers: CardIdentifier[]): Promise<{ cards: Array<{ key: string; card: DeckCard }>; notFound: string[] }> {
  const cards = await fetchCollection(identifiers);
  await addSpanish(cards.filter((c) => !cache.has(c.scryfallId)));
  for (const card of cards) if (!cache.has(card.scryfallId)) cache.set(card.scryfallId, { card, at: Date.now() });

  const byKey = new Map<string, DeckCard>();
  for (const card of cards) for (const key of keysOf(card)) if (!byKey.has(key)) byKey.set(key, card);
  const found: Array<{ key: string; card: DeckCard }> = [];
  const notFound: string[] = [];
  for (const id of identifiers) {
    const key = identifierKey(id);
    const card = byKey.get(key);
    if (card) found.push({ key, card });
    else notFound.push(key);
  }
  return { cards: found, notFound };
}
