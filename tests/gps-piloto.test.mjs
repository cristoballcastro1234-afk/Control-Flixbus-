import test from "node:test";
import assert from "node:assert/strict";
import {ESTACIONES,rangoDiaChile,normalizarEstacion,coberturaSegura,generarPrograma,escrituraAutorizada} from "../worker/gps-piloto.mjs";
const now=Date.parse("2026-11-20T11:44:00Z");
const s=ESTACIONES;
const mk=(id,office,city,code,hora="2026-11-20T11:30:00Z")=>({id,calls:[
 {sequence:1,stop:{id:s[office].id},departure:{scheduled:hora,deviation:{deviation_type:"ESTIMATED",deviation_timestamp:"2026-11-20T11:41:00Z",deviation_seconds:660}}},
 {sequence:2,stop:{city:{name:city},code}}]});
test("Las cinco estaciones reconocen únicamente destinos de su propia oficina",()=>{
 const cases=[
 ["sanfernando","Curicó","CUR","cur"],
 ["santiago","Santa Cruz","SCRZ","scrz"],
 ["curico","San Fernando","SFN","sanf"],
 ["rancagua","Santiago","STSU","stgo"],
 ["santacruz","Rancagua","RNC","rgua"]];
 for(const [office,city,code,destino] of cases){
  const a=normalizarEstacion({rides:[mk("r1",office,city,code)]},office,now);
  assert.equal(a.rows[0].destino,destino);assert.equal(a.rows[0].horaPlan,"08:30");
  assert.equal(a.rows[0].salida.hora,"08:41");assert.equal(a.rows[0].gps,false);
 }
});
test("No adivina destinos ni terminales y no toma horarios de otro día",()=>{
 const raw={rides:[mk("bad","santiago","Talca","TAL"),mk("b2","rancagua","Santiago","UNKNOWN"),mk("b3","santiago","Curicó","CUR","2026-11-21T11:30:00Z")]};
 assert.equal(normalizarEstacion(raw,"santiago",now).rows.length,0);
 assert.equal(normalizarEstacion(raw,"rancagua",now).rows.length,0);
});
test("Franja completa del día chileno, incluso cambio horario",()=>{
 for(const instant of ["2026-11-20T12:00:00Z","2026-04-05T12:00:00Z","2026-09-06T12:00:00Z"]){
  const n=Date.parse(instant),[start,end]=rangoDiaChile(n);
  assert.ok(start<n&&n<end);
  const fmt=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Santiago",year:"numeric",month:"2-digit",day:"2-digit"});
  assert.equal(fmt.format(new Date(start)),fmt.format(new Date(n)));
  assert.equal(fmt.format(new Date(end)),fmt.format(new Date(n)));
  assert.notEqual(fmt.format(new Date(start-60000)),fmt.format(new Date(n)));
  assert.notEqual(fmt.format(new Date(end+60000)),fmt.format(new Date(n)));
 }
});
test("Rechaza lista vacía y pérdidas de destinos, pero permite primera programación de oficina",()=>{
 const rows=[{rideId:"a",destino:"cur",horaPlan:"08:30"},{rideId:"b",destino:"stgo",horaPlan:"09:30"}];
 assert.equal(coberturaSegura(rows,[],null),true);
 assert.equal(coberturaSegura([],[],null),false);
 assert.equal(coberturaSegura(rows.slice(0,1),rows,null),false);
});
test("Una revisión de GPS cambia la hora sin perder el índice del turno ya registrado",()=>{
 const row=[{rideId:"abc",destino:"cur",horaPlan:"08:30",tipo:"",terminal:"",salida:null,llegada:null,gps:false}];
 const base=[{destino:"cur",horaPlan:"08:30",slotIndex:42,tipo:"",terminal:""}];
 const first=generarPrograma(row,base,[{...base[0]}],null,now);
 assert.equal(first.visibles[0].slotIndex,42);
 const moved=generarPrograma([{...row[0],horaPlan:"08:45"}],base,[{...base[0]}],first,now+300000);
 assert.equal(moved.visibles[0].slotIndex,42);
 assert.equal(moved.visibles[0].horaPlan,"08:45");
 assert.equal(moved.actualizado,now+300000);
});

test("La escritura exige ambas autorizaciones y se limita a oficinas verificadas",()=>{
 assert.equal(escrituraAutorizada({PILOT_AUTO_HORARIOS:"true"},"curico"),false);
 assert.equal(escrituraAutorizada({PILOT_AUTO_OFICINAS:"curico"},"curico"),false);
 const env={PILOT_AUTO_HORARIOS:"true",PILOT_AUTO_OFICINAS:"curico, rancagua, desconocida"};
 assert.equal(escrituraAutorizada(env,"curico"),true);
 assert.equal(escrituraAutorizada(env,"rancagua"),true);
 assert.equal(escrituraAutorizada(env,"sanfernando"),false);
 assert.equal(escrituraAutorizada(env,"desconocida"),false);
});
test("Rechaza servicios ambiguos para la visualización incluso sin respaldo local",()=>{
 const a={rideId:"a",destino:"cur",horaPlan:"08:30"};
 assert.equal(coberturaSegura([a,{...a,rideId:"b"}],[],null),false);
 assert.equal(coberturaSegura([a,{...a,horaPlan:"09:30"}],[],null),false);
 assert.equal(coberturaSegura([a,{...a,rideId:"b",horaPlan:"09:30"}],[],null),true);
});
