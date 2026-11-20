export const OFICINAS = {
 sanfernando:{nombre:"San Fernando",destinos:{stgo:"Santiago",cur:"Curicó",scrz:"Santa Cruz"}},
 santiago:{nombre:"Santiago",destinos:{sanf:"San Fernando",cur:"Curicó",rgua:"Rancagua",scrz:"Santa Cruz"}},
 curico:{nombre:"Curicó",destinos:{stgo:"Santiago",sanf:"San Fernando",rgua:"Rancagua",scrz:"Santa Cruz"}},
 rancagua:{nombre:"Rancagua",destinos:{stgo:"Santiago",sanf:"San Fernando",cur:"Curicó",scrz:"Santa Cruz"}},
 santacruz:{nombre:"Santa Cruz",destinos:{stgo:"Santiago",sanf:"San Fernando",cur:"Curicó",rgua:"Rancagua"}}
} as const;
export type Oficina=keyof typeof OFICINAS;
export function oficinaValida(x:unknown):x is Oficina{return typeof x==="string"&&Object.prototype.hasOwnProperty.call(OFICINAS,x)}
export interface PilotoEnv {PILOT_DB?:D1Database;PILOT_SANTIAGO?:D1Database;PILOT_CURICO?:D1Database;PILOT_RANCAGUA?:D1Database;PILOT_SANTACRUZ?:D1Database;REALTIME?:DurableObjectNamespace;SESSION_SECRET:string}
export function baseOficina(env:PilotoEnv,o:Oficina){return ({sanfernando:env.PILOT_DB,santiago:env.PILOT_SANTIAGO,curico:env.PILOT_CURICO,rancagua:env.PILOT_RANCAGUA,santacruz:env.PILOT_SANTACRUZ})[o]}
export function puedeAcceder(rol:string,asignada:string,solicitada:string){return oficinaValida(solicitada)&&(rol==="admin"||asignada===solicitada)}
export function destinoValido(o:Oficina,d:string){return Object.prototype.hasOwnProperty.call(OFICINAS[o].destinos,d)}
export async function notificar(env:PilotoEnv,o:Oficina){if(!env.REALTIME)return;try{await env.REALTIME.get(env.REALTIME.idFromName(o)).fetch("https://interno/notificar",{method:"POST"})}catch{/* reconciliación periódica */}}
