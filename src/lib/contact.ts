/** Página pública del proyecto: el contacto por defecto si no se define SEARCH_MAGIC_CONTACT. */
export const DEFAULT_CONTACT = "https://github.com/RobertoNobleMaestro/search-magic";

/**
 * Contacto que va en el User-Agent hacia Scryfall, MTGJSON y las tiendas, y en la web:
 * SEARCH_MAGIC_CONTACT (un correo o una URL) o, si no está, la página del repositorio.
 */
export function projectContact(value: string | undefined = process.env.SEARCH_MAGIC_CONTACT): string {
  return value?.trim() || DEFAULT_CONTACT;
}
