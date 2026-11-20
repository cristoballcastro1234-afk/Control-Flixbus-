import {diaChile,json} from "../lib/dia";
import type {Sesion} from "./auth";
interface Env {GPS_CACHE?:KVNamespace;GPS_ENABLED?:string}
export const onRequestGet:PagesFunction<Env,string,{sesion:Sesion|null}>=async({env,data})=>{
 if(!data.sesion)return json({error:"No autenticado"},401);
 if(env.GPS_ENABLED!=="true"||!env.GPS_CACHE)return json({habilitado:false});
 try {
  const snapshot=await env.GPS_CACHE.get<{fecha:string;actualizado:number;rows:unknown[]}>("actual","json");
  const age=snapshot?Date.now()-snapshot.actualizado:Infinity;
  if(!snapshot||snapshot.fecha!==diaChile().fecha||!Number.isFinite(age)||age<0||age>=600000||!Array.isArray(snapshot.rows))return json({habilitado:true,disponible:false});
  return json({habilitado:true,disponible:true,...snapshot});
 }catch{return json({habilitado:true,disponible:false});}
};
