import test from "node:test";
import assert from "node:assert/strict";
import {normalize,validarCobertura,asignarHorarios} from "../worker/gps.mjs";
const stop="7628e209-3267-4fff-bf99-7255e109a9fc",now=Date.parse("2026-11-20T11:44:00Z");
const ride=(id,city,code)=>{
 return {id,calls:[{sequence:1,stop:{id:stop},arrival:{scheduled:"2026-11-20T11:25:00Z",deviation:{deviation_type:"ESTIMATED",deviation_timestamp:"2026-11-20T11:41:22Z",deviation_seconds:982}},departure:{scheduled:"2026-11-20T11:30:00Z",deviation:{deviation_type:"ESTIMATED",deviation_timestamp:"2026-11-20T11:41:22Z",deviation_seconds:682}}},{sequence:2,stop:{city:{name:city},code}}]};
};
test("horarios Chile, estimaciones separadas y sin coordenadas",()=>{
 const rows=normalize({rides:[ride("a","Curicó","CUR")]},now).rows;
 assert.equal(rows[0].horaPlan,"08:30");assert.equal(rows[0].llegada.segundos,982);assert.equal(rows[0].salida.segundos,682);assert.equal(rows[0].salida.hora,"08:41");assert.equal(rows[0].gps,false);
});
const rows=[{rideId:"a",destino:"stgo",horaPlan:"08:20",tipo:"directo",terminal:"sur"},{rideId:"b",destino:"cur",horaPlan:"08:30",tipo:"",terminal:""},{rideId:"c",destino:"scrz",horaPlan:"12:49",tipo:"",terminal:""}];
const base=rows.map((r,i)=>({...r,slotIndex:i}));
test("rechaza una respuesta parcial sin Santa Cruz o una hora duplicada",()=>{
 assert.equal(validarCobertura(rows,base),true);assert.equal(validarCobertura(rows.slice(0,2),base),false);assert.equal(validarCobertura([...rows,rows[0]],base),false);
});
test("preserva ID legado, cambios de hora y reserva de carreras retiradas",()=>{
 const first=asignarHorarios(rows,base,[{...rows[0],slotIndex:77}],null);
 const changed=asignarHorarios([{...rows[0],horaPlan:"08:25"},rows[1],{...rows[2],rideId:"nuevo",horaPlan:"13:00"}],base,[],first);
 assert.equal(first.visibles.find(x=>x.rideId==="a").slotIndex,77);
 assert.equal(changed.visibles.find(x=>x.rideId==="a").slotIndex,77);
 assert.equal(changed.visibles.find(x=>x.rideId==="nuevo").slotIndex,500000000000);
 assert.ok(changed.reservas.some(x=>x.rideId==="c"));
});
test("no reutiliza un horario base ocupado por otro registro diario",()=>{
 const mapped=asignarHorarios(rows,base,[{...rows[0],horaPlan:"08:00",slotIndex:0}],null);
 assert.equal(mapped.visibles.find(x=>x.rideId==="a").slotIndex,500000000000);
});
test("un ID oficial que cambia de destino no reasigna registros",()=>{
 const first=asignarHorarios(rows,base,[],null);
 assert.throws(()=>asignarHorarios([{...rows[0],destino:"cur"}],base,[],first));
});
