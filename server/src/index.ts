import { WebSocketServer } from 'ws';


var PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
console.log("Hello");
// WebSocket server
var wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', (message) => {
    var parsed = JSON.parse(message.toString());

    console.log(parsed);
  });
});