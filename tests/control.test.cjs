const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const {DatabaseSync}=require("node:sqlite");
const js=fs.readFileSync("public/js/tablero.js","utf8");
test("El JS del tablero es sintácticamente válido",()=>{new vm.Script(js)});
test("Estados, hora de Chile y diferencia de minutos",()=>{
 const fragment=js.slice(0,js.indexOf('$("formNota").addEventListener'));
 const ctx=vm.createContext({Intl,Date,Map,Set,console,matchMedia:()=>({matches:true})});
 const checks=vm.runInContext(fragment+'\n({min:minutes("05:35"),bad:minutes("25:10"),lag:delay({horaPlan:"09:35",horaReal:"09:47"}),cancel:estado({cancelado:true}),removed:estado({eliminado:true}),out:estado({horaReal:"09:47"}),fecha:fechaChile(new Date("2026-11-22T03:10:00Z"))})',ctx);
 assert.equal(checks.min,335);assert.equal(checks.bad,null);assert.equal(checks.lag,12);assert.equal(checks.cancel,"cancelado");assert.equal(checks.removed,"eliminado");assert.equal(checks.out,"despachado");assert.equal(checks.fecha,"22-11-2026");
});
test("Migraciones SQLite, semilla de 86 horarios y auditoría diaria",()=>{
 const db=new DatabaseSync(":memory:");
 try{
 for(const f of fs.readdirSync("migrations").filter(x=>x.endsWith(".sql")&&!x.startsWith("0007")).sort())db.exec(fs.readFileSync("migrations/"+f,"utf8"));
 assert.equal(db.prepare("SELECT COUNT(*) n FROM horarios WHERE grupo='semana'").get().n,86);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM horarios WHERE grupo='domingo'").get().n,0);
 db.prepare("INSERT INTO horarios VALUES('stgo',999,'domingo','08:00','directo','sur')").run();
 assert.equal(db.prepare("SELECT COUNT(*) n FROM horarios WHERE grupo='domingo'").get().n,1);
 db.prepare("DELETE FROM horarios WHERE destino='stgo' AND slot_index=999").run();
 const insert=db.prepare("INSERT INTO turnos(fecha,destino,slot_index,hora_plan,updated_at,updated_by) VALUES(?,?,?,?,?,?)");
 insert.run("21-11-2026","stgo",0,"05:35","2026-11-21T12:00:00Z","operador1");
 insert.run("22-11-2026","stgo",1,"08:00","2026-11-22T12:00:00Z","operador2");
 db.prepare("UPDATE turnos SET bus_num='123',updated_by='operador2' WHERE fecha='22-11-2026'").run();
 const events=db.prepare("SELECT * FROM actividad_dia WHERE fecha='22-11-2026' ORDER BY id").all();
 assert.equal(events.length,2);assert.equal(JSON.parse(events[1].anterior).busNum,"");assert.equal(JSON.parse(events[1].nuevo).busNum,"123");assert.equal(events[1].usuario,"operador2");
 for(const table of ["turnos","actividad_dia"])db.prepare("DELETE FROM "+table+" WHERE (substr(fecha,7,4)||substr(fecha,4,2)||substr(fecha,1,2)) < ?").run("20261122");
 assert.equal(db.prepare("SELECT COUNT(*) n FROM turnos").get().n,1);assert.equal(db.prepare("SELECT COUNT(*) n FROM actividad_dia").get().n,2);
 }finally{db.close()}
});

test("Revisión ligera: lectura sin cambios y cambios atómicos de turnos y horarios",()=>{
 const db=new DatabaseSync(":memory:");
 try{
 for(const f of fs.readdirSync("migrations").filter(x=>x.endsWith(".sql")).sort())db.exec(fs.readFileSync("migrations/"+f,"utf8"));
 const rev=()=>db.prepare("SELECT revision FROM sync_estado WHERE id=1").get().revision;
 const initial=rev();assert.equal(rev(),initial);
 db.prepare("INSERT INTO turnos(fecha,destino,slot_index,hora_plan,updated_at,updated_by) VALUES('22-11-2026','stgo',0,'05:35','2026-11-22T12:00:00Z','operador')").run();
 assert.equal(rev(),initial+1);
 db.prepare("UPDATE turnos SET bus_num='123'").run();assert.equal(rev(),initial+2);
 db.prepare("UPDATE horarios SET tipo='directo' WHERE destino='stgo' AND slot_index=0").run();assert.equal(rev(),initial+3);
 db.prepare("DELETE FROM turnos WHERE fecha='22-11-2026'").run();assert.equal(rev(),initial+4);
 db.prepare("UPDATE sync_estado SET limpieza='22-11-2026' WHERE id=1").run();assert.equal(rev(),initial+4);
 }finally{db.close()}
});

test("Programación de domingo y metadatos fijos",()=>{
 const db=new DatabaseSync(":memory:");try{
 for(const f of fs.readdirSync("migrations").filter(x=>x.endsWith(".sql")).sort())db.exec(fs.readFileSync("migrations/"+f,"utf8"));
 const count=(destino)=>db.prepare("SELECT count(*) n FROM horarios WHERE grupo='domingo' AND destino=?").get(destino).n;
 assert.equal(count("stgo"),39);assert.equal(count("cur"),30);assert.equal(count("scrz"),5);
 assert.equal(db.prepare("SELECT count(*) n FROM horarios WHERE grupo='semana' AND destino='stgo' AND terminal='san-borja'").get().n,4);
 assert.equal(db.prepare("SELECT count(*) n FROM horarios WHERE grupo='semana' AND destino='stgo' AND tipo='indirecto'").get().n,6);
 db.exec(fs.readFileSync("migrations/0007_horarios_operativos.sql","utf8"));assert.equal(count("stgo"),39);
 }finally{db.close()}
});

test("Móvil: solo mueve salidas completas confirmadas; PC muestra todo",()=>{
 const fragment=js.slice(0,js.indexOf('$("formNota").addEventListener'));
 const ctx=vm.createContext({Intl,Date,Map,Set,console,matchMedia:()=>({matches:true})});
 const checks=vm.runInContext(fragment+`
 const r={destino:"stgo",slotIndex:1,busNum:"123",horaLlegada:"08:00",horaReal:"08:05",eliminado:false};
 const falta={...r,horaReal:""};
 const a=completo(falta),b=completo(r),c=historialVisible(r);
 serverRows.set(key(r),r);
 const d=historialVisible(r);
 anteriores=true;const e=historialVisible(r);
 serverRows.set(key(r),falta);const f=historialVisible(r);
 mobile.matches=false;const g=historialVisible(r),h=historialVisible(falta);
 ({a,b,c,d,e,f,g,h})
 `,ctx);
 assert.equal(checks.a,false);assert.equal(checks.b,true);assert.equal(checks.c,true);assert.equal(checks.d,false);assert.equal(checks.e,true);assert.equal(checks.f,false);assert.equal(checks.g,true);assert.equal(checks.h,true);
});

test("Todos en móvil ordena las salidas de distintos destinos por hora",()=>{
 const fragment=js.slice(0,js.indexOf('$("formNota").addEventListener'));
 const ctx=vm.createContext({Intl,Date,Map,Set,console,matchMedia:()=>({matches:true})});
 const checks=vm.runInContext(fragment+`
 const r=[{destino:"stgo",horaPlan:"13:20",slotIndex:19},{destino:"cur",horaPlan:"12:35",slotIndex:10},{destino:"scrz",horaPlan:"15:49",slotIndex:6},{destino:"stgo",horaPlan:"9:35",slotIndex:11}];
 const sorted=ordenarServicios(r);
 const all=filasDelGrupo(sorted,"todos").map(x=>x.horaPlan).join(",");
 const cur=filasDelGrupo(sorted,"cur").map(x=>x.horaPlan).join(",");
 const mobileAll=cronologicoMovil();selected="cur";const mobileSelected=cronologicoMovil();
 selected="";printing=true;const printAll=cronologicoMovil();printing=false;mobile.matches=false;const pc=cronologicoMovil();
 ({all,cur,mobileAll,mobileSelected,printAll,pc})
 `,ctx);
 assert.equal(checks.all,"9:35,12:35,13:20,15:49");assert.equal(checks.cur,"12:35");
 assert.equal(checks.mobileAll,true);assert.equal(checks.mobileSelected,false);assert.equal(checks.printAll,false);assert.equal(checks.pc,false);
});
