interface Env {
  DB: D1Database;
}

const DESTINOS = new Set(["stgo", "cur", "scrz"]);
const FECHA_PATTERN = /^\d{2}-\d{2}-\d{4}$/;

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const fecha = new URL(context.request.url).searchParams.get("fecha") || "";
  if (!FECHA_PATTERN.test(fecha)) return json({ error: "Fecha inválida" }, 400);

  const { results } = await context.env.DB
    .prepare(
      `SELECT fecha, destino, slot_index as slotIndex, hora_plan as horaPlan,
              bus_num as busNum, hora_llegada as horaLlegada, hora_real as horaReal, cancelado, eliminado, updated_at as updatedAt
       FROM turnos WHERE fecha = ?`
    )
    .bind(fecha)
    .all();

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

  return json({ fecha, destino, slotIndex, horaPlan, busNum, horaLlegada, horaReal, cancelado, eliminado, updatedAt });
};
