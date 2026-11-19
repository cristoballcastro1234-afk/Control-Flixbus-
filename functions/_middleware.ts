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

  // Consulta la cuenta en cada solicitud: desactivar o eliminar revoca la sesión.
  // Cambiar la contraseña no altera el identificador de la cuenta.
  if (context.data.sesion) {
    const s=context.data.sesion;
    const cuenta=await context.env.DB.prepare("SELECT rol,activo,creado_en AS creadoEn,sesion_version AS sessionVersion FROM usuarios WHERE usuario=?").bind(s.usuario).first<{rol:string;activo:number;creadoEn:string;sessionVersion:number}>();
    context.data.sesion=cuenta?.activo && cuenta.creadoEn+":"+cuenta.sessionVersion===s.cuenta ? {...s,rol:cuenta.rol} : null;
  }
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
