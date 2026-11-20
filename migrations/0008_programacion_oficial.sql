-- Una única programación pública del día, independiente de los turnos de operación.
CREATE TABLE IF NOT EXISTS programacion_oficial (
 id INTEGER PRIMARY KEY CHECK(id=1),
 fecha TEXT NOT NULL,
 datos TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS sync_oficial_insert AFTER INSERT ON programacion_oficial
BEGIN UPDATE sync_estado SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS sync_oficial_update AFTER UPDATE ON programacion_oficial
BEGIN UPDATE sync_estado SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS sync_oficial_delete AFTER DELETE ON programacion_oficial
BEGIN UPDATE sync_estado SET revision=revision+1 WHERE id=1; END;
