const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve all the files in the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// --- Game State Management ---
let lobbies = {}; 
const LOBBY_CAPACITY = 2; // 2-Player Duels

function createLobbyId() { return Math.random().toString(36).substring(2, 8); }

function generateQuestions(count = 10) {
    const questions = [];
    const operations = ['+', '-', '×', '÷'];
    for (let i = 0; i < count; i++) {
        const op = operations[Math.floor(Math.random() * 4)];
        let a, b, answer;
        switch (op) {
            case '+': a = Math.floor(Math.random()*20)+1; b = Math.floor(Math.random()*20)+1; answer = a+b; questions.push({ text: `${a} + ${b} = ?`, answer }); break;
            case '-': a = Math.floor(Math.random()*30)+10; b = Math.floor(Math.random()*a)+1; answer = a-b; questions.push({ text: `${a} - ${b} = ?`, answer }); break;
            case '×': a = Math.floor(Math.random()*10)+2; b = Math.floor(Math.random()*10)+2; answer = a*b; questions.push({ text: `${a} × ${b} = ?`, answer }); break;
            case '÷': answer = Math.floor(Math.random()*10)+2; b = Math.floor(Math.random()*10)+2; a = b*answer; questions.push({ text: `${a} ÷ ${b} = ?`, answer }); break;
        }
    }
    return questions;
}

// --- Socket.IO Event Handling ---
io.on('connection', (socket) => {
    socket.on('findMatch', (username) => {
        socket.username = username;
        let joined = false;
        for (const lobbyId in lobbies) {
            const lobby = lobbies[lobbyId];
            if (lobby.players.length < LOBBY_CAPACITY && !lobby.inGame) {
                socket.join(lobbyId);
                lobby.players.push({ id: socket.id, username: username, score: 0 });
                socket.emit('joinedLobby', lobbyId, lobby.players);
                io.to(lobbyId).emit('playerUpdate', lobby.players);
                joined = true;
                if (lobby.players.length === LOBBY_CAPACITY) startGame(lobbyId);
                break;
            }
        }
        if (!joined) {
            const lobbyId = createLobbyId();
            socket.join(lobbyId);
            lobbies[lobbyId] = { id: lobbyId, players: [{ id: socket.id, username: username, score: 0 }], questions: generateQuestions(), inGame: false };
            socket.emit('joinedLobby', lobbyId, lobbies[lobbyId].players);
        }
    });
    
    socket.on('submitAnswer', ({ lobbyId, isCorrect }) => {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;
        const player = lobby.players.find(p => p.id === socket.id);
        if (player && isCorrect) player.score += 10;
        io.to(lobbyId).emit('playerUpdate', lobby.players);
    });

    socket.on('quizFinished', (lobbyId) => {
        const lobby = lobbies[lobbyId];
        if (!lobby) return;
        const player = lobby.players.find(p => p.id === socket.id);
        if (player) player.finished = true;
        if (lobby.players.every(p => p.finished)) endGame(lobbyId);
    });

    socket.on('disconnect', () => {
        for (const lobbyId in lobbies) {
            const lobby = lobbies[lobbyId];
            const playerIndex = lobby.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                lobby.players.splice(playerIndex, 1);
                if (lobby.players.length === 0) { delete lobbies[lobbyId]; } 
                else {
                    io.to(lobbyId).emit('playerUpdate', lobby.players);
                    if (lobby.inGame && lobby.players.every(p => p.finished)) endGame(lobbyId);
                }
                break;
            }
        }
    });
});

function startGame(lobbyId) {
    const lobby = lobbies[lobbyId];
    lobby.inGame = true;
    let countdown = 5;
    const interval = setInterval(() => {
        io.to(lobbyId).emit('gameCountdown', countdown);
        countdown--;
        if (countdown < 0) { clearInterval(interval); io.to(lobbyId).emit('gameStart', lobby.questions); }
    }, 1000);
}

function endGame(lobbyId) {
    const lobby = lobbies[lobbyId];
    if (!lobby) return;
    const finalRanking = lobby.players.sort((a, b) => b.score - a.score);
    io.to(lobbyId).emit('tournamentOver', finalRanking);
    setTimeout(() => { delete lobbies[lobbyId]; }, 15000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is live on port ${PORT}`);
});

// Export the app for Vercel's serverless environment
module.exports = app;
