import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { User, WSMessage } from './types';

var users: User[] = [];
var userIdCounter = 1;
var connectionToUserIndex = new WeakMap<WebSocket, string>();

var PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
console.log(`Hello, websocket started at the PORT: ${PORT}`);

var wss = new WebSocketServer({ port: PORT });

var isObject = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};

var send = (ws: WebSocket, payload: WSMessage) => {
    try {
        ws.send(JSON.stringify(payload));
    } catch (err) {
        console.error('Failed to send message', err);
    }
};

var sendError = (ws: WebSocket, message: string) => {
    send(ws, {
        type: 'error',
        data: {
            message: message
        },
        id: 0
    });
};

var sendRegResponse = (
    ws: WebSocket,
    name: string,
    index: string | null,
    error: boolean,
    errorText: string
) => {
    send(ws, {
        type: 'reg',
        data: {
            name: name,
            index: index,
            error: error,
            errorText: errorText
        },
        id: 0
    });
};

var parseIncomingMessage = (rawMessage: unknown): WSMessage | null => {
    if (typeof rawMessage !== 'string' && !Buffer.isBuffer(rawMessage)) {
        return null;
    }

    var parsed: unknown;

    try {
        parsed = JSON.parse(rawMessage.toString());
    } catch {
        return null;
    }

    if (!isObject(parsed)) {
        return null;
    }

    if (typeof parsed.type !== 'string') {
        return null;
    }

    if (!('data' in parsed)) {
        return null;
    }

    if (typeof parsed.id !== 'number') {
        return null;
    }

    return {
        type: parsed.type,
        data: parsed.data,
        id: parsed.id
    };
};

var getNormalizedCredentials = (data: unknown) => {
    if (!isObject(data)) {
        return null;
    }

    if (typeof data.name !== 'string' || typeof data.password !== 'string') {
        return null;
    }

    var name = data.name.trim();
    var password = data.password.trim();

    if (!name || !password) {
        return null;
    }

    return {
        name: name,
        password: password
    };
};

var handleReg = (ws: WebSocket, message: WSMessage) => {
    var credentials = getNormalizedCredentials(message.data);

    if (!credentials) {
        sendRegResponse(ws, '', null, true, 'Invalid payload');
        return;
    }

    var name = credentials.name;
    var password = credentials.password;

    var currentUserIndex = connectionToUserIndex.get(ws);

    if (currentUserIndex) {
        var currentUser = users.find((user) => user.index === currentUserIndex);

        if (currentUser && currentUser.name !== name) {
            sendRegResponse(ws, name, null, true, 'This connection is already authorized');
            return;
        }
    }

    var existingUser = users.find((user) => user.name === name);

    if (!existingUser) {
        var newUser: User = {
            name: name,
            password: password,
            index: String(userIdCounter++),
            ws: ws
        };

        users.push(newUser);
        connectionToUserIndex.set(ws, newUser.index);

        sendRegResponse(ws, newUser.name, newUser.index, false, '');
        return;
    }

    if (existingUser.password !== password) {
        sendRegResponse(ws, name, null, true, 'Wrong password');
        return;
    }

    if (existingUser.ws && existingUser.ws !== ws) {
        connectionToUserIndex.delete(existingUser.ws);
    }

    existingUser.ws = ws;
    connectionToUserIndex.set(ws, existingUser.index);

    sendRegResponse(ws, existingUser.name, existingUser.index, false, '');
};

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (message) => {
        var parsed = parseIncomingMessage(message);

        if (!parsed) {
            sendError(ws, 'Invalid JSON or message shape');
            return;
        }

        if (parsed.id !== 0) {
            sendError(ws, 'Invalid message id');
            return;
        }

        if (parsed.type === 'reg') {
            handleReg(ws, parsed);
            return;
        }

        sendError(ws, 'Unknown message type');
    });

    ws.on('close', () => {
        console.log('Client disconnected');

        var userIndex = connectionToUserIndex.get(ws);

        if (!userIndex) {
            return;
        }

        var user = users.find((item) => item.index === userIndex);

        if (user && user.ws === ws) {
            user.ws = undefined;
        }

        connectionToUserIndex.delete(ws);
    });

    ws.on('error', (err) => {
        console.error(err);
    });
});