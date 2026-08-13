interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
}

export interface Sesion {
  usuario: string;
  rol: string;
}

// Cloudflare limita PBKDF2 a 100.000 iteraciones y el plan gratuito da 10ms de CPU
// por petición. 25.000 iteraciones ≈ 4ms, dejando margen para el resto del pedido:
// si se pasara del límite, el login fallaría. El número queda guardado dentro del
// hash, así que en un plan pago se puede subir sin invalidar las claves existentes.
const PBKDF2_ITERACIONES = 25000;
const DURACION_SESION_SEG = 24 * 60 * 60;
const MIN_LARGO_PASSWORD = 10;
const MAX_INTENTOS = 5;
const BLOQUEO_MINUTOS = 15;
const USUARIO_PATTERN = /^[a-z0-9._-]{3,30}$/;

const enc = new TextEncoder();

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

// ---------- utilidades base64url ----------

function aBase64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function desdeBase64Url(texto: string): Uint8Array {
  const base64 = texto.replace(/-/g, "+").replace(/_/g, "/");
  const relleno = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binario = atob(relleno);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

// Compara sin cortar antes de tiempo, para no filtrar información por el tiempo de respuesta.
function comparacionSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

// ---------- hash de contraseñas ----------

async function derivar(password: string, salt: Uint8Array, iteraciones: number): Promise<Uint8Array> {
  const clave = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: iteraciones, hash: "SHA-256" },
    clave,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivar(password, salt, PBKDF2_ITERACIONES);
  return `pbkdf2$${PBKDF2_ITERACIONES}$${aBase64Url(salt)}$${aBase64Url(hash)}`;
}

export async function verificarPassword(password: string, almacenado: string): Promise<boolean> {
  const partes = almacenado.split("$");
  if (partes.length !== 4 || partes[0] !== "pbkdf2") return false;
  const iteraciones = Number(partes[1]);
  if (!Number.isInteger(iteraciones) || iteraciones < 1000 || iteraciones > 100000) return false;
  const hash = await derivar(password, desdeBase64Url(partes[2]), iteraciones);
  return comparacionSegura(aBase64Url(hash), partes[3]);
}

// ---------- token de sesión (firmado con HMAC, no se guarda en la base) ----------

function claveHmac(secreto: string) {
  return crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export async function crearToken(secreto: string, sesion: Sesion): Promise<string> {
  const payload = { u: sesion.usuario, r: sesion.rol, exp: Math.floor(Date.now() / 1000) + DURACION_SESION_SEG };
  const cuerpo = aBase64Url(enc.encode(JSON.stringify(payload)));
  const firma = await crypto.subtle.sign("HMAC", await claveHmac(secreto), enc.encode(cuerpo));
  return cuerpo + "." + aBase64Url(new Uint8Array(firma));
}

export async function verificarToken(secreto: string, token: string): Promise<Sesion | null> {
  if (!secreto || !token) return null;
  const partes = token.split(".");
  if (partes.length !== 2) return null;
  const [cuerpo, firma] = partes;

  const esperada = await crypto.subtle.sign("HMAC", await claveHmac(secreto), enc.encode(cuerpo));
  if (!comparacionSegura(aBase64Url(new Uint8Array(esperada)), firma)) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(desdeBase64Url(cuerpo)));
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) return null;
    if (typeof payload.u !== "string" || typeof payload.r !== "string") return null;
    return { usuario: payload.u, rol: payload.r };
  } catch {
    return null;
  }
}

export function leerCookieSesion(request: Request): string {
  const cookie = request.headers.get("Cookie") || "";
  const encontrado = cookie.match(/(?:^|;\s*)sesion=([^;]+)/);
  return encontrado ? encontrado[1] : "";
}

function cookieSesion(token: string, maxAgeSeg: number): string {
  return `sesion=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeg}`;
}

// ---------- helpers de datos ----------

async function contarUsuarios(env: Env): Promise<number> {
  const fila = await env.DB.prepare("SELECT COUNT(*) as total FROM usuarios").first<{ total: number }>();
  return fila?.total ?? 0;
}

async function contarAdmins(env: Env): Promise<number> {
  const fila = await env.DB
    .prepare("SELECT COUNT(*) as total FROM usuarios WHERE rol = 'admin' AND activo = 1")
    .first<{ total: number }>();
  return fila?.total ?? 0;
}

function normalizarUsuario(valor: unknown): string {
  return String(valor || "").trim().toLowerCase();
}

function validarPassword(password: string): string | null {
  if (password.length < MIN_LARGO_PASSWORD) {
    return `La contraseña debe tener al menos ${MIN_LARGO_PASSWORD} caracteres`;
  }
  if (password.length > 200) return "La contraseña es demasiado larga";
  return null;
}

// ---------- GET: estado de la sesión / listado de usuarios ----------

export const onRequestGet: PagesFunction<Env, string, { sesion: Sesion | null }> = async (context) => {
  const accion = new URL(context.request.url).searchParams.get("accion") || "estado";
  const sesion = context.data.sesion;

  if (accion === "estado") {
    return json({
      configurado: (await contarUsuarios(context.env)) > 0,
      sesion: sesion,
    });
  }

  if (accion === "listar") {
    if (!sesion || sesion.rol !== "admin") return json({ error: "Sin permiso" }, 403);
    const { results } = await context.env.DB
      .prepare("SELECT usuario, nombre, rol, activo, creado_en as creadoEn FROM usuarios ORDER BY usuario")
      .all();
    return json((results || []).map((u: any) => ({ ...u, activo: !!u.activo })));
  }

  return json({ error: "Acción desconocida" }, 400);
};

// ---------- POST: login, logout, alta y administración de usuarios ----------

export const onRequestPost: PagesFunction<Env, string, { sesion: Sesion | null }> = async (context) => {
  const secreto = context.env.SESSION_SECRET || "";
  if (!secreto) return json({ error: "Falta configurar SESSION_SECRET en Cloudflare" }, 500);

  let payload: Record<string, unknown>;
  try {
    payload = await context.request.json<Record<string, unknown>>();
  } catch {
    return json({ error: "Petición inválida" }, 400);
  }

  const accion = String(payload.accion || "");
  const sesion = context.data.sesion;

  // --- Primer administrador: solo funciona mientras no exista ningún usuario ---
  if (accion === "setup") {
    if ((await contarUsuarios(context.env)) > 0) {
      return json({ error: "El sistema ya tiene usuarios creados" }, 403);
    }
    const usuario = normalizarUsuario(payload.usuario);
    const password = String(payload.password || "");
    if (!USUARIO_PATTERN.test(usuario)) {
      return json({ error: "Usuario inválido (3 a 30 caracteres: letras, números, punto, guion)" }, 400);
    }
    const errorPassword = validarPassword(password);
    if (errorPassword) return json({ error: errorPassword }, 400);

    await context.env.DB
      .prepare(
        `INSERT INTO usuarios (usuario, nombre, password_hash, rol, activo, creado_en)
         VALUES (?, ?, ?, 'admin', 1, ?)`,
      )
      .bind(usuario, String(payload.nombre || usuario).slice(0, 60), await hashPassword(password), new Date().toISOString())
      .run();

    const token = await crearToken(secreto, { usuario, rol: "admin" });
    return json({ ok: true, sesion: { usuario, rol: "admin" } }, 200, {
      "Set-Cookie": cookieSesion(token, DURACION_SESION_SEG),
    });
  }

  // --- Iniciar sesión ---
  if (accion === "login") {
    const usuario = normalizarUsuario(payload.usuario);
    const password = String(payload.password || "");

    const fila = await context.env.DB
      .prepare("SELECT usuario, nombre, password_hash as passwordHash, rol, activo, intentos_fallidos as intentos, bloqueado_hasta as bloqueadoHasta FROM usuarios WHERE usuario = ?")
      .bind(usuario)
      .first<any>();

    // Si el usuario no existe igual se hace un hash descartable, para que la respuesta
    // demore lo mismo y no se pueda averiguar qué usuarios existen midiendo el tiempo.
    if (!fila) {
      await derivar(password, new Uint8Array(16), PBKDF2_ITERACIONES);
      return json({ error: "Usuario o contraseña incorrectos" }, 401);
    }

    if (!fila.activo) return json({ error: "Este usuario está desactivado" }, 403);

    if (fila.bloqueadoHasta && new Date(fila.bloqueadoHasta).getTime() > Date.now()) {
      return json({ error: `Demasiados intentos fallidos. Espera ${BLOQUEO_MINUTOS} minutos.` }, 429);
    }

    if (!(await verificarPassword(password, fila.passwordHash))) {
      const intentos = Number(fila.intentos || 0) + 1;
      const bloqueadoHasta =
        intentos >= MAX_INTENTOS ? new Date(Date.now() + BLOQUEO_MINUTOS * 60000).toISOString() : "";
      await context.env.DB
        .prepare("UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = ? WHERE usuario = ?")
        .bind(intentos >= MAX_INTENTOS ? 0 : intentos, bloqueadoHasta, usuario)
        .run();
      return json({ error: "Usuario o contraseña incorrectos" }, 401);
    }

    if (Number(fila.intentos || 0) !== 0 || fila.bloqueadoHasta) {
      await context.env.DB
        .prepare("UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = '' WHERE usuario = ?")
        .bind(usuario)
        .run();
    }

    const token = await crearToken(secreto, { usuario: fila.usuario, rol: fila.rol });
    return json({ ok: true, sesion: { usuario: fila.usuario, rol: fila.rol, nombre: fila.nombre } }, 200, {
      "Set-Cookie": cookieSesion(token, DURACION_SESION_SEG),
    });
  }

  // --- Cerrar sesión ---
  if (accion === "logout") {
    return json({ ok: true }, 200, { "Set-Cookie": cookieSesion("", 0) });
  }

  // De aquí en adelante hay que estar autenticado.
  if (!sesion) return json({ error: "No autenticado" }, 401);

  // --- Cambiar la propia contraseña ---
  if (accion === "cambiar-clave") {
    const actual = String(payload.actual || "");
    const nueva = String(payload.nueva || "");
    const errorPassword = validarPassword(nueva);
    if (errorPassword) return json({ error: errorPassword }, 400);

    const fila = await context.env.DB
      .prepare("SELECT password_hash as passwordHash FROM usuarios WHERE usuario = ?")
      .bind(sesion.usuario)
      .first<any>();
    if (!fila || !(await verificarPassword(actual, fila.passwordHash))) {
      return json({ error: "La contraseña actual no es correcta" }, 401);
    }

    await context.env.DB
      .prepare("UPDATE usuarios SET password_hash = ? WHERE usuario = ?")
      .bind(await hashPassword(nueva), sesion.usuario)
      .run();
    return json({ ok: true });
  }

  // De aquí en adelante solo administradores.
  if (sesion.rol !== "admin") return json({ error: "Sin permiso" }, 403);

  if (accion === "crear-usuario") {
    const usuario = normalizarUsuario(payload.usuario);
    const password = String(payload.password || "");
    const rol = String(payload.rol || "operador") === "admin" ? "admin" : "operador";
    if (!USUARIO_PATTERN.test(usuario)) {
      return json({ error: "Usuario inválido (3 a 30 caracteres: letras, números, punto, guion)" }, 400);
    }
    const errorPassword = validarPassword(password);
    if (errorPassword) return json({ error: errorPassword }, 400);

    const existe = await context.env.DB
      .prepare("SELECT usuario FROM usuarios WHERE usuario = ?")
      .bind(usuario)
      .first();
    if (existe) return json({ error: "Ese usuario ya existe" }, 409);

    await context.env.DB
      .prepare(
        `INSERT INTO usuarios (usuario, nombre, password_hash, rol, activo, creado_en)
         VALUES (?, ?, ?, ?, 1, ?)`,
      )
      .bind(usuario, String(payload.nombre || usuario).slice(0, 60), await hashPassword(password), rol, new Date().toISOString())
      .run();
    return json({ ok: true });
  }

  if (accion === "resetear-clave") {
    const usuario = normalizarUsuario(payload.usuario);
    const password = String(payload.password || "");
    const errorPassword = validarPassword(password);
    if (errorPassword) return json({ error: errorPassword }, 400);

    const resultado = await context.env.DB
      .prepare("UPDATE usuarios SET password_hash = ?, intentos_fallidos = 0, bloqueado_hasta = '' WHERE usuario = ?")
      .bind(await hashPassword(password), usuario)
      .run();
    if (!resultado.meta.changes) return json({ error: "Ese usuario no existe" }, 404);
    return json({ ok: true });
  }

  if (accion === "eliminar-usuario") {
    const usuario = normalizarUsuario(payload.usuario);
    if (usuario === sesion.usuario) return json({ error: "No puedes eliminar tu propio usuario" }, 400);

    const fila = await context.env.DB
      .prepare("SELECT rol FROM usuarios WHERE usuario = ?")
      .bind(usuario)
      .first<any>();
    if (!fila) return json({ error: "Ese usuario no existe" }, 404);
    if (fila.rol === "admin" && (await contarAdmins(context.env)) <= 1) {
      return json({ error: "Debe quedar al menos un administrador" }, 400);
    }

    await context.env.DB.prepare("DELETE FROM usuarios WHERE usuario = ?").bind(usuario).run();
    return json({ ok: true });
  }

  return json({ error: "Acción desconocida" }, 400);
};
