
-- Ejecutar UNA vez con wrangler d1 migrations apply, después de registrar 0001–0004.
ALTER TABLE usuarios ADD COLUMN sesion_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE turnos ADD COLUMN tipo TEXT;
ALTER TABLE turnos ADD COLUMN terminal TEXT;
ALTER TABLE turnos ADD COLUMN motivo TEXT NOT NULL DEFAULT '';
ALTER TABLE turnos ADD COLUMN observacion TEXT NOT NULL DEFAULT '';
ALTER TABLE turnos ADD COLUMN updated_by TEXT NOT NULL DEFAULT '';
CREATE TABLE horarios (
 destino TEXT NOT NULL CHECK(destino IN ('stgo','cur','scrz')),
 slot_index INTEGER NOT NULL,
 grupo TEXT NOT NULL CHECK(grupo IN ('semana','domingo')),
 hora_plan TEXT NOT NULL,
 tipo TEXT NOT NULL DEFAULT '' CHECK(tipo IN ('','directo','indirecto')),
 terminal TEXT NOT NULL DEFAULT '' CHECK(terminal IN ('','sur','san-borja')),
 PRIMARY KEY(destino,slot_index)
);
CREATE INDEX horarios_grupo ON horarios(grupo,destino,hora_plan);
INSERT INTO horarios(destino,slot_index,grupo,hora_plan,tipo,terminal) VALUES
('stgo',0,'semana','05:35','',''),
('stgo',1,'semana','05:55','',''),
('stgo',2,'semana','06:20','',''),
('stgo',3,'semana','06:40','',''),
('stgo',4,'semana','07:20','',''),
('stgo',5,'semana','07:35','',''),
('stgo',6,'semana','07:45','',''),
('stgo',7,'semana','08:20','',''),
('stgo',8,'semana','08:25','',''),
('stgo',9,'semana','08:45','',''),
('stgo',10,'semana','09:20','',''),
('stgo',11,'semana','09:35','',''),
('stgo',12,'semana','09:50','',''),
('stgo',13,'semana','10:00','',''),
('stgo',14,'semana','10:20','',''),
('stgo',15,'semana','10:45','',''),
('stgo',16,'semana','10:50','',''),
('stgo',17,'semana','11:45','',''),
('stgo',18,'semana','12:20','',''),
('stgo',19,'semana','13:20','',''),
('stgo',20,'semana','13:45','',''),
('stgo',21,'semana','13:55','',''),
('stgo',22,'semana','14:20','',''),
('stgo',23,'semana','14:30','',''),
('stgo',24,'semana','14:45','',''),
('stgo',25,'semana','14:55','',''),
('stgo',26,'semana','15:20','',''),
('stgo',27,'semana','15:35','',''),
('stgo',28,'semana','15:55','',''),
('stgo',29,'semana','16:20','',''),
('stgo',30,'semana','16:25','',''),
('stgo',31,'semana','16:45','',''),
('stgo',32,'semana','17:20','',''),
('stgo',33,'semana','17:55','',''),
('stgo',34,'semana','18:30','',''),
('stgo',35,'semana','18:45','',''),
('stgo',36,'semana','18:55','',''),
('stgo',37,'semana','19:20','',''),
('stgo',38,'semana','19:45','',''),
('stgo',39,'semana','19:50','',''),
('stgo',40,'semana','20:20','',''),
('stgo',41,'semana','20:30','',''),
('stgo',42,'semana','21:00','',''),
('stgo',43,'semana','21:45','',''),
('cur',0,'semana','07:20','',''),
('cur',1,'semana','07:50','',''),
('cur',2,'semana','08:30','',''),
('cur',3,'semana','09:00','',''),
('cur',4,'semana','09:10','',''),
('cur',5,'semana','10:10','',''),
('cur',6,'semana','10:35','',''),
('cur',7,'semana','11:10','',''),
('cur',8,'semana','11:20','',''),
('cur',9,'semana','11:35','',''),
('cur',10,'semana','12:10','',''),
('cur',11,'semana','12:35','',''),
('cur',12,'semana','13:10','',''),
('cur',13,'semana','13:35','',''),
('cur',14,'semana','14:10','',''),
('cur',15,'semana','14:35','',''),
('cur',16,'semana','15:10','',''),
('cur',17,'semana','15:20','',''),
('cur',18,'semana','15:35','',''),
('cur',19,'semana','16:10','',''),
('cur',20,'semana','16:35','',''),
('cur',21,'semana','17:10','',''),
('cur',22,'semana','17:20','',''),
('cur',23,'semana','18:10','',''),
('cur',24,'semana','18:35','',''),
('cur',25,'semana','19:20','',''),
('cur',26,'semana','19:35','',''),
('cur',27,'semana','20:10','',''),
('cur',28,'semana','20:35','',''),
('cur',29,'semana','21:10','',''),
('cur',30,'semana','21:35','',''),
('scrz',0,'semana','07:55','',''),
('scrz',1,'semana','10:49','',''),
('scrz',2,'semana','11:49','',''),
('scrz',3,'semana','12:49','',''),
('scrz',4,'semana','13:19','',''),
('scrz',5,'semana','14:49','',''),
('scrz',6,'semana','15:49','',''),
('scrz',7,'semana','18:49','',''),
('scrz',8,'semana','19:49','',''),
('scrz',9,'semana','20:49','',''),
('scrz',10,'semana','21:19','','');
CREATE TABLE actividad_dia (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 fecha TEXT NOT NULL, destino TEXT NOT NULL, slot_index INTEGER NOT NULL,
 usuario TEXT NOT NULL, momento TEXT NOT NULL, anterior TEXT, nuevo TEXT NOT NULL
);
CREATE INDEX actividad_fecha ON actividad_dia(fecha,id);
CREATE INDEX turnos_fecha_orden ON turnos((substr(fecha,7,4)||substr(fecha,4,2)||substr(fecha,1,2)));
CREATE INDEX actividad_fecha_orden ON actividad_dia((substr(fecha,7,4)||substr(fecha,4,2)||substr(fecha,1,2)));
CREATE TRIGGER turno_insert_audit AFTER INSERT ON turnos
BEGIN
 INSERT INTO actividad_dia(fecha,destino,slot_index,usuario,momento,anterior,nuevo)
 VALUES(NEW.fecha,NEW.destino,NEW.slot_index,NEW.updated_by,NEW.updated_at,NULL,
 json_object('horaPlan',NEW.hora_plan,'busNum',NEW.bus_num,'horaLlegada',NEW.hora_llegada,'horaReal',NEW.hora_real,'cancelado',NEW.cancelado,'eliminado',NEW.eliminado,'tipo',NEW.tipo,'terminal',NEW.terminal,'motivo',NEW.motivo,'observacion',NEW.observacion));
END;
CREATE TRIGGER turno_update_audit AFTER UPDATE ON turnos
WHEN OLD.hora_plan IS NOT NEW.hora_plan OR OLD.bus_num IS NOT NEW.bus_num OR OLD.hora_llegada IS NOT NEW.hora_llegada OR OLD.hora_real IS NOT NEW.hora_real OR OLD.cancelado IS NOT NEW.cancelado OR OLD.eliminado IS NOT NEW.eliminado OR OLD.tipo IS NOT NEW.tipo OR OLD.terminal IS NOT NEW.terminal OR OLD.motivo IS NOT NEW.motivo OR OLD.observacion IS NOT NEW.observacion
BEGIN
 INSERT INTO actividad_dia(fecha,destino,slot_index,usuario,momento,anterior,nuevo)
 VALUES(NEW.fecha,NEW.destino,NEW.slot_index,NEW.updated_by,NEW.updated_at,
 json_object('horaPlan',OLD.hora_plan,'busNum',OLD.bus_num,'horaLlegada',OLD.hora_llegada,'horaReal',OLD.hora_real,'cancelado',OLD.cancelado,'eliminado',OLD.eliminado,'tipo',OLD.tipo,'terminal',OLD.terminal,'motivo',OLD.motivo,'observacion',OLD.observacion),
 json_object('horaPlan',NEW.hora_plan,'busNum',NEW.bus_num,'horaLlegada',NEW.hora_llegada,'horaReal',NEW.hora_real,'cancelado',NEW.cancelado,'eliminado',NEW.eliminado,'tipo',NEW.tipo,'terminal',NEW.terminal,'motivo',NEW.motivo,'observacion',NEW.observacion));
END;
