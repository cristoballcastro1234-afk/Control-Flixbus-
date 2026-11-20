import type {Sesion} from "./auth";
import type {Oficina,PilotoEnv} from "../lib/oficinas";
export const onRequestGet:PagesFunction<PilotoEnv,string,{sesion:Sesion|null;office:Oficina}>=async({env,data,request})=>{
 if(!data.sesion)return new Response("No autenticado",{status:401});
 if(request.headers.get("Origin")!==new URL(request.url).origin)return new Response("Origen inválido",{status:403});
 if(request.headers.get("Upgrade")?.toLowerCase()!=="websocket"||!env.REALTIME)return new Response("No disponible",{status:503});
 return env.REALTIME.get(env.REALTIME.idFromName(data.office)).fetch("https://interno/conectar",{headers:{Upgrade:"websocket"}});
};
