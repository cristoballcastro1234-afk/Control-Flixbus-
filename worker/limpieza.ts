import { limpiarDias } from "../functions/lib/dia";
export default {async scheduled(_event:ScheduledController,env:{DB:D1Database},ctx:ExecutionContext){ctx.waitUntil(limpiarDias(env.DB));}};
