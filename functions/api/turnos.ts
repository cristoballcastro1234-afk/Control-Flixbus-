import {OFICINAS,destinoValido,type Oficina} from "../lib/oficinas";

import { diaChile, limpiarDias, destinos, horaValida, json, cuerpo, origenValido } from "../lib/dia";
import type { Sesion } from "./auth";
interface Env {DB:D1Database;GPS_CACHE?:KVNamespace;GPS_ENABLED?:string;GPS_AUTO_HORARIOS?:string}
type Contexto = {sesion:Sesion|null;office:Oficina;officeDb:D1Database};
type Turno = {destino:string;slotIndex:number;horaPlan:string;busNum:string;horaLlegada:string;horaReal:string;cancelado:number|boolean;eliminado:number|boolean;tipo:string|null;terminal:string|null;motivo:string;observacion:string;updatedAt:string;updatedBy:string};
type Horario = {destino:string;slotIndex:number;horaPlan:string;tipo:string;terminal:string};
type ProgramaOficial={visibles:Horario[];reservas:Horario[]};
function programa(raw:unknown):ProgramaOficial|null{try{const p=JSON.parse(String(raw));const ok=(x:unknown)=>Array.isArray(x)&&x.length<=600&&x.every(r=>r&&destinos.has(r.destino)&&Number.isSafeInteger(r.slotIndex)&&r.slotIndex>=0&&horaValida(r.horaPlan));return ok(p.visibles)&&p.visibles.length>0&&ok(p.reservas)?p:null}catch{return null}}
const campos = {busNum:"bus_num",horaLlegada:"hora_llegada",horaReal:"hora_real",cancelado:"cancelado",eliminado:"eliminado",motivo:"motivo",observacion:"observacion"} as const;
type Campo = keyof typeof campos;
const seleccionar = "SELECT destino,slot_index AS slotIndex,hora_plan AS horaPlan,bus_num AS busNum,hora_llegada AS horaLlegada,hora_real AS horaReal,cancelado,eliminado,tipo,terminal,motivo,observacion,updated_at AS updatedAt,updated_by AS updatedBy FROM turnos";
const horarios = "SELECT destino,slot_index AS slotIndex,hora_plan AS horaPlan,tipo,terminal FROM horarios";
function vista(t:Turno,h?:Horario) {return {...t, horaPlan:t.horaPlan.padStart(5,"0"),cancelado:!!t.cancelado,eliminado:!!t.eliminado,tipo:t.destino==="stgo"?(h?h.tipo||"directo":t.tipo||"directo"):"",terminal:t.destino==="stgo"?(h?h.terminal||"sur":t.terminal||"sur"):"",manual:!h};}
export const onRequestGet:PagesFunction<Env,string,Contexto> = async ({env,data,request}) => {
 if(!data.sesion)return json({error:"No autenticado"},401);
 const dia=diaChile();
 const params=new URL(request.url).searchParams;
 const estado=await data.officeDb.prepare("SELECT revision,limpieza FROM sync_estado WHERE id=1").first<{revision:number;limpieza:string}>();
 if(!estado)return json({error:"Falta configurar la sincronización"},503);
 // Solo el primer acceso de cada día ejecuta la limpieza de respaldo.
 // El Cron independiente permanece activo aun sin visitantes.
 if(estado.limpieza!==dia.fecha){
  await limpiarDias(data.officeDb);
  if(diaChile().fecha!==dia.fecha)return json({error:"Cambió el día operativo. Reintenta."},409);
  await data.officeDb.prepare("UPDATE sync_estado SET limpieza=? WHERE id=1 AND limpieza<>?").bind(dia.fecha,dia.fecha).run();
 }
 if(params.get("accion")==="actividad"){
  const r=await data.officeDb.prepare("SELECT id,destino,slot_index AS slotIndex,usuario,momento,anterior,nuevo FROM actividad_dia WHERE fecha=? ORDER BY id DESC LIMIT 250").bind(dia.fecha).all();
  return json({fecha:dia.fecha,actividad:r.results});
 }
 const auto=false; // No consultas GPS externas en el piloto.
 const meta={...dia,now:Date.now(),usuario:data.sesion.usuario,rol:data.sesion.rol,gpsHabilitado:false,oficina:data.office,oficinaNombre:OFICINAS[data.office].nombre,destinos:OFICINAS[data.office].destinos,oficinas:Object.entries(OFICINAS).filter(([id])=>data.sesion!.rol==="admin"||id===data.office).map(([id,o])=>({id,nombre:o.nombre}))};
 if(estado.limpieza===dia.fecha && params.get("fecha")===dia.fecha && params.get("revision")===String(estado.revision)){
  return json({...meta,revision:estado.revision,sinCambios:true});
 }
 // La revisión y las filas se leen en una misma transacción D1, para no
 // marcar como recibido un cambio que no está incluido en la respuesta.
 const statements=[
 data.officeDb.prepare("SELECT revision FROM sync_estado WHERE id=1"),
 data.officeDb.prepare(horarios+" WHERE grupo=? ORDER BY hora_plan").bind(dia.grupo),
 data.officeDb.prepare(seleccionar+" WHERE fecha=?").bind(dia.fecha)
 ];
 const [rev,h,t,o]=await data.officeDb.batch<{revision:number}|Horario|Turno|{datos:string}>(auto?[...statements,data.officeDb.prepare("SELECT datos FROM programacion_oficial WHERE id=1 AND fecha=?").bind(dia.fecha)]:statements).catch(()=>data.officeDb.batch<{revision:number}|Horario|Turno>(statements));
 if(diaChile().fecha!==dia.fecha)return json({error:"Cambió el día operativo. Reintenta."},409);
 const revision=Number((rev.results[0] as {revision:number}|undefined)?.revision);
 if(!Number.isSafeInteger(revision))return json({error:"Revisión inválida"},503);
 const respaldo=h.results as Horario[], ts=t.results as Turno[];
 const oficial=programa((o?.results[0] as {datos:string}|undefined)?.datos);
 const hs=oficial?oficial.visibles.map(r=>({destino:r.destino,slotIndex:r.slotIndex,horaPlan:r.horaPlan,tipo:r.tipo,terminal:r.terminal})):respaldo;
 const porId=new Map(ts.map(r=>[r.destino+":"+r.slotIndex,r]));
 const rows=hs.map(r=>{
  const k=r.destino+":"+r.slotIndex;
  const real=porId.get(k); porId.delete(k);
  return {...vista(real||{...r,busNum:"",horaLlegada:"",horaReal:"",cancelado:false,eliminado:false,motivo:"",observacion:"",updatedAt:"",updatedBy:""},r),...(oficial?{horaPlan:r.horaPlan,oficial:true}:{})};
 });
 // Los registros diarios heredados pueden tener un ID distinto al del horario.
 // Si existe una coincidencia inequívoca por destino y hora, usar sus metadatos
 // pero conservar el ID del registro (y su condición de extra) para no perder datos.
 const porHora=new Map<string,Horario|null>();
 for(const h of hs){
  const k=h.destino+":"+h.horaPlan.padStart(5,"0");
  porHora.set(k,porHora.has(k)?null:h);
 }
 for(const r of porId.values()){
  const h=porHora.get(r.destino+":"+r.horaPlan.padStart(5,"0"));
  const anterior=oficial?.reservas.find(x=>x.destino===r.destino&&x.slotIndex===r.slotIndex);
  rows.push({...vista(r,anterior||h||undefined),manual:true});
 }
 return json({...meta,now:Date.now(),revision,programacionOficial:!!oficial,programados:hs.length,rows});
};
function validar(k:Campo,v:unknown) {
 if(k==="cancelado"||k==="eliminado")return typeof v==="boolean";
 if(typeof v!=="string")return false;
 if(k==="horaLlegada"||k==="horaReal")return v===""||horaValida(v);
 if(k==="busNum")return v.length<=30;
 return v.length<=250;
}
export const onRequestPost:PagesFunction<Env,string,Contexto> = async ({env,data,request}) => {
 if(!data.sesion)return json({error:"No autenticado"},401);
 if(!origenValido(request))return json({error:"Petición no permitida"},403);
 const p=await cuerpo(request); if(!p)return json({error:"Petición inválida"},400);
 const dia=diaChile(); const destino=String(p.destino||"");
 if(p.fecha!==dia.fecha)return json({error:"Cambió el día operativo. Actualiza el tablero."},409);
 if(!destinoValido(data.office,destino))return json({error:"Destino inválido"},400);
 // El Worker programado y el primer GET del día ya se ocupan de la limpieza.
 const quien=data.sesion.usuario;
 const ahora=new Date().toISOString();
 if(p.accion==="agregar"){
  if(!horaValida(p.horaPlan))return json({error:"Hora inválida"},400);
  // El identificador de la operación lo mantiene el cliente para que un reintento no duplique el bus.
  const id=Number(p.slotIndex);
  if(!Number.isSafeInteger(id)||id<1000000000000)return json({error:"Identificador inválido"},400);
  if(diaChile().fecha!==dia.fecha)return json({error:"Cambió el día operativo. Actualiza el tablero."},409);
  await data.officeDb.prepare("INSERT INTO turnos(fecha,destino,slot_index,hora_plan,updated_at,updated_by) VALUES(?,?,?,?,?,?) ON CONFLICT(fecha,destino,slot_index) DO NOTHING").bind(dia.fecha,destino,id,p.horaPlan,ahora,quien).run();
  return json({ok:true,slotIndex:id});
 }
 const id=Number(p.slotIndex);
 if(!Number.isSafeInteger(id)||id<0||p.accion!=="editar")return json({error:"Turno inválido"},400);
 const cambios=p.cambios;
 if(!cambios||typeof cambios!=="object"||Array.isArray(cambios))return json({error:"Cambios inválidos"},400);
 const pares=Object.entries(cambios as Record<string,unknown>);
 if(!pares.length||pares.some(([k,v])=>!Object.prototype.hasOwnProperty.call(campos,k)||!validar(k as Campo,v)))return json({error:"Datos inválidos"},400);
 let h=await data.officeDb.prepare(horarios+" WHERE destino=? AND slot_index=? AND grupo=?").bind(destino,id,dia.grupo).first<Horario>();
 if(false){
  try{const o=await data.officeDb.prepare("SELECT datos FROM programacion_oficial WHERE id=1 AND fecha=?").bind(dia.fecha).first<{datos:string}>();const p=programa(o?.datos);h=p?.reservas.find(r=>r.destino===destino&&r.slotIndex===id)||h}catch{/* respaldo local */}
 }
 const existente=await data.officeDb.prepare(seleccionar+" WHERE fecha=? AND destino=? AND slot_index=?").bind(dia.fecha,destino,id).first<Turno>();
 if(!h&&!existente)return json({error:"Ese horario ya no existe"},404);
 const valores=pares.map(([k,v])=>typeof v==="boolean"?Number(v):v);
 const columnas=pares.map(([k])=>campos[k as Campo]);
 const baseCols=["fecha","destino","slot_index","hora_plan","updated_at","updated_by","tipo","terminal"];
 const baseVals=[dia.fecha,destino,id,existente?.horaPlan??h!.horaPlan,ahora,quien,h?.tipo??existente?.tipo??"",h?.terminal??existente?.terminal??""];
 // Solo se actualizan los campos editados: el resto no se sobrescribe.
 const sql="INSERT INTO turnos("+baseCols.concat(columnas).join(",")+") VALUES("+baseCols.concat(columnas).map(()=>"?").join(",")+") ON CONFLICT(fecha,destino,slot_index) DO UPDATE SET "+columnas.map(c=>c+"=excluded."+c).concat(["updated_at=excluded.updated_at","updated_by=excluded.updated_by"]).join(",");
 if(diaChile().fecha!==dia.fecha)return json({error:"Cambió el día operativo. Actualiza el tablero."},409);
 await data.officeDb.prepare(sql).bind(...baseVals,...valores).run();
 return json({ok:true});
};
