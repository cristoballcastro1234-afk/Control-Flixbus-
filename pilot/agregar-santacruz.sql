ALTER TABLE usuarios RENAME COLUMN oficina TO oficina_anterior;
ALTER TABLE usuarios ADD COLUMN oficina TEXT NOT NULL DEFAULT 'sanfernando' CHECK(oficina IN ('sanfernando','santiago','curico','rancagua','santacruz'));
UPDATE usuarios SET oficina=oficina_anterior;
ALTER TABLE usuarios DROP COLUMN oficina_anterior;
