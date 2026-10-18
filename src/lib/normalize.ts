/**
 * Normalización de nombres de carta, compartida por toda la aplicación.
 *
 * La usan el emparejador (títulos de las tiendas) y la importación de Scryfall
 * (card_names.name_norm), así que si cambia hay que reimportar los nombres.
 *
 *   "Æther Vial"      → "aether vial"
 *   "Urza´s Saga"     → "urzas saga"
 *   "Fire // Ice"     → "fire ice"
 *   "Ángel de Serra"  → "angel de serra"
 */
export function normalizeName(input: string): string {
  return (
    input
      // apóstrofos fuera antes de NFKD: "´" se descompone en espacio + tilde
      .replace(/['’‘`´ʼ′]/g, "")
      // marcas de las tiendas ("The Hobbit™"): NFKD convertiría "™" en "TM" pegado a la palabra
      .replace(/[™®©℠]/g, " ")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/æ/g, "ae")
      .replace(/œ/g, "oe")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  );
}
