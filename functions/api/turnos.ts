
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { turnos } from "../../schema";

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

// GET /api/turnos?fecha=DD-MM-AAAA
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const db = drizzle(context.env.DB, { schema: { turnos } });
  const fecha = new URL(context.request.url).searchParams.get("fecha") || "";

  if (!FECHA_PATTERN.test(fecha)) return json({ error: "Fecha inválida" }, 400);

  const registros = await db.select().from(turnos).where(eq(turnos.fecha, fecha));
  return json(registros);
};

// POST /api/turnos  (crea o actualiza un turno)
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const db = drizzle(context.env.DB, { schema: { turnos } });
  const payload = await context.request.json<Record<string, unknown>>();

  const fecha = String(payload.fecha || "");
  const destino = String(payload.destino || "");
  const slotIndex = Number(payload.slotIndex);
  const horaPlan = String(payload.horaPlan || "");
  const busNum = String(payload.busNum || "").slice(0, 30);
  const horaReal = String(payload.horaReal || "").slice(0, 5);
  const cancelado = Boolean(payload.cancelado);

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

  const [registro] = await db
    .insert(turnos)
    .values({ fecha, destino, slotIndex, horaPlan, busNum, horaReal, cancelado, updatedAt })
    .onConflictDoUpdate({
      target: [turnos.fecha, turnos.destino, turnos.slotIndex],
      set: { horaPlan, busNum, horaReal, cancelado, updatedAt },
    })
    .returning();

  return json(registro);
};
