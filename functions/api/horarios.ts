
import { destinos,horaValida,json,nuevoSlot,cuerpo,origenValido } from "../lib/dia";
import type {Sesion} from "./auth";
interface Env{DB:D1Database}
type Datos={sesion:Sesion|null};
export const onRequestGet:PagesFunction<Env,string,Datos>=async({env,data})=>{
 if(data.sesion?.rol!=="admin")return json({error:"Sin permiso"},403);
 const r=await env.DB.prepare("SELECT destino,slot_index AS slotIndex,grupo,hora_plan AS horaPlan,tipo,terminal FROM horarios ORDER BY grupo,destino,hora_plan").all();
 return json(r.results);
};
export const onRequestPost:PagesFunction<Env,string,Datos>=async({env,data,request})=>{
 if(data.sesion?.rol!=="admin")return json({error:"Sin permiso"},403);
 if(!origenValido(request))return json({error:"Petición no permitida"},403);
 const p=await cuerpo(request);if(!p)return json({error:"Petición inválida"},400);
 const destino=String(p.destino||"");const id=Number(p.slotIndex);
 if(!destinos.has(destino))return json({error:"Destino inválido"},400);
 if(p.accion==="eliminar"){
  if(!Number.isSafeInteger(id)||id<0)return json({error:"Horario inválido"},400);
  await env.DB.prepare("DELETE FROM horarios WHERE destino=? AND slot_index=?").bind(destino,id).run();
  return json({ok:true});
 }
 if(!["semana","domingo"].includes(String(p.grupo))||!horaValida(p.horaPlan))return json({error:"Horario inválido"},400);
 const tipo=String(p.tipo||(destino==="stgo"?"directo":"")),terminal=String(p.terminal||(destino==="stgo"?"sur":""));
 if(!["","directo","indirecto"].includes(tipo)||!["","sur","san-borja"].includes(terminal)||(destino!=="stgo"&&(tipo||terminal)))return json({error:"Ruta o terminal inválido"},400);
 if(p.accion==="editar"){
  if(!Number.isSafeInteger(id)||id<0)return json({error:"Horario inválido"},400);
  const r=await env.DB.prepare("UPDATE horarios SET grupo=?,hora_plan=?,tipo=?,terminal=? WHERE destino=? AND slot_index=?").bind(p.grupo,p.horaPlan,tipo,terminal,destino,id).run();
  if(!r.meta.changes)return json({error:"Horario no encontrado"},404);
 }else if(p.accion==="agregar"){
  await env.DB.prepare("INSERT INTO horarios(destino,slot_index,grupo,hora_plan,tipo,terminal) VALUES(?,?,?,?,?,?)").bind(destino,nuevoSlot(),p.grupo,p.horaPlan,tipo,terminal).run();
 }else return json({error:"Acción inválida"},400);
 return json({ok:true});
};
