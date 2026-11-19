
export function diaChile(ahora = new Date()) {
 const datos = new Intl.DateTimeFormat("es-CL", {timeZone:"America/Santiago",year:"numeric",month:"2-digit",day:"2-digit",weekday:"long"}).formatToParts(ahora);
 const p = (tipo:string) => datos.find(d=>d.type===tipo)?.value || "";
 return { fecha: p("day")+"-"+p("month")+"-"+p("year"), grupo: p("weekday")==="domingo" ? "domingo" : "semana" };
}
export async function limpiarDias(db:D1Database) {
 // Solo se eliminan fechas anteriores: una solicitud que cruce medianoche
 // no puede borrar registros del nuevo día.
 const [d,m,a]=diaChile().fecha.split("-");
 const hoy=a+m+d;
 await db.batch([
 db.prepare("DELETE FROM turnos WHERE (substr(fecha,7,4)||substr(fecha,4,2)||substr(fecha,1,2)) < ?").bind(hoy),
 db.prepare("DELETE FROM actividad_dia WHERE (substr(fecha,7,4)||substr(fecha,4,2)||substr(fecha,1,2)) < ?").bind(hoy)
 ]);
}
export const destinos = new Set(["stgo","cur","scrz"]);
export const horaValida = (v:unknown): v is string => typeof v==="string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
export const json = (data:unknown,status=200) => Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export const nuevoSlot = () => Date.now()*1000 + crypto.getRandomValues(new Uint32Array(1))[0]%1000;
export async function cuerpo(request:Request):Promise<Record<string,unknown>|null> {
 try { const b=await request.json(); return b && typeof b==="object" && !Array.isArray(b) ? b as Record<string,unknown> : null; } catch {return null;}
}
export function origenValido(request:Request) {
 const origen=request.headers.get("Origin");
 return (!origen || origen===new URL(request.url).origin) && (request.headers.get("Content-Type")||"").split(";")[0].trim()==="application/json";
}
