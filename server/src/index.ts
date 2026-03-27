import { WebSocketServer } from 'ws';


var PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
console.log(`Hello, websocket started at the PORT: ${PORT}`);
// WebSocket server
var wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
    console.log('Client connected');

    console.log(ws)

    ws.on('message', (message) => {
        try {
            var parsed = JSON.parse(message.toString());

            ws.send(`Your data is here: ${message.toString()}`);

            console.log(parsed);
        } catch (err) {
            console.log('Invalid JSON');

            ws.send(JSON.stringify({
                type: 'error',
                data: {
                    message: 'Invalid JSON'
                },
                id: 0
            }));
        }
    });

    ws.on('error', console.error);
});