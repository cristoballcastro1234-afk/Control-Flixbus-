// Binding interno de Pages; no se envían registros ni datos de buses.
export class OfficeHub {
 constructor(state){this.state=state;state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping","pong"))}
 async fetch(request){
  const path=new URL(request.url).pathname;
  if(path==="/conectar"&&request.headers.get("Upgrade")?.toLowerCase()==="websocket"){
   const pair=new WebSocketPair(),client=pair[0],server=pair[1];
   this.state.acceptWebSocket(server);server.serializeAttachment({expires:Date.now()+15*60000});
   return new Response(null,{status:101,webSocket:client});
  }
  if(path==="/notificar"&&request.method==="POST"){
   for(const ws of this.state.getWebSockets()){
    try{if((ws.deserializeAttachment()?.expires||0)<=Date.now())ws.close(1000,"Renovar");else ws.send("cambio")}catch{}
   }
   return new Response(null,{status:204});
  }
  return new Response("Not found",{status:404});
 }
 webSocketMessage(ws){try{ws.close(1008,"Mensaje no permitido")}catch{}}
 webSocketClose(ws,code){try{if(code===1006)ws.close();else ws.close(code)}catch{}}
 webSocketError(ws){try{ws.close(1011,"Error")}catch{}}
}
export default {fetch(){return new Response("Not found",{status:404})}};
