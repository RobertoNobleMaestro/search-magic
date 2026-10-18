import { RobotsTxtFile } from "crawlee";
import { errorMessage } from "./text";

/** Nombre con el que nos pueden buscar los robots.txt ("User-agent: search-magic") */
export const ROBOTS_AGENT = "search-magic";

export type RobotsResult =
  | { ok: true; robots: RobotsTxtFile; crawlDelaySecs?: number }
  | { ok: false; error: string };

/**
 * Descarga el robots.txt de la tienda con nuestro User-Agent. Como dice RFC 9309: si no existe (4xx),
 * no hay restricciones; si el servidor falla (5xx, 429 o error de red), no se rastrea, porque no
 * sabemos qué permite.
 */
export async function fetchRobots(website: string, userAgent: string, timeoutMs: number): Promise<RobotsResult> {
  const url = new URL("/robots.txt", website).href;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "user-agent": userAgent, accept: "text/plain,*/*;q=0.8" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, error: `no se ha podido descargar ${url} (${errorMessage(error)})` };
  }
  if (response.status === 429 || response.status >= 500) {
    await response.body?.cancel();
    return { ok: false, error: `${url} responde ${response.status}; sin robots.txt no se rastrea` };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return { ok: true, robots: RobotsTxtFile.from(url, "") };
  }
  const content = await response.text();
  return { ok: true, robots: RobotsTxtFile.from(url, content), crawlDelaySecs: crawlDelaySecs(content) };
}

/**
 * Crawl-delay (segundos) del grupo que nos toca: el de "search-magic" o, si no hay, el de "*".
 * No es estándar, pero si una tienda pide que vayamos más despacio, se le hace caso.
 */
export function crawlDelaySecs(content: string, agent = ROBOTS_AGENT): number | undefined {
  const groups: Array<{ agents: string[]; delay?: number }> = [];
  let readingAgents = false;
  for (const raw of content.split(/\r?\n/)) {
    const match = /^\s*([a-z-]+)\s*:\s*(.*?)\s*$/i.exec(raw.replace(/#.*/, ""));
    if (!match) continue;
    const [, field = "", value = ""] = match;
    const key = field.toLowerCase();
    if (key === "user-agent") {
      // varias líneas User-agent seguidas comparten grupo
      if (!readingAgents) groups.push({ agents: [] });
      groups.at(-1)!.agents.push(value.toLowerCase().split("/")[0]!.trim());
      readingAgents = true;
      continue;
    }
    readingAgents = false;
    const delay = Number(value);
    const group = groups.at(-1);
    if (key === "crawl-delay" && group && Number.isFinite(delay) && delay > 0) group.delay = delay;
  }
  const find = (name: string) => groups.find((g) => g.agents.includes(name));
  return (find(agent.toLowerCase()) ?? find("*"))?.delay;
}
