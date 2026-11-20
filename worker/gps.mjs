// Piloto de lectura. Sin clave autorizada/binding no realiza consultas.
// Nunca conserva coordenadas, identificadores de vehículos ni un historial.
const STOP="7628e209-3267-4fff-bf99-7255e109a9fc";
const fmt=new Intl.DateTimeFormat("en-GB",{timeZone:"America/Santiago",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
function local(value){
 const n=Date.parse(value);if(!Number.isFinite(n))return null;
 const p=Object.fromEntries(fmt.formatToParts(new Date(n)).map(x=>[x.type,x.value]));
 return {fecha:p.day+"-"+p.month+"-"+p.year,hora:p.hour+":"+p.minute};
}
function deviation(call,fecha){
 const d=call?.deviation;
 if(!d||!["ACTUAL","ESTIMATED"].includes(d.deviation_type)||!Number.isFinite(d.deviation_seconds))return null;
 const time=local(d.deviation_timestamp);
 if(!time||time.fecha!==fecha)return null;
 const updated=Date.parse(d.updated_at);
 return {hora:time.hora,tipo:d.deviation_type,segundos:d.deviation_seconds,actualizado:Number.isFinite(updated)?updated:null};
}
export function normalize(payload,now){
 if(!Array.isArray(payload?.rides)||payload.rides.length>300)throw Error("Respuesta de horarios inválida");
 const fecha=local(new Date(now).toISOString()).fecha,rows=[];
 for(const ride of payload.rides){
  if(!Array.isArray(ride?.calls)||ride.calls.length>300)continue;
  const calls=ride.calls, matches=calls.filter(x=>x?.stop?.id===STOP);
  if(matches.length!==1)continue;
  const call=matches[0],time=local(call.departure?.scheduled);
  if(!time||time.fecha!==fecha)continue;
  const later=calls.filter(x=>Number.isFinite(x?.sequence)&&x.sequence>call.sequence).sort((a,b)=>a.sequence-b.sequence);
  const end=later[later.length-1]?.stop;
  if(!end)continue;
  const city=String(end.city?.name||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const destino=({santiago:"stgo",curico:"cur","santa cruz":"scrz"})[city];
  if(!destino)continue;
  const terminal=destino==="stgo"?({STSU:"sur",SNTG:"san-borja"})[end.code]||"":"";
  // Rancagua Shopping/Paradero no equivale al Terminal O'Higgins.
  const tipo=destino==="stgo"?(later.some(x=>x.stop?.code==="RNC")?"indirecto":"directo"):"";
  if(typeof ride.id!=="string"||!ride.id||ride.id.length>100)continue;
  rows.push({rideId:ride.id,destino,horaPlan:time.hora,tipo,terminal,llegada:deviation(call.arrival,fecha),salida:deviation(call.departure,fecha),gps:!!ride.location?.coordinates});
 }
 return {fecha,actualizado:now,rows};
}
// La programación solo es autoritativa si la cobertura del día ha sido
// comprobada y el administrador activa GPS_AUTO_HORARIOS.
const horarioKey=r=>r.destino+":"+r.horaPlan.padStart(5,"0");
const slotKey=r=>r.destino+":"+r.slotIndex;
const plano=r=>({rideId:r.rideId,destino:r.destino,horaPlan:r.horaPlan,tipo:r.tipo,terminal:r.terminal});
export function validarCobertura(rows,base){
 if(!Array.isArray(rows)||!rows.length||!Array.isArray(base)||!base.length)return false;
 if(new Set(rows.map(r=>r.rideId)).size!==rows.length||new Set(rows.map(horarioKey)).size!==rows.length)return false;
 if(rows.some(r=>r.destino==="stgo"&&!["sur","san-borja"].includes(r.terminal)))return false;
 const min=r=>Number(r.horaPlan.slice(0,2))*60+Number(r.horaPlan.slice(3));
 for(const d of ["stgo","cur","scrz"]){
  const old=base.filter(x=>x.destino===d).map(min),next=rows.filter(x=>x.destino===d).map(min);
  if(!old.length)continue;
  if(next.length<Math.max(1,Math.ceil(old.length*.75))||
   Math.min(...next)>Math.min(...old)+90||Math.max(...next)<Math.max(...old)-90)return false;
 }
 return true;
}
// Mantener identidades estables incluso al cambiar la hora de una misma carrera.
// Nunca reutilizar un ID reservado ni asociar dos registros a la misma carrera.
export function asignarHorarios(rows,base,turnos,prev){
 const antiguos=prev?.reservas||[],reservas=new Map(antiguos.map(r=>[r.rideId,r]));
 const usados=new Set(antiguos.map(slotKey)),ocupados=new Set([...base,...turnos].map(slotKey));
 const visibles=[];
 const porSlotTurno=new Map(turnos.map(r=>[slotKey(r),r]));
 for(const raw of [...rows].sort((a,b)=>a.horaPlan.localeCompare(b.horaPlan)||a.rideId.localeCompare(b.rideId))){
  const r=plano(raw),old=reservas.get(r.rideId);
  let slotIndex;
  if(old&&old.destino!==r.destino)throw Error("Carrera cambió de destino");
  if(old)slotIndex=old.slotIndex;
  else {
   const candidatos=(list)=>list.filter(x=>horarioKey(x)===horarioKey(r)&&!usados.has(slotKey(x)));
   const t=candidatos(turnos),b=candidatos(base).filter(x=>{const t=porSlotTurno.get(slotKey(x));return !t||horarioKey(t)===horarioKey(r)});
   // Si hay registros diarios distintos para el mismo horario, no adivinar.
   if(t.length>1||(!t.length&&b.length>1))throw Error("Horario ambiguo");
   if(t.length===1)slotIndex=t[0].slotIndex;
   else if(b.length===1)slotIndex=b[0].slotIndex;
   else{
    slotIndex=500000000000;
    while(usados.has(r.destino+":"+slotIndex)||ocupados.has(r.destino+":"+slotIndex))slotIndex++;
   }
  }
  const mapped={...r,slotIndex};
  usados.add(slotKey(mapped));reservas.set(r.rideId,mapped);visibles.push(mapped);
 }
 if(reservas.size>600)throw Error("Demasiados cambios de programación");
 return {visibles,reservas:[...reservas.values()]};
}
async function consultar(env,from,to){
 const url=new URL("https://global.api.flixbus.com/gis/v2/timetable/"+STOP+"/departures");
 url.searchParams.set("from",new Date(from).toISOString());url.searchParams.set("to",new Date(to).toISOString());
 url.searchParams.set("apiKey",env.GPS_API_KEY);
 let res;
 try{res=await fetch(url,{signal:AbortSignal.timeout(8000),redirect:"error",headers:{Accept:"application/json"}})}
 catch(e){console.warn(e?.name==="TimeoutError"||e?.name==="AbortError"?"GPS: tiempo de espera agotado":"GPS: fallo de conexión o redirección");throw Error("Consulta fallida")}
 console.log("GPS: respuesta HTTP "+res.status);
 if([401,403,429].includes(res.status)){
  console.warn("GPS: acceso rechazado o límite del proveedor; pausa de una hora");
  await env.GPS_CACHE.put("pausa","1",{expirationTtl:3600});throw Error("Acceso GPS rechazado");
 }
 if(!res.ok)throw Error("GPS HTTP "+res.status);
 let raw;try{raw=await res.text()}catch{console.warn("GPS: fallo al leer respuesta");throw Error("Lectura fallida")}
 if(raw.length>1500000){console.warn("GPS: respuesta demasiado grande");throw Error("Respuesta demasiado grande")}
 try{const payload=JSON.parse(raw);if(!Array.isArray(payload?.rides)){console.warn("GPS: JSON sin lista rides");throw Error("Estructura inválida")}console.log("GPS: servicios recibidos "+payload.rides.length);return payload}
 catch{console.warn("GPS: JSON inválido o estructura inesperada");throw Error("Respuesta inválida")}
}
function rangoDia(now){
 const p=local(new Date(now).toISOString()),[hh,mm]=p.hora.split(":").map(Number);
 const inicio=Math.floor(now/60000)*60000-(hh*60+mm)*60000;
 // En jornada operativa el offset ya es el del día. El parser filtra por fecha local.
 return [inicio,inicio+24*3600000-1];
}
async function actualizarPrograma(env,now,fecha,grupo){
 const [from,to]=rangoDia(now);
 const dato=normalize(await consultar(env,from,to),now);
 const [b,t,p]=await env.DB.batch([
  env.DB.prepare("SELECT destino,slot_index AS slotIndex,hora_plan AS horaPlan,tipo,terminal FROM horarios WHERE grupo=?").bind(grupo),
  env.DB.prepare("SELECT destino,slot_index AS slotIndex,hora_plan AS horaPlan FROM turnos WHERE fecha=?").bind(fecha),
  env.DB.prepare("SELECT datos FROM programacion_oficial WHERE id=1 AND fecha=?").bind(fecha)
 ]);
 const prev=p.results[0]?JSON.parse(p.results[0].datos):null;
 if(!validarCobertura(dato.rows,b.results)|| (prev&&!validarCobertura(dato.rows,prev.visibles)))throw Error("Cobertura incompleta: se conserva programación anterior");
 const nuevo=asignarHorarios(dato.rows,b.results,t.results,prev);
 // Confirmar ausencias en dos respuestas completas consecutivas para evitar
 // quitar un servicio por un fallo transitorio del proveedor.
 const missing=new Set(prev?.ausencias||[]),present=new Set(nuevo.visibles.map(r=>r.rideId)),ausencias=[];
 for(const old of prev?.visibles||[]){if(!present.has(old.rideId)&&!missing.has(old.rideId)){if(nuevo.visibles.some(r=>horarioKey(r)===horarioKey(old)))throw Error("Identidad de servicio ambigua");nuevo.visibles.push(old);ausencias.push(old.rideId)}}
 nuevo.visibles.sort((a,b)=>a.horaPlan.localeCompare(b.horaPlan)||a.rideId.localeCompare(b.rideId));nuevo.ausencias=ausencias.sort();
 const datos=JSON.stringify(nuevo);
 if(local(new Date().toISOString()).fecha!==fecha)return;
 // No incrementar revisión cuando el horario no ha cambiado. La telemetría está en KV.
 await env.DB.prepare("INSERT INTO programacion_oficial(id,fecha,datos) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET fecha=excluded.fecha,datos=excluded.datos WHERE fecha<>excluded.fecha OR datos<>excluded.datos").bind(fecha,datos).run();
 return dato;
}
export default {
 async fetch(){return new Response("Not Found",{status:404});},
 async scheduled(_event,env){
  if(env.GPS_ENABLED!=="true"){console.log("GPS: desactivado; sin consultas externas");return}
  if(!env.GPS_API_KEY){console.warn("GPS: falta configurar la clave");return}
  if(!env.GPS_CACHE){console.warn("GPS: falta vinculación KV");return}
  const now=Date.now(),p=local(new Date(now).toISOString()),hora=p.hora;
  const auto=env.GPS_AUTO_HORARIOS==="true"&&!!env.DB;
  if(auto&&hora==="00:00"){
   try{await env.DB.prepare("DELETE FROM programacion_oficial WHERE fecha<>?").bind(p.fecha).run()}catch{console.warn("Limpieza de programación no disponible")}
  }
  if(hora<"05:30"||hora>"21:40")return;
  if(await env.GPS_CACHE.get("pausa")){console.log("GPS: pausa del proveedor activa");return}
  let dato=null;
  // Revisión completa al comienzo de la jornada y cada 30 minutos;
  // seguimiento ligero cada 5 minutos. No se deducen bajas de una ventana parcial.
  if(auto&&(hora.endsWith(":00")||hora.endsWith(":30"))){
   try{
    const grupo=new Intl.DateTimeFormat("es-CL",{timeZone:"America/Santiago",weekday:"long"}).format(new Date(now))==="domingo"?"domingo":"semana";
    dato=await actualizarPrograma(env,now,p.fecha,grupo);
    console.log("Programación oficial validada");
   }catch{console.warn("Programación oficial incompleta o no disponible: se conserva la anterior");}
  }
  try{
   if(!dato){
    if(await env.GPS_CACHE.get("pausa"))return;
    dato=normalize(await consultar(env,now-30*60000,now+120*60000),now);
   }
   // No persistir identificadores externos, coordenadas ni recorridos completos en KV.
   const rows=dato.rows.map(({rideId,...r})=>r);
   console.log("GPS: servicios válidos en San Fernando "+rows.length);
   try{await env.GPS_CACHE.put("actual",JSON.stringify({...dato,rows}),{expirationTtl:600})}
   catch{console.warn("GPS: no se pudo guardar en KV");return}
   console.log("GPS: caché actual guardada");
  }catch{console.warn("GPS: consulta o procesamiento fallido; se conserva respaldo");}
 }
};
