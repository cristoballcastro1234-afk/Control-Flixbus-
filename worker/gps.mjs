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
  rows.push({destino,horaPlan:time.hora,tipo,terminal,llegada:deviation(call.arrival,fecha),salida:deviation(call.departure,fecha),gps:!!ride.location?.coordinates});
 }
 return {fecha,actualizado:now,rows};
}
export default {
 async fetch(){return new Response("Not Found",{status:404});},
 async scheduled(_event,env){
  if(env.GPS_ENABLED!=="true"||!env.GPS_API_KEY||!env.GPS_CACHE)return;
  const now=Date.now(),hora=local(new Date(now).toISOString()).hora;
  if(hora<"05:30"||hora>"21:40")return;
  if(await env.GPS_CACHE.get("pausa"))return;
  const url=new URL("https://global.api.flixbus.com/gis/v2/timetable/"+STOP+"/departures");
  url.searchParams.set("from",new Date(now-30*60000).toISOString());
  url.searchParams.set("to",new Date(now+120*60000).toISOString());
  url.searchParams.set("apiKey",env.GPS_API_KEY);
  let res;
  try{res=await fetch(url,{signal:AbortSignal.timeout(8000),redirect:"error",headers:{Accept:"application/json"}});}
  catch{console.warn("GPS no disponible");return;}
  if([401,403,429].includes(res.status)){
   await env.GPS_CACHE.put("pausa","1",{expirationTtl:3600});
   console.warn("GPS pausado por respuesta HTTP "+res.status);return;
  }
  if(!res.ok){console.warn("GPS no disponible: HTTP "+res.status);return;}
  // No registrar URL, respuesta ni valores secretos en los logs.
  try{
   const raw=await res.text();if(raw.length>1500000)throw Error("Respuesta demasiado grande");
   const data=normalize(JSON.parse(raw),now);
   await env.GPS_CACHE.put("actual",JSON.stringify(data),{expirationTtl:600});
  }catch{console.warn("GPS: respuesta no válida o caché no disponible");}
 }
};
