-- Sin datos operativos históricos: solo un contador de cambios y una marca del día de limpieza.
CREATE TABLE IF NOT EXISTS sync_estado (
 id INTEGER PRIMARY KEY CHECK(id=1),
 revision INTEGER NOT NULL DEFAULT 0,
 limpieza TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO sync_estado(id) VALUES(1);
CREATE TRIGGER IF NOT EXISTS sync_turnos_insert AFTER INSERT ON turnos
BEGIN UPDATE sync_estado SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS sync_turnos_update AFTER UPDATE ON turnos
BEGIN UPDATE sync_estado SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS sync_turnos_delete AFTER DELETE ON turnos
BEGIN UPDATE sync_estado SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS sync_horarios_insert AFTER INSERT ON horarios
BEGIN UPDATE sync_estado SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS sync_horarios_update AFTER UPDATE ON horarios
BEGIN UPDATE sync_estado SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS sync_horarios_delete AFTER DELETE ON horarios
BEGIN UPDATE sync_estado SET revision=revision+1 WHERE id=1; END;
