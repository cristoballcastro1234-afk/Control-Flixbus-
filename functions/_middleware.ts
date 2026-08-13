import { leerCookieSesion, verificarToken, type Sesion } from "./api/auth";

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
}

// Rutas accesibles sin haber iniciado sesión: la pantalla de acceso y la API que
// la atiende. Todo lo demás (incluida la página principal y /api/turnos) exige sesión.
// Cloudflare Pages redirige /login.html a /login, así que ambas deben ser públicas:
// si solo se permitiera una, se produciría un bucle infinito de redirecciones.
const RUTAS_PUBLICAS = new Set(["/login", "/login.html", "/favicon.ico"]);

export const onRequest: PagesFunction<Env, string, { sesion: Sesion | null }> = async (context) => {
  const url = new URL(context.request.url);
  const ruta = url.pathname;
  const secreto = context.env.SESSION_SECRET || "";

  // La sesión se resuelve siempre para que las funciones siguientes puedan usarla,
  // aunque la ruta sea pública.
  context.data.sesion = secreto ? await verificarToken(secreto, leerCookieSesion(context.request)) : null;

  if (RUTAS_PUBLICAS.has(ruta) || ruta === "/api/auth") {
    return context.next();
  }

  // Sin secreto configurado no se puede validar nada: se bloquea en vez de dejar pasar.
  if (!secreto) {
    return new Response(
      "Falta configurar la variable SESSION_SECRET en Cloudflare (Settings → Variables and Secrets).",
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  if (!context.data.sesion) {
    if (ruta.startsWith("/api/")) {
      return Response.json({ error: "No autenticado" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    return Response.redirect(new URL("/login", url).toString(), 302);
  }

  return context.next();
};
