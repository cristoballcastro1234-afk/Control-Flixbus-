-- Ejecutar una vez en D1; no se modifican turnos ni usuarios.
-- Las listas se aplican a los horarios permanentes de Santiago.
UPDATE horarios SET
 tipo=CASE WHEN hora_plan IN ('05:35','06:40','07:35','09:35','15:35','19:50') THEN 'indirecto' ELSE 'directo' END,
 terminal=CASE WHEN hora_plan IN ('09:50','14:30','18:30','20:30') THEN 'san-borja' ELSE 'sur' END
WHERE destino='stgo';

-- Copiar horarios vigentes a domingo, desde las horas indicadas, con IDs independientes.
INSERT OR IGNORE INTO horarios(destino,slot_index,grupo,hora_plan,tipo,terminal)
SELECT h.destino,h.slot_index+1000000000000,'domingo',h.hora_plan,h.tipo,h.terminal
FROM horarios h
WHERE h.grupo='semana'
AND ((h.destino='stgo' AND h.hora_plan>='07:35')
 OR (h.destino='cur' AND h.hora_plan>='07:50')
 OR (h.destino='scrz' AND h.hora_plan>='15:49'))
AND NOT EXISTS (SELECT 1 FROM horarios d WHERE d.grupo='domingo' AND d.destino=h.destino AND d.hora_plan=h.hora_plan);
