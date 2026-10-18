import type { NormalizedListing } from "@/lib/data/types";
import { parseAttributes } from "../attributes";
import { parsePrice } from "../price";
import { absoluteUrl, documentBase, read, type HtmlParser } from "./html";
import { cleanText } from "./clean";

/**
 * Rebellion (rebellion.es/tiendarebel): PHP antiguo en ISO-8859-1, sin fichas de producto. Cada edición
 * es una tabla (verampliacion.php?idAmpl=<id>) con una fila por carta y, dentro, una subtabla con sus
 * variantes: bandera del idioma, estado ("Excelente", o "Foil" para las foil), precio y, en la columna
 * de al lado, el formulario de compra de cada una (sin formulario = sin stock).
 *
 * Selectores de stores.config.ts: `item` es la fila de cada carta y `title` su nombre en español;
 * `price`, `condition` y `language` se leen en cada fila de la subtabla de variantes.
 *
 * Limitación: la tabla pagina de 25 en 25 con la sesión PHP (cookie). Sin ella, ?idAmpl=<id>&pag=2
 * sale vacía, así que solo se leen las 25 primeras cartas de cada edición y el resto se anota como
 * páginas sin leer (ejecución parcial).
 */

const PAGE_SIZE = 25;

/** Una página de Rebellion: índice (sin tabla, solo enlaces a ediciones) o tabla de una edición */
export const parseRebellionPage: HtmlParser = ($, opts) => {
  const { selectors: sel, pageUrl } = opts;
  const listings: NormalizedListing[] = [];
  let skipped = 0;
  $(sel.item).each((_, element) => {
    const row = $(element);
    const link = row.find(sel.title.replace(/@[\w:-]+$/, "")).first();
    const nameEs = cleanText(read(row, sel.title));
    // el nombre en inglés va debajo, en letra pequeña
    const nameEn = cleanText(link.parent().find("font").first().text());
    const cardId = link.attr("id") ?? "";
    if (!nameEs || !cardId) {
      skipped++;
      return;
    }
    const rawTitle = nameEn && nameEn.toLowerCase() !== nameEs.toLowerCase() ? `${nameEs} / ${nameEn}` : nameEs;

    // "FRA0048" con la imagen .../realidadfracturada/0048.jpg → edición FRA, número 48
    const imageNumber = /\/(\d+[a-z]?)\.\w+$/i.exec(row.find("img[src*='/card/']").first().attr("src") ?? "")?.[1];
    const setCode = imageNumber && cardId.endsWith(imageNumber) ? cardId.slice(0, -imageNumber.length) : "";
    const setName = (row.find("img[title*=' - ']").first().attr("title") ?? "").split(" - ")[0]?.trim();
    const setHint = /^[A-Z0-9]{2,6}$/.test(setCode) ? setCode : setName;
    const collectorNumber = setHint === setCode && imageNumber ? imageNumber.replace(/^0+(?=\w)/, "") : undefined;

    // dos subtablas en celdas con rowspan: variantes y formularios de compra, fila a fila
    const [variantCell, formCell] = row.children("td[rowspan]").toArray();
    const forms = formCell ? $(formCell).find("tr").toArray() : [];
    $(variantCell ?? []).find("tr").each((i, tr) => {
      const variant = $(tr);
      const priceCents = parsePrice(read(variant, sel.price));
      if (!priceCents) {
        skipped++;
        return;
      }
      const form = forms[i] ? $(forms[i]).find("form").first() : undefined;
      const { attrs } = parseAttributes([
        { name: "language", value: sel.language && read(variant, sel.language) },
        // "Foil" sale en la columna del estado: sin nombre se prueban estado y acabado
        { value: sel.condition && read(variant, sel.condition) },
      ]);
      listings.push({
        storeId: opts.storeId,
        // formFRA0048_1_5 = carta, idioma y estado
        externalId: form?.attr("id")?.replace(/^form/, "") || `${cardId}_${i + 1}`,
        rawTitle,
        url: pageUrl,
        priceCents,
        currency: "EUR",
        inStock: Boolean(form?.length),
        ...attrs,
        ...(setHint ? { setHint } : {}),
        ...(collectorNumber ? { collectorNumber } : {}),
        kind: "single",
        scrapedAt: opts.scrapedAt,
      });
    });
  });

  // "1 - 25 de 290 resultados": las páginas 2 y siguientes necesitan la sesión PHP
  const total = Number(/de\s+(\d+)\s+resultados/i.exec($(".elementosMostrados").first().text())?.[1] ?? 0);
  const next = absoluteUrl($("a.pag_sig[href]").first().attr("href") ?? "", documentBase($, pageUrl));
  const unread =
    next && total > PAGE_SIZE
      ? [
          {
            url: pageUrl,
            error: `solo se leen las ${PAGE_SIZE} primeras cartas de ${total}: la paginación de Rebellion necesita su cookie de sesión`,
          },
        ]
      : undefined;
  return { listings, skipped, ...(unread ? { unread } : {}) };
};
