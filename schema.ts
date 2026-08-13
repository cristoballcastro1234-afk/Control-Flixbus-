import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const turnos = sqliteTable(
  "turnos",
  {
    fecha: text("fecha").notNull(),
    destino: text("destino").notNull(),
    slotIndex: integer("slot_index").notNull(),
    horaPlan: text("hora_plan").notNull(),
    busNum: text("bus_num").notNull().default(""),
    horaLlegada: text("hora_llegada").notNull().default(""),
    horaReal: text("hora_real").notNull().default(""),
    // D1/SQLite no tiene tipo boolean nativo: se guarda como 0/1
    // pero Drizzle lo traduce automáticamente a true/false en JS.
    cancelado: integer("cancelado", { mode: "boolean" }).notNull().default(false),
    // Oculta el horario de la vista de hoy (se usa cuando el horario no va a circular),
    // a diferencia de "cancelado" que es para un bus que sí estaba en curso (ej: panne).
    eliminado: integer("eliminado", { mode: "boolean" }).notNull().default(false),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.fecha, table.destino, table.slotIndex] }),
  ],
);

export const usuarios = sqliteTable("usuarios", {
  usuario: text("usuario").primaryKey(),
  nombre: text("nombre").notNull().default(""),
  // Formato pbkdf2$<iteraciones>$<salt>$<hash>. Nunca se guarda la contraseña en texto plano.
  passwordHash: text("password_hash").notNull(),
  rol: text("rol").notNull().default("operador"),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  intentosFallidos: integer("intentos_fallidos").notNull().default(0),
  bloqueadoHasta: text("bloqueado_hasta").notNull().default(""),
  creadoEn: text("creado_en").notNull(),
});
