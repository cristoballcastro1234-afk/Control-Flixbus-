import { limpiarDias } from "../functions/lib/dia";
import { OFICINAS,baseOficina,type Oficina,type PilotoEnv } from "../functions/lib/oficinas";
export default {async scheduled(_event:ScheduledController,env:PilotoEnv,ctx:ExecutionContext){ctx.waitUntil(Promise.all(Object.keys(OFICINAS).map(async o=>{const db=baseOficina(env,o as Oficina);if(db)await limpiarDias(db)})));}};
