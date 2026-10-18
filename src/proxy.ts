import { NextResponse, type NextRequest } from "next/server";

/**
 * Protege /admin con HTTP Basic cuando hay ADMIN_PASSWORD (el usuario da igual).
 * Sin la variable (desarrollo local) se deja pasar y el panel muestra un aviso.
 */
export function proxy(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return NextResponse.next();

  if (safeEqual(basicPassword(request.headers.get("authorization")) ?? "", password)) {
    return NextResponse.next();
  }
  return new NextResponse("Hace falta contraseña para entrar en el panel.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="search-magic admin", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};

/** Contraseña de una cabecera "Basic base64(usuario:contraseña)", o null */
function basicPassword(header: string | null): string | null {
  if (!header?.startsWith("Basic ")) return null;
  try {
    const bytes = Uint8Array.from(atob(header.slice(6).trim()), (c) => c.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    const colon = decoded.indexOf(":");
    return colon === -1 ? null : decoded.slice(colon + 1);
  } catch {
    return null;
  }
}

/** Comparación en tiempo constante, para no dar pistas de la contraseña por el tiempo de respuesta */
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
