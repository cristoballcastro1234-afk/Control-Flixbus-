
CREATE TABLE IF NOT EXISTS turnos (
  fecha TEXT NOT NULL,
  destino TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  hora_plan TEXT NOT NULL,
  bus_num TEXT NOT NULL DEFAULT '',
  hora_real TEXT NOT NULL DEFAULT '',
  cancelado INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (fecha, destino, slot_index)
);
