// Sincronización GPS exclusiva del piloto. Nunca modifica bases/Workers de producción.
// Requiere clave propia en Secret GPS_API_KEY y activación consciente en PILOT_GPS_ENABLED.
// El modo automático exige PILOT_AUTO_HORARIOS=true después de validar datos reales.
// No se guardan coordenadas, placa, nombres de conductores ni historial de días anteriores.
import {asignarHorarios} from "./gps.mjs";

export const ESTACIONES={
 sanfernando:{id:"7628e209-3267-4fff-bf99-7255e109a9fc",destinos:["stgo","cur","scrz"]},
 santiago:{id:"e69c534e-f6ab-40d6-8b2e-82daa155971e",destinos:["sanf","cur","rgua","scrz"]},
 curico:{id:"81153994-0f99-48c7-8bf8-fc1d7ecc2fc0",destinos:["stgo","sanf","rgua","scrz"]},
 rancagua:{id:"9c7426d7-3d58-43aa-a839-c406e53be5e9",destinos:["stgo","sanf","cur","scrz"]},
 santacruz:{id:"23b9fd59-ce00-447d-bdd8-6e6f43f8f63a",destinos:["stgo","sanf","cur","rgua"]}
};
const FMT=new Intl.DateTimeFormat("en-GB",{timeZone:"America/Santiago",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
function chile(utc){
 const ts=typeof utc==="number"?utc:Date.parse(utc);
 if(!Number.isFinite(ts))return null;
 const p=Object.fromEntries(FMT.formatToParts(new Date(ts)).map(x=>[x.type,x.value]));
 return {fecha:p.day+"-"+p.month+"-"+p.year,hora:p.hour+":"+p.minute,dia:p.year+"-"+p.month+"-"+p.day};
}
function inicioUTC(dia){
 const [year,month,day]=dia.split("-").map(Number),start=Date.UTC(year,month-1,day);
 let lo=start-6*3600000,hi=start+8*3600000;
 while(hi-lo>60000){const mid=Math.floor((lo+hi)/120000)*60000;if(chile(mid).dia<dia)lo=mid;else hi=mid}
 return hi;
}
export function rangoDiaChile(now){
 const day=chile(now).dia,next=new Date(Date.parse(day+"T12:00:00Z")+24*3600000).toISOString().slice(0,10);
 return [inicioUTC(day),inicioUTC(next)-1];
}
function canon(s){return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase().replace(/\s+/g," ")}
function destinoCiudad(name){
 const city=canon(name);
 return ({"santiago":"stgo","santiago de chile":"stgo","curico":"cur","santa cruz":"scrz","san fernando":"sanf","rancagua":"rgua"})[city]||null;
}
function desvio(call,fecha){
 const d=call?.deviation;
 if(!d||!["ACTUAL","ESTIMATED"].includes(d.deviation_type)||!Number.isFinite(d.deviation_seconds))return null;
 const t=chile(d.deviation_timestamp);
 if(!t||t.fecha!==fecha)return null;
 const updated=Date.parse(d.updated_at);
 return {hora:t.hora,tipo:d.deviation_type,segundos:d.deviation_seconds,actualizado:Number.isFinite(updated)?updated:null};
}
export function normalizarEstacion(payload,oficina,now){
 const station=ESTACIONES[oficina];if(!station)throw Error("Oficina no válida");
 if(!Array.isArray(payload?.rides)||payload.rides.length>1000)throw Error("Respuesta del proveedor no válida");
 const fecha=chile(now).fecha,rows=[];
 for(const ride of payload.rides){
  if(typeof ride?.id!=="string"||!ride.id||ride.id.length>100||!Array.isArray(ride.calls)||ride.calls.length>300)continue;
  const match=ride.calls.filter(x=>x?.stop?.id===station.id);if(match.length!==1)continue;
  const origin=match[0],at=chile(origin.departure?.scheduled);
  if(!at||at.fecha!==fecha||!Number.isFinite(origin.sequence))continue;
  const later=ride.calls.filter(x=>Number.isFinite(x?.sequence)&&x.sequence>origin.sequence).sort((a,b)=>a.sequence-b.sequence);
  const final=later.at(-1)?.stop;if(!final)continue;
  const destino=destinoCiudad(final.city?.name);
  if(!destino||!station.destinos.includes(destino))continue;
  const terminal=destino==="stgo"?({"STSU":"sur","SNTG":"san-borja"})[final.code]||"":"";
  // Sin terminal confirmado no se infiere que un servicio llegue a Terminal Sur.
  if(destino==="stgo"&&!terminal)continue;
  const tipo=destino==="stgo"?(later.some(x=>x.stop?.code==="RNC")?"indirecto":"directo"):"";
  rows.push({rideId:ride.id,destino,horaPlan:at.hora,tipo,terminal,
   llegada:desvio(origin.arrival,fecha),salida:desvio(origin.departure,fecha),gps:!!ride.location?.coordinates});
 }
 if(new Set(rows.map(x=>x.rideId)).size!==rows.length)throw Error("IDs repetidos del proveedor");
 return {fecha,actualizado:now,rows};
}
export function coberturaSegura(nuevos,base,anterior){
 if(!nuevos.length||nuevos.length>600)return false;
 // El tablero identifica la telemetría por destino y hora: no admitir coincidencias ambiguas.
 if(new Set(nuevos.map(r=>r.rideId)).size!==nuevos.length||new Set(nuevos.map(r=>r.destino+":"+r.horaPlan)).size!==nuevos.length)return false;
 const old=anterior?.visibles?.length?anterior.visibles:base;
 if(!Array.isArray(old)||!old.length)return true; // primera programación en una oficina nueva
 const present=new Set(nuevos.map(r=>r.destino));
 if(old.some(r=>!present.has(r.destino)))return false; // un destino completo no puede desaparecer súbitamente
 if(nuevos.length<Math.ceil(old.length*.7))return false;
 // Falta una proporción significativa de horarios o los extremos: conservar último estado bueno.
 const min=x=>Number(x.horaPlan.slice(0,2))*60+Number(x.horaPlan.slice(3));
 for(const d of new Set(old.map(r=>r.destino))){
  const was=old.filter(x=>x.destino===d).map(min),next=nuevos.filter(x=>x.destino===d).map(min);
  if(next.length<Math.max(1,Math.ceil(was.length*.65)))return false;
  if(Math.min(...next)>Math.min(...was)+90||Math.max(...next)<Math.max(...was)-90)return false;
 }
 return true;
}
export function generarPrograma(nuevos,base,turnos,prev,now){
 if(!coberturaSegura(nuevos,base,prev))throw Error("Cobertura oficial insuficiente");
 const assigned=asignarHorarios(nuevos,base,turnos,prev);
 const details=new Map(nuevos.map(r=>[r.rideId,r]));
 assigned.visibles=assigned.visibles.map(r=>({...r,llegada:details.get(r.rideId)?.llegada||null,
  salida:details.get(r.rideId)?.salida||null,gps:details.get(r.rideId)?.gps===true}));
 // Una ausencia solo se confirma en dos lecturas completas sucesivas.
 const prevAusencias=new Set(prev?.ausencias||[]),present=new Set(nuevos.map(x=>x.rideId)),ausencias=[];
 for(const old of prev?.visibles||[]){
  if(!present.has(old.rideId)&&!prevAusencias.has(old.rideId)){
   if(assigned.visibles.some(r=>r.destino===old.destino&&r.horaPlan===old.horaPlan))throw Error("Horario reasignado ambiguamente");
   assigned.visibles.push({...old,llegada:null,salida:null,gps:false});ausencias.push(old.rideId);
  }
 }
 assigned.visibles.sort((a,b)=>a.horaPlan.localeCompare(b.horaPlan)||a.destino.localeCompare(b.destino)||a.slotIndex-b.slotIndex);
 assigned.ausencias=ausencias;assigned.actualizado=now;
 return assigned;
}
async function consultar(env,id,from,to){
 const url=new URL("https://global.api.flixbus.com/gis/v2/timetable/"+id+"/departures");
 url.searchParams.set("from",new Date(from).toISOString());url.searchParams.set("to",new Date(to).toISOString());
 url.searchParams.set("apiKey",env.GPS_API_KEY);
 let res;
 try{res=await fetch(url,{headers:{"Accept":"application/json"},redirect:"manual",signal:AbortSignal.timeout(8000)})}
 catch{throw Error("Sin conexión con proveedor")}
 if([401,403,429].includes(res.status)){const e=new Error("Proveedor rechazó acceso o aplicó límite");e.codigo=res.status;throw e}
 if(res.status>=300&&res.status<400)throw Error("Redirección no permitida");
 if(!res.ok)throw Error("Proveedor HTTP "+res.status);
 const raw=await res.text();if(raw.length>2500000)throw Error("Respuesta demasiado grande");
 let data;try{data=JSON.parse(raw)}catch{throw Error("JSON del proveedor no válido")}
 if(!Array.isArray(data?.rides))throw Error("Sin lista rides");
 return data;
}
async function controlPausa(db){
 await db.prepare("CREATE TABLE IF NOT EXISTS gps_control (id INTEGER PRIMARY KEY CHECK(id=1), pausado_hasta INTEGER NOT NULL DEFAULT 0)").run();
 const r=await db.prepare("SELECT pausado_hasta AS hasta FROM gps_control WHERE id=1").first();
 return r?.hasta||0;
}
async function guardarPausa(db,hasta){
 await db.prepare("INSERT INTO gps_control(id,pausado_hasta) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET pausado_hasta=excluded.pausado_hasta").bind(hasta).run();
}
// La activación de escritura es explícita por oficina, después de contrastar su horario.
export function escrituraAutorizada(env,oficina){
 return env.PILOT_AUTO_HORARIOS==="true"&&String(env.PILOT_AUTO_OFICINAS||"").split(",").map(x=>x.trim()).includes(oficina)&&Object.hasOwn(ESTACIONES,oficina);
}
async function sincronizarOficina(env,oficina,db,now,from,to){
 const station=ESTACIONES[oficina],dato=normalizarEstacion(await consultar(env,station.id,from,to),oficina,now);
 console.log("GPS piloto "+oficina+": "+dato.rows.length+" salidas reconocidas");
 // La validación completa también se ejecuta en modo de solo lectura.
 const grupo=new Intl.DateTimeFormat("es-CL",{timeZone:"America/Santiago",weekday:"long"}).format(new Date(now))==="domingo"?"domingo":"semana";
 const [b,t,p]=await db.batch([
  db.prepare("SELECT destino,slot_index AS slotIndex,hora_plan AS horaPlan,tipo,terminal FROM horarios WHERE grupo=?").bind(grupo),
  db.prepare("SELECT destino,slot_index AS slotIndex,hora_plan AS horaPlan FROM turnos WHERE fecha=?").bind(dato.fecha),
  db.prepare("SELECT datos FROM programacion_oficial WHERE id=1 AND fecha=?").bind(dato.fecha)
 ]);
 let prev=null;
 try{if(p.results[0])prev=JSON.parse(p.results[0].datos)}catch{throw Error("Programación previa dañada; no sobrescribir")}
 const nuevo=generarPrograma(dato.rows,b.results,t.results,prev,now);
 const counts=Object.fromEntries(station.destinos.map(d=>[d,dato.rows.filter(r=>r.destino===d).length]));
 console.log("GPS piloto "+oficina+": validación local correcta; recibidos="+dato.rows.length+" respaldo="+b.results.length+" destinos="+JSON.stringify(counts));
 if(!escrituraAutorizada(env,oficina)){console.log("GPS piloto "+oficina+": solo lectura, sin escritura de horarios");return}
 if(chile(Date.now()).fecha!==dato.fecha)return; // no trasladar servicios al día siguiente
 const result=await db.prepare("INSERT INTO programacion_oficial(id,fecha,datos) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET fecha=excluded.fecha,datos=excluded.datos WHERE fecha<>excluded.fecha OR datos<>excluded.datos").bind(dato.fecha,JSON.stringify(nuevo)).run();
 if(result.meta.changes){
  console.log("GPS piloto "+oficina+": programación actualizada");
  if(env.REALTIME){try{await env.REALTIME.get(env.REALTIME.idFromName(oficina)).fetch("https://interno/notificar",{method:"POST"})}catch{console.warn("Aviso WebSocket no disponible "+oficina)}}
 }
}
export default {
 async fetch(){return new Response("Not Found",{status:404})},
 async scheduled(_event,env,ctx){
  if(env.PILOT_GPS_ENABLED!=="true"){console.log("GPS piloto desactivado");return}
  if(!env.GPS_API_KEY||!env.PILOT_DB){console.warn("GPS piloto sin credencial o DB central");return}
  const now=Date.now(),loc=chile(now);
  if(loc.hora<"05:30"||loc.hora>"21:40")return;
  let hasta=0;try{hasta=await controlPausa(env.PILOT_DB)}catch{console.warn("Pausa GPS no disponible; se detiene por seguridad");return}
  if(hasta>now){console.log("GPS piloto en pausa de proveedor");return}
  const [from,to]=rangoDiaChile(now);
  const officeDB={sanfernando:env.PILOT_DB,santiago:env.PILOT_SANTIAGO,curico:env.PILOT_CURICO,rancagua:env.PILOT_RANCAGUA,santacruz:env.PILOT_SANTACRUZ};
  if(Object.values(officeDB).some(db=>!db)){console.warn("GPS piloto: faltan bindings D1; se detiene");return}
  const resultados=await Promise.allSettled(Object.entries(officeDB).map(async([office,db])=>{
   try{await sincronizarOficina(env,office,db,now,from,to)}
   catch(e){if([401,403,429].includes(e?.codigo)){try{await guardarPausa(env.PILOT_DB,now+(e.codigo===429?3600000:21600000))}catch{}}
    console.warn("GPS piloto "+office+": "+(e?.codigo?"acceso/límite del proveedor":e?.message||"consulta fallida"))}
  }));
  void resultados; // Todos los fallos son independientes y no interrumpen otras oficinas.
 }
};
