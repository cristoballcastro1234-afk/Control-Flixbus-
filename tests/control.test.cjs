const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const {DatabaseSync}=require("node:sqlite");
const js=fs.readFileSync("public/js/tablero.js","utf8");
test("El JS del tablero es sintácticamente válido",()=>{new vm.Script(js)});
test("Estados, hora de Chile y diferencia de minutos",()=>{
 const fragment=js.slice(0,js.indexOf('$("formNota").addEventListener'));
 const ctx=vm.createContext({Intl,Date,Map,Set,console});
 const checks=vm.runInContext(fragment+'\n({min:minutes("05:35"),bad:minutes("25:10"),lag:delay({horaPlan:"09:35",horaReal:"09:47"}),cancel:estado({cancelado:true}),removed:estado({eliminado:true}),out:estado({horaReal:"09:47"}),fecha:fechaChile(new Date("2026-11-22T03:10:00Z"))})',ctx);
 assert.equal(checks.min,335);assert.equal(checks.bad,null);assert.equal(checks.lag,12);assert.equal(checks.cancel,"cancelado");assert.equal(checks.removed,"eliminado");assert.equal(checks.out,"despachado");assert.equal(checks.fecha,"22-11-2026");
});
test("Migraciones SQLite, semilla de 86 horarios y auditoría diaria",()=>{
 const db=new DatabaseSync(":memory:");
 try{
 for(const f of fs.readdirSync("migrations").filter(x=>x.endsWith(".sql")).sort())db.exec(fs.readFileSync("migrations/"+f,"utf8"));
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
