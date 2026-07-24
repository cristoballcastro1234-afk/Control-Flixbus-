import { boolean, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const turnos = pgTable("turnos", {
  fecha: text("fecha").notNull(),
  destino: text("destino").notNull(),
  slotIndex: integer("slot_index").notNull(),
  horaPlan: text("hora_plan").notNull(),
  busNum: text("bus_num").notNull().default(""),
  horaReal: text("hora_real").notNull().default(""),
  cancelado: boolean("cancelado").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.fecha, table.destino, table.slotIndex] }),
]);
