
import { diaChile, limpiarDias, destinos, horaValida, json, cuerpo, origenValido } from "../lib/dia";
import type { Sesion } from "./auth";
interface Env {DB:D1Database}
type Contexto = {sesion:Sesion|null};
type Turno = {destino:string;slotIndex:number;horaPlan:string;busNum:string;horaLlegada:string;horaReal:string;cancelado:number|boolean;eliminado:number|boolean;tipo:string|null;terminal:string|null;motivo:string;observacion:string;updatedAt:string;updatedBy:string};
type Horario = {destino:string;slotIndex:number;horaPlan:string;tipo:string;terminal:string};
const campos = {busNum:"bus_num",horaLlegada:"hora_llegada",horaReal:"hora_real",cancelado:"cancelado",eliminado:"eliminado",tipo:"tipo",terminal:"terminal",motivo:"motivo",observacion:"observacion"} as const;
type Campo = keyof typeof campos;
const seleccionar = "SELECT destino,slot_index AS slotIndex,hora_plan AS horaPlan,bus_num AS busNum,hora_llegada AS horaLlegada,hora_real AS horaReal,cancelado,eliminado,tipo,terminal,motivo,observacion,updated_at AS updatedAt,updated_by AS updatedBy FROM turnos";
const horarios = "SELECT destino,slot_index AS slotIndex,hora_plan AS horaPlan,tipo,terminal FROM horarios";
function vista(t:Turno,h?:Horario) {return {...t, horaPlan:t.horaPlan.padStart(5,"0"),cancelado:!!t.cancelado,eliminado:!!t.eliminado,tipo:t.tipo??h?.tipo??"",terminal:t.terminal??h?.terminal??"",manual:!h};}
export const onRequestGet:PagesFunction<Env,string,Contexto> = async ({env,data,request}) => {
 if(!data.sesion)return json({error:"No autenticado"},401);
 const dia=diaChile();
 // Respaldo de limpieza si el Cron todavía no ha ejecutado el cambio de día.
 await limpiarDias(env.DB);
 if(new URL(request.url).searchParams.get("accion")==="actividad"){
  const r=await env.DB.prepare("SELECT id,destino,slot_index AS slotIndex,usuario,momento,anterior,nuevo FROM actividad_dia WHERE fecha=? ORDER BY id DESC LIMIT 250").bind(dia.fecha).all();
  return json({fecha:dia.fecha,actividad:r.results});
 }
 const [h,t]=await Promise.all([
 env.DB.prepare(horarios+" WHERE grupo=? ORDER BY hora_plan").bind(dia.grupo).all<Horario>(),
 env.DB.prepare(seleccionar+" WHERE fecha=?").bind(dia.fecha).all<Turno>()
 ]);
 const porId=new Map(t.results.map(r=>[r.destino+":"+r.slotIndex,r]));
 const rows=h.results.map(r=>{
  const k=r.destino+":"+r.slotIndex;
  const real=porId.get(k); porId.delete(k);
  return vista(real||{...r,busNum:"",horaLlegada:"",horaReal:"",cancelado:false,eliminado:false,motivo:"",observacion:"",updatedAt:"",updatedBy:""},r);
 });
 for(const r of porId.values())rows.push(vista(r));
 return json({...dia,now:Date.now(),usuario:data.sesion.usuario,rol:data.sesion.rol,programados:h.results.length,rows});
};
function validar(k:Campo,v:unknown,destino:string) {
 if(k==="cancelado"||k==="eliminado")return typeof v==="boolean";
 if(typeof v!=="string")return false;
 if(k==="horaLlegada"||k==="horaReal")return v===""||horaValida(v);
 if(k==="busNum")return v.length<=30;
 if(k==="tipo")return destino==="stgo"?["","directo","indirecto"].includes(v):v==="";
 if(k==="terminal")return destino==="stgo"?["","sur","san-borja"].includes(v):v==="";
 return v.length<=250;
}
export const onRequestPost:PagesFunction<Env,string,Contexto> = async ({env,data,request}) => {
 if(!data.sesion)return json({error:"No autenticado"},401);
 if(!origenValido(request))return json({error:"Petición no permitida"},403);
 const p=await cuerpo(request); if(!p)return json({error:"Petición inválida"},400);
 const dia=diaChile(); const destino=String(p.destino||"");
 if(p.fecha!==dia.fecha)return json({error:"Cambió el día operativo. Actualiza el tablero."},409);
 if(!destinos.has(destino))return json({error:"Destino inválido"},400);
 await limpiarDias(env.DB);
 const quien=data.sesion.usuario;
 const ahora=new Date().toISOString();
 if(p.accion==="agregar"){
  if(!horaValida(p.horaPlan))return json({error:"Hora inválida"},400);
  // El identificador de la operación lo mantiene el cliente para que un reintento no duplique el bus.
  const id=Number(p.slotIndex);
  if(!Number.isSafeInteger(id)||id<1000000000000)return json({error:"Identificador inválido"},400);
  if(diaChile().fecha!==dia.fecha)return json({error:"Cambió el día operativo. Actualiza el tablero."},409);
  await env.DB.prepare("INSERT INTO turnos(fecha,destino,slot_index,hora_plan,updated_at,updated_by) VALUES(?,?,?,?,?,?) ON CONFLICT(fecha,destino,slot_index) DO NOTHING").bind(dia.fecha,destino,id,p.horaPlan,ahora,quien).run();
  return json({ok:true,slotIndex:id});
 }
 const id=Number(p.slotIndex);
 if(!Number.isSafeInteger(id)||id<0||p.accion!=="editar")return json({error:"Turno inválido"},400);
 const cambios=p.cambios;
 if(!cambios||typeof cambios!=="object"||Array.isArray(cambios))return json({error:"Cambios inválidos"},400);
 const pares=Object.entries(cambios as Record<string,unknown>);
 if(!pares.length||pares.some(([k,v])=>!Object.prototype.hasOwnProperty.call(campos,k)||!validar(k as Campo,v,destino)))return json({error:"Datos inválidos"},400);
 const h=await env.DB.prepare(horarios+" WHERE destino=? AND slot_index=? AND grupo=?").bind(destino,id,dia.grupo).first<Horario>();
 const existente=await env.DB.prepare(seleccionar+" WHERE fecha=? AND destino=? AND slot_index=?").bind(dia.fecha,destino,id).first<Turno>();
 if(!h&&!existente)return json({error:"Ese horario ya no existe"},404);
 const valores=pares.map(([k,v])=>typeof v==="boolean"?Number(v):v);
 const columnas=pares.map(([k])=>campos[k as Campo]);
 const baseCols=["fecha","destino","slot_index","hora_plan","updated_at","updated_by"];
 const baseVals=[dia.fecha,destino,id,existente?.horaPlan??h!.horaPlan,ahora,quien];
 // Solo se actualizan los campos editados: el resto no se sobrescribe.
 const sql="INSERT INTO turnos("+baseCols.concat(columnas).join(",")+") VALUES("+baseCols.concat(columnas).map(()=>"?").join(",")+") ON CONFLICT(fecha,destino,slot_index) DO UPDATE SET "+columnas.map(c=>c+"=excluded."+c).concat(["updated_at=excluded.updated_at","updated_by=excluded.updated_by"]).join(",");
 if(diaChile().fecha!==dia.fecha)return json({error:"Cambió el día operativo. Actualiza el tablero."},409);
 await env.DB.prepare(sql).bind(...baseVals,...valores).run();
 return json({ok:true});
};
