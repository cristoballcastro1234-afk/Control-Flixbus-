interface Env {
  DB: D1Database;
}

const DESTINOS = new Set(["stgo", "cur", "scrz"]);
const FECHA_PATTERN = /^\d{2}-\d{2}-\d{4}$/;
const UN_DIA_MS = 86400000;

// Cada tanto se aprovecha una lectura para purgar; el grueso de la limpieza ocurre
// en el POST. Se mantiene bajo porque el GET se ejecuta miles de veces al día.
const PROBABILIDAD_LIMPIEZA_EN_GET = 0.02;

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

// La fecha la calcula el navegador (hora local de Chile), mientras que el servidor
// corre en UTC. Se acepta un margen de 2 días para cubrir esa diferencia, pero se
// rechaza cualquier fecha muy lejana: así un dispositivo con la hora mal configurada
// no puede borrar los datos del día en curso.
function fechaEsRazonable(fecha: string): boolean {
  const [dia, mes, anio] = fecha.split("-").map(Number);
  const marca = Date.UTC(anio, mes - 1, dia);
  if (!Number.isFinite(marca)) return false;
  return Math.abs(marca - Date.now()) <= 2 * UN_DIA_MS;
}

// Solo se conserva el día en curso: al escribir (o de vez en cuando al leer) se
// eliminan los registros de cualquier otra fecha.
async function purgarOtrosDias(env: Env, fecha: string): Promise<void> {
  await env.DB.prepare("DELETE FROM turnos WHERE fecha <> ?").bind(fecha).run();
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const fecha = new URL(context.request.url).searchParams.get("fecha") || "";
  if (!FECHA_PATTERN.test(fecha)) return json({ error: "Fecha inválida" }, 400);
  if (!fechaEsRazonable(fecha)) {
    return json({ error: "La fecha del dispositivo no coincide con la fecha real. Revisa la hora del equipo." }, 400);
  }

  const { results } = await context.env.DB
    .prepare(
      `SELECT fecha, destino, slot_index as slotIndex, hora_plan as horaPlan,
              bus_num as busNum, hora_llegada as horaLlegada, hora_real as horaReal, cancelado, eliminado, updated_at as updatedAt
       FROM turnos WHERE fecha = ?`
    )
    .bind(fecha)
    .all();

  if (Math.random() < PROBABILIDAD_LIMPIEZA_EN_GET) {
    await purgarOtrosDias(context.env, fecha);
  }

  const registros = (results || []).map((r: any) => ({ ...r, cancelado: !!r.cancelado, eliminado: !!r.eliminado }));
  return json(registros);
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const payload = await context.request.json<Record<string, unknown>>();

  const fecha = String(payload.fecha || "");
  const destino = String(payload.destino || "");
  const slotIndex = Number(payload.slotIndex);
  const horaPlan = String(payload.horaPlan || "");
  const busNum = String(payload.busNum || "").slice(0, 30);
  const horaLlegada = String(payload.horaLlegada || "").slice(0, 5);
  const horaReal = String(payload.horaReal || "").slice(0, 5);
  const cancelado = Boolean(payload.cancelado);
  const eliminado = Boolean(payload.eliminado);

  if (
    !FECHA_PATTERN.test(fecha) ||
    !DESTINOS.has(destino) ||
    !Number.isInteger(slotIndex) ||
    slotIndex < 0 ||
    !horaPlan
  ) {
    return json({ error: "Datos de turno inválidos" }, 400);
  }

  if (!fechaEsRazonable(fecha)) {
    return json({ error: "La fecha del dispositivo no coincide con la fecha real. Revisa la hora del equipo." }, 400);
  }

  const updatedAt = new Date().toISOString();

  await context.env.DB
    .prepare(
      `INSERT INTO turnos (fecha, destino, slot_index, hora_plan, bus_num, hora_llegada, hora_real, cancelado, eliminado, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(fecha, destino, slot_index) DO UPDATE SET
         hora_plan = excluded.hora_plan,
         bus_num = excluded.bus_num,
         hora_llegada = excluded.hora_llegada,
         hora_real = excluded.hora_real,
         cancelado = excluded.cancelado,
         eliminado = excluded.eliminado,
         updated_at = excluded.updated_at`
    )
    .bind(fecha, destino, slotIndex, horaPlan, busNum, horaLlegada, horaReal, cancelado ? 1 : 0, eliminado ? 1 : 0, updatedAt)
    .run();

  await purgarOtrosDias(context.env, fecha);

  return json({ fecha, destino, slotIndex, horaPlan, busNum, horaLlegada, horaReal, cancelado, eliminado, updatedAt });
};
