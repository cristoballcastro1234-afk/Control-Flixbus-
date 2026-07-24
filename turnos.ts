import type { Config } from "@netlify/functions";
import { and, eq } from "drizzle-orm";
import { database } from "../../db/index.js";
import { turnos } from "../../db/schema.js";

const DESTINOS = new Set(["stgo", "cur", "scrz"]);
const FECHA_PATTERN = /^\d{2}-\d{2}-\d{4}$/;

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export default async function handler(request: Request) {
  if (request.method === "GET") {
    const fecha = new URL(request.url).searchParams.get("fecha") || "";
    if (!FECHA_PATTERN.test(fecha)) return json({ error: "Fecha inválida" }, 400);

    const registros = await database
      .select()
      .from(turnos)
      .where(eq(turnos.fecha, fecha));

    return json(registros);
  }

  if (request.method === "POST") {
    const payload = await request.json();
    const fecha = String(payload.fecha || "");
    const destino = String(payload.destino || "");
    const slotIndex = Number(payload.slotIndex);
    const horaPlan = String(payload.horaPlan || "");
    const busNum = String(payload.busNum || "").slice(0, 30);
    const horaReal = String(payload.horaReal || "").slice(0, 5);
    const cancelado = Boolean(payload.cancelado);

    if (!FECHA_PATTERN.test(fecha) || !DESTINOS.has(destino) || !Number.isInteger(slotIndex) || slotIndex < 0 || !horaPlan) {
      return json({ error: "Datos de turno inválidos" }, 400);
    }

    const [registro] = await database
      .insert(turnos)
      .values({ fecha, destino, slotIndex, horaPlan, busNum, horaReal, cancelado, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [turnos.fecha, turnos.destino, turnos.slotIndex],
        set: { horaPlan, busNum, horaReal, cancelado, updatedAt: new Date() },
      })
      .returning();

    return json(registro);
  }

  return json({ error: "Método no permitido" }, 405);
}

export const config: Config = {
  path: "/api/turnos",
};
