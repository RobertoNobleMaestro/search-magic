import { decodeText } from "./encoding";
import { retryDelayMs, sleep, type Throttle } from "./crawl";
import { errorMessage } from "./text";

/**
 * Descargas sueltas fuera de Crawlee (un CSV publicado, un sitemap…), con las mismas reglas de
 * educación: nuestro User-Agent, reintentos con espera exponencial solo en 408/429/5xx o errores de
 * red, y nada de cabeceras de navegador. Para pedir algo a la web de una tienda que se está
 * rastreando, pasa su ctx.throttle: así respeta la misma separación entre peticiones.
 */

export interface FetchTextOptions {
  userAgent: string;
  timeoutMs: number;
  accept?: string;
  /** reintentos además del primer intento (por defecto 2) */
  retries?: number;
  /** espera antes del primer reintento, en ms; se dobla en cada uno */
  backoffMs?: number;
  /** codificación si no es UTF-8; un BOM manda sobre ella */
  encoding?: string;
  /** tope de tamaño de la respuesta (por defecto 50 MB) */
  maxBytes?: number;
  /** turno de peticiones del dominio; se espera antes de cada intento */
  throttle?: Throttle;
}

export interface FetchTextResult {
  url: string;
  status: number;
  contentType: string | null;
  /** cabecera Last-Modified, si la hay */
  lastModified: string | null;
  text: string;
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

/** Cardmarket sirve un reto de Cloudflare a cualquier robot: nunca se le hacen peticiones automáticas. */
export function isCardmarketUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const host = new URL(url).hostname.toLowerCase();
  return host === "cardmarket.com" || host.endsWith(".cardmarket.com");
}

class HttpError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfter?: string,
  ) {
    super(message);
  }
}

/** GET con reintentos; lanza un error si la respuesta final no es 2xx. */
export async function fetchText(url: string, options: FetchTextOptions): Promise<FetchTextResult> {
  if (isCardmarketUrl(url)) throw new Error(`no se hacen peticiones automáticas a Cardmarket (${url})`);
  const { retries = 2, backoffMs = 2_000, maxBytes = DEFAULT_MAX_BYTES } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      await options.throttle?.wait();
      return await fetchOnce(url, options, maxBytes);
    } catch (error) {
      const retryable = error instanceof HttpError ? error.retryable : true;
      if (!retryable || attempt >= retries) throw error;
      const retryAfter = error instanceof HttpError ? error.retryAfter : undefined;
      const wait = retryDelayMs(attempt, backoffMs, retryAfter);
      // Retry-After de más de un minuto: no se insiste, que lo intente la siguiente ejecución
      if (wait === null) throw error;
      await sleep(wait);
    }
  }
}

async function fetchOnce(url: string, options: FetchTextOptions, maxBytes: number): Promise<FetchTextResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "user-agent": options.userAgent, accept: options.accept ?? "*/*", "accept-language": "es,en;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    throw new Error(`no se ha podido descargar ${url} (${errorMessage(error)})`);
  }
  if (isCardmarketUrl(response.url)) {
    await response.body?.cancel();
    throw new HttpError(`${url} redirige a Cardmarket; no se descarga`, false);
  }
  if (!response.ok) {
    await response.body?.cancel();
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new HttpError(`HTTP ${response.status} en ${url}`, retryable, response.headers.get("retry-after") ?? undefined);
  }
  const length = Number(response.headers.get("content-length"));
  if (length > maxBytes) {
    await response.body?.cancel();
    throw new HttpError(`${url} ocupa ${length} bytes, más del tope de ${maxBytes}`, false);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new HttpError(`${url} ocupa más del tope de ${maxBytes} bytes`, false);
  return {
    url: response.url || url,
    status: response.status,
    contentType: response.headers.get("content-type"),
    lastModified: response.headers.get("last-modified"),
    text: decodeText(bytes, options.encoding ?? charsetOf(response.headers.get("content-type"))),
  };
}

/** "text/csv; charset=ISO-8859-1" → "ISO-8859-1" */
export function charsetOf(contentType: string | null): string | undefined {
  return /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType ?? "")?.[1];
}
