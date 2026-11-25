import {diaChile,json} from "../lib/dia";
import type {Sesion} from "./auth";
// Solo se leen datos públicos normalizados desde la D1 aislada; no claves API.
export const onRequestGet:PagesFunction<unknown,string,{sesion:Sesion|null;officeDb:D1Database}>=async({data})=>{
 if(!data.sesion)return json({error:"No autenticado"},401);
 try{
  const r=await data.officeDb.prepare("SELECT fecha,datos FROM programacion_oficial WHERE id=1 AND fecha=?").bind(diaChile().fecha).first<{fecha:string;datos:string}>();
  if(!r)return json({habilitado:true,disponible:false});
  const d=JSON.parse(r.datos);
  const age=Date.now()-Number(d.actualizado);
  if(!Array.isArray(d.visibles)||!Number.isFinite(age)||age< -60000||age>600000)return json({habilitado:true,disponible:false});
  const rows=d.visibles.map((x:any)=>({destino:x.destino,horaPlan:x.horaPlan,
   llegada:x.llegada||null,salida:x.salida||null,gps:x.gps===true}));
  return json({habilitado:true,disponible:true,fecha:r.fecha,actualizado:d.actualizado,rows});
 }catch{return json({habilitado:true,disponible:false})}
};
