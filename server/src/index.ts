import { randomInt, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import type { RawData, WebSocket } from 'ws';
import type { AnswerData, CreateGameData, Game, JoinGameData, Player, Question, StartGameData, User, WSMessage } from './types';

var users: User[] = [];
var games: Game[] = [];
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

var parseIncomingMessage = (rawMessage: RawData): WSMessage | null => {
    var rawText = '';

    if (typeof rawMessage === 'string') {
        rawText = rawMessage;
    } else if (Buffer.isBuffer(rawMessage)) {
        rawText = rawMessage.toString();
    } else if (rawMessage instanceof ArrayBuffer) {
        rawText = Buffer.from(rawMessage).toString();
    } else if (Array.isArray(rawMessage)) {
        rawText = Buffer.concat(rawMessage).toString();
    } else {
        return null;
    }

    var parsed: unknown;

    try {
        parsed = JSON.parse(rawText);
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

var getAuthorizedUser = (ws: WebSocket): User | null => {
    var userIndex = connectionToUserIndex.get(ws);

    if (!userIndex) {
        return null;
    }

    var user = users.find((item) => item.index === userIndex);

    if (!user) {
        return null;
    }

    if (user.ws !== ws) {
        return null;
    }

    return user;
};

var isValidQuestion = (value: unknown): value is Question => {
    if (!isObject(value)) {
        return false;
    }

    if (typeof value.text !== 'string' || !value.text.trim()) {
        return false;
    }

    if (!Array.isArray(value.options) || value.options.length !== 4) {
        return false;
    }

    if (
        value.options.some((option) => {
            return typeof option !== 'string' || !option.trim();
        })
    ) {
        return false;
    }

    if (
        typeof value.correctIndex !== 'number' ||
        !Number.isInteger(value.correctIndex) ||
        value.correctIndex < 0 ||
        value.correctIndex > 3
    ) {
        return false;
    }

    if (
        typeof value.timeLimitSec !== 'number' ||
        !Number.isInteger(value.timeLimitSec) ||
        value.timeLimitSec < 1
    ) {
        return false;
    }

    return true;
};

var getCreateGamePayload = (data: unknown): CreateGameData | null => {
    if (!isObject(data)) {
        return null;
    }

    if (!Array.isArray(data.questions) || data.questions.length < 1) {
        return null;
    }

    var normalizedQuestions: Question[] = [];

    for (var i = 0; i < data.questions.length; i += 1) {
        var question = data.questions[i];

        if (!isValidQuestion(question)) {
            return null;
        }

        normalizedQuestions.push({
            text: question.text.trim(),
            options: question.options.map((option) => option.trim()),
            correctIndex: question.correctIndex,
            timeLimitSec: question.timeLimitSec
        });
    }

    return {
        questions: normalizedQuestions
    };
};

var getJoinGamePayload = (data: unknown): JoinGameData | null => {
    if (!isObject(data)) {
        return null;
    }

    if (typeof data.code !== 'string') {
        return null;
    }

    var code = data.code.trim().toUpperCase();

    if (!code || code.length !== 6) {
        return null;
    }

    return {
        code: code
    };
};

var getStartGamePayload = (data: unknown): StartGameData | null => {
    if (!isObject(data)) {
        return null;
    }

    if (typeof data.gameId !== 'string') {
        return null;
    }

    var gameId = data.gameId.trim();

    if (!gameId) {
        return null;
    }

    return {
        gameId: gameId
    };
};

var getAnswerPayload = (data: unknown): AnswerData | null => {
    if (!isObject(data)) {
        return null;
    }

    if (
        typeof data.gameId !== 'string' ||
        typeof data.questionIndex !== 'number' ||
        typeof data.answerIndex !== 'number'
    ) {
        return null;
    }

    var gameId = data.gameId.trim();
    var questionIndex = data.questionIndex;
    var answerIndex = data.answerIndex;

    if (!gameId) {
        return null;
    }

    if (!Number.isInteger(questionIndex) || questionIndex < 0) {
        return null;
    }

    if (!Number.isInteger(answerIndex) || answerIndex < 0) {
        return null;
    }

    return {
        gameId: gameId,
        questionIndex: questionIndex,
        answerIndex: answerIndex
    };
};

var generateRoomCode = () => {
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var code = '';
    var isUnique = false;

    while (!isUnique) {
        code = '';

        for (var i = 0; i < 6; i += 1) {
            code += alphabet[randomInt(0, alphabet.length)];
        }

        isUnique = !games.some((game) => game.code === code);
    }

    return code;
};

var getGameRecipients = (game: Game) => {
    var recipients: WebSocket[] = [];

    var host = users.find((user) => user.index === game.hostId);

    if (host && host.ws) {
        recipients.push(host.ws);
    }

    game.players.forEach((player) => {
        if (player.ws && !recipients.includes(player.ws)) {
            recipients.push(player.ws);
        }
    });

    return recipients;
};

var broadcastToGame = (game: Game, payload: WSMessage) => {
    var recipients = getGameRecipients(game);

    recipients.forEach((client) => {
        send(client, payload);
    });
};

var broadcastPlayersUpdate = (game: Game) => {
    broadcastToGame(game, {
        type: 'update_players',
        data: game.players.map((player) => {
            return {
                name: player.name,
                index: player.index,
                score: player.score
            };
        }),
        id: 0
    });
};

var broadcastCurrentQuestion = (game: Game) => {
    var question = game.questions[game.currentQuestion];

    if (!question) {
        return;
    }

    broadcastToGame(game, {
        type: 'question',
        data: {
            questionNumber: game.currentQuestion + 1,
            totalQuestions: game.questions.length,
            text: question.text,
            options: question.options,
            timeLimitSec: question.timeLimitSec
        },
        id: 0
    });
};

var clearQuestionTimer = (game: Game) => {
    if (game.questionTimer) {
        clearTimeout(game.questionTimer);
        game.questionTimer = undefined;
    }
};

var buildScoreboard = (game: Game) => {
    var sortedPlayers = game.players.slice().sort((a, b) => b.score - a.score);

    return sortedPlayers.map((player, index) => {
        return {
            name: player.name,
            score: player.score,
            rank: index + 1
        };
    });
};

var finishGame = (game: Game) => {
    clearQuestionTimer(game);
    game.status = 'finished';
    game.questionStartTime = undefined;
    game.playerAnswers.clear();

    broadcastToGame(game, {
        type: 'game_finished',
        data: {
            scoreboard: buildScoreboard(game)
        },
        id: 0
    });
};

var finishCurrentQuestion = (game: Game) => {
    if (game.status !== 'in_progress') {
        return;
    }

    if (typeof game.questionStartTime !== 'number') {
        return;
    }

    var questionIndex = game.currentQuestion;
    var question = game.questions[questionIndex];

    if (!question) {
        return;
    }

    var startedAt = game.questionStartTime;
    var timeLimitMs = question.timeLimitSec * 1000;

    clearQuestionTimer(game);
    game.questionStartTime = undefined;

    var playerResults = game.players.map((player) => {
        var answer = game.playerAnswers.get(player.index);
        var answered = Boolean(answer);
        var correct = false;
        var pointsEarned = 0;

        if (answer) {
            correct = answer.answerIndex === question.correctIndex;

            if (correct) {
                var elapsedMs = answer.timestamp - startedAt;

                if (elapsedMs < 0) {
                    elapsedMs = 0;
                }

                if (elapsedMs > timeLimitMs) {
                    elapsedMs = timeLimitMs;
                }

                var timeRemainingMs = timeLimitMs - elapsedMs;

                pointsEarned = Math.round((1000 * timeRemainingMs) / timeLimitMs);
                player.score += pointsEarned;
            }
        }

        player.hasAnswered = answered;
        player.answerTime = answer ? answer.timestamp : 0;
        player.answeredCorrectly = correct;

        return {
            name: player.name,
            answered: answered,
            correct: correct,
            pointsEarned: pointsEarned,
            totalScore: player.score
        };
    });

    broadcastToGame(game, {
        type: 'question_result',
        data: {
            questionIndex: questionIndex,
            correctIndex: question.correctIndex,
            playerResults: playerResults
        },
        id: 0
    });

    game.playerAnswers.clear();

    var nextQuestionIndex = questionIndex + 1;

    if (nextQuestionIndex < game.questions.length) {
        setTimeout(() => {
            startQuestion(game, nextQuestionIndex);
        }, 3000);
    } else {
        setTimeout(() => {
            finishGame(game);
        }, 3000);
    }
};

var startQuestion = (game: Game, questionIndex: number) => {
    if (game.status !== 'in_progress') {
        return;
    }

    var question = game.questions[questionIndex];

    if (!question) {
        return;
    }

    clearQuestionTimer(game);

    game.currentQuestion = questionIndex;
    game.questionStartTime = Date.now();
    game.playerAnswers.clear();

    game.players.forEach((player) => {
        player.hasAnswered = false;
        player.answerTime = 0;
        player.answeredCorrectly = false;
    });

    broadcastToGame(game, {
        type: 'question',
        data: {
            questionNumber: questionIndex + 1,
            totalQuestions: game.questions.length,
            text: question.text,
            options: question.options,
            timeLimitSec: question.timeLimitSec
        },
        id: 0
    });

    var currentGameId = game.id;
    var currentQuestionIndex = questionIndex;

    game.questionTimer = setTimeout(() => {
        var freshGame = games.find((item) => item.id === currentGameId);

        if (!freshGame) {
            return;
        }

        if (freshGame.status !== 'in_progress') {
            return;
        }

        if (freshGame.currentQuestion !== currentQuestionIndex) {
            return;
        }

        finishCurrentQuestion(freshGame);
    }, question.timeLimitSec * 1000);
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

var handleCreateGame = (ws: WebSocket, message: WSMessage) => {
    var user = getAuthorizedUser(ws);

    if (!user) {
        sendError(ws, 'You must register first');
        return;
    }

    var payload = getCreateGamePayload(message.data);

    if (!payload) {
        sendError(ws, 'Invalid questions payload');
        return;
    }

    var newGame: Game = {
        id: randomUUID(),
        code: generateRoomCode(),
        hostId: user.index,
        questions: payload.questions,
        players: [],
        currentQuestion: -1,
        status: 'waiting',
        playerAnswers: new Map()
    };

    games.push(newGame);

    send(ws, {
        type: 'game_created',
        data: {
            gameId: newGame.id,
            code: newGame.code
        },
        id: 0
    });
};

var handleJoinGame = (ws: WebSocket, message: WSMessage) => {
    var user = getAuthorizedUser(ws);

    if (!user) {
        sendError(ws, 'You must register first');
        return;
    }

    var payload = getJoinGamePayload(message.data);

    if (!payload) {
        sendError(ws, 'Invalid join payload');
        return;
    }

    var userIndex = user.index;
    var userName = user.name;
    var code = payload.code;

    var game = games.find((item) => item.code === code);

    if (!game) {
        sendError(ws, 'Game not found');
        return;
    }

    if (game.status !== 'waiting') {
        sendError(ws, 'Game already started');
        return;
    }

    if (game.hostId === userIndex) {
        sendError(ws, 'Host cannot join as player');
        return;
    }

    var existingPlayer = game.players.find((player) => player.index === userIndex);

    if (existingPlayer) {
        existingPlayer.ws = ws;

        send(ws, {
            type: 'game_joined',
            data: {
                gameId: game.id
            },
            id: 0
        });

        broadcastPlayersUpdate(game);
        return;
    }

    var player: Player = {
        name: userName,
        index: userIndex,
        score: 0,
        ws: ws,
        hasAnswered: false,
        answerTime: 0,
        answeredCorrectly: false
    };

    game.players.push(player);

    send(ws, {
        type: 'game_joined',
        data: {
            gameId: game.id
        },
        id: 0
    });

    broadcastToGame(game, {
        type: 'player_joined',
        data: {
            playerName: player.name,
            playerCount: game.players.length
        },
        id: 0
    });

    broadcastPlayersUpdate(game);
};

var handleStartGame = (ws: WebSocket, message: WSMessage) => {
    var user = getAuthorizedUser(ws);

    if (!user) {
        sendError(ws, 'You must register first');
        return;
    }

    var payload = getStartGamePayload(message.data);

    if (!payload) {
        sendError(ws, 'Invalid start_game payload');
        return;
    }

    var userIndex = user.index;
    var gameId = payload.gameId;

    var game = games.find((item) => item.id === gameId);

    if (!game) {
        sendError(ws, 'Game not found');
        return;
    }

    if (game.hostId !== userIndex) {
        sendError(ws, 'Only host can start the game');
        return;
    }

    if (game.status !== 'waiting') {
        sendError(ws, 'Game already started or finished');
        return;
    }

    if (game.questions.length < 1) {
        sendError(ws, 'Game has no questions');
        return;
    }

    game.status = 'in_progress';
    startQuestion(game, 0);
};

var handleAnswer = (ws: WebSocket, message: WSMessage) => {
    var user = getAuthorizedUser(ws);

    if (!user) {
        sendError(ws, 'You must register first');
        return;
    }

    var payload = getAnswerPayload(message.data);

    if (!payload) {
        sendError(ws, 'Invalid answer payload');
        return;
    }

    var userIndex = user.index;
    var gameId = payload.gameId;
    var questionIndex = payload.questionIndex;
    var answerIndex = payload.answerIndex;

    var game = games.find((item) => item.id === gameId);

    if (!game) {
        sendError(ws, 'Game not found');
        return;
    }

    if (game.status !== 'in_progress') {
        sendError(ws, 'Game is not in progress');
        return;
    }

    if (game.currentQuestion !== questionIndex) {
        sendError(ws, 'Invalid question index');
        return;
    }

    var player = game.players.find((item) => item.index === userIndex);

    if (!player) {
        sendError(ws, 'Only players can answer');
        return;
    }

    if (game.playerAnswers.has(userIndex) || player.hasAnswered) {
        sendError(ws, 'Answer already submitted');
        return;
    }

    var question = game.questions[game.currentQuestion];

    if (!question) {
        sendError(ws, 'Question not found');
        return;
    }

    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) {
        sendError(ws, 'Invalid answer index');
        return;
    }

    var startedAt = game.questionStartTime;

    if (typeof startedAt !== 'number') {
        sendError(ws, 'Question is not active');
        return;
    }

    var timestamp = Date.now();
    var deadline = startedAt + question.timeLimitSec * 1000;

    if (timestamp > deadline) {
        sendError(ws, 'Time is up');
        return;
    }

    game.playerAnswers.set(userIndex, {
        answerIndex: answerIndex,
        timestamp: timestamp
    });

    player.hasAnswered = true;
    player.answerTime = timestamp;
    player.answeredCorrectly = answerIndex === question.correctIndex;

    send(ws, {
        type: 'answer_accepted',
        data: {
            questionIndex: questionIndex
        },
        id: 0
    });

    var allPlayersAnswered =
        game.players.length > 0 &&
        game.players.every((item) => item.hasAnswered === true);

    if (allPlayersAnswered) {
        finishCurrentQuestion(game);
    }
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
        } else if (parsed.type === 'create_game') {
            handleCreateGame(ws, parsed);
            return;
        } else if (parsed.type === 'join_game') {
            handleJoinGame(ws, parsed);
            return;
        } else if (parsed.type === 'start_game') {
            handleStartGame(ws, parsed);
            return;
        } else if (parsed.type === 'answer') {
            handleAnswer(ws, parsed);
            return;
        } else {
            sendError(ws, 'Unknown message type');
            return;
        }
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

        games.forEach((game) => {
            var player = game.players.find((item) => item.index === userIndex);

            if (player && player.ws === ws) {
                player.ws = undefined;
            }
        });

        connectionToUserIndex.delete(ws);
        console.log('Client disconnected');
    });

    ws.on('error', (err) => {
        console.error(err);
    });
});