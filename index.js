// index.js (Corrected with Redis for Vercel)

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { Redis } = require('@upstash/redis'); // Import the Upstash Redis client

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- Initialize Redis Client ---
// Vercel automatically provides these environment variables after the integration.
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

app.use(express.static(path.join(__dirname, 'public')));

// --- Game State Management (Now using Redis) ---
const LOBBY_CAPACITY = 2;

function createLobbyId() { return Math.random().toString(36).substring(2, 8); }
function generateQuestions(count = 10) { /* ... same as before ... */ }

// --- Socket.IO Event Handling (Refactored for Redis) ---
io.on('connection', (socket) => {
    socket.on('findMatch', async (username) => {
        socket.username = username;
        let joined = false;
        
        // Get all lobby IDs from Redis
        const lobbyIds = await redis.smembers('lobbies');

        for (const lobbyId of lobbyIds) {
            let lobby = await redis.get(`lobby:${lobbyId}`);
            if (lobby && lobby.players.length < LOBBY_CAPACITY && !lobby.inGame) {
                socket.join(lobbyId);
                lobby.players.push({ id: socket.id, username, score: 0 });
                await redis.set(`lobby:${lobbyId}`, lobby); // Update lobby in Redis
                
                socket.emit('joinedLobby', lobbyId, lobby.players);
                io.to(lobbyId).emit('playerUpdate', lobby.players);
                joined = true;
                
                if (lobby.players.length === LOBBY_CAPACITY) {
                    startGame(lobbyId);
                }
                break;
            }
        }

        if (!joined) {
            const lobbyId = createLobbyId();
            socket.join(lobbyId);
            const newLobby = {
                id: lobbyId,
                players: [{ id: socket.id, username, score: 0 }],
                questions: generateQuestions(),
                inGame: false,
            };
            await redis.sadd('lobbies', lobbyId); // Add new lobby ID to the set
            await redis.set(`lobby:${lobbyId}`, newLobby); // Store the new lobby object

            socket.emit('joinedLobby', lobbyId, newLobby.players);
        }
    });
    
    socket.on('submitAnswer', async ({ lobbyId, isCorrect }) => {
        let lobby = await redis.get(`lobby:${lobbyId}`);
        if (!lobby) return;
        
        const player = lobby.players.find(p => p.id === socket.id);
        if (player && isCorrect) {
            player.score += 10;
            await redis.set(`lobby:${lobbyId}`, lobby);
        }
        io.to(lobbyId).emit('playerUpdate', lobby.players);
    });

    socket.on('quizFinished', async (lobbyId) => {
        let lobby = await redis.get(`lobby:${lobbyId}`);
        if (!lobby) return;

        const player = lobby.players.find(p => p.id === socket.id);
        if (player) player.finished = true;
        
        await redis.set(`lobby:${lobbyId}`, lobby);
        
        if (lobby.players.every(p => p.finished)) {
            endGame(lobbyId);
        }
    });

    socket.on('disconnect', async () => {
        const lobbyIds = await redis.smembers('lobbies');
        for (const lobbyId of lobbyIds) {
            let lobby = await redis.get(`lobby:${lobbyId}`);
            if (!lobby) continue;

            const playerIndex = lobby.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                lobby.players.splice(playerIndex, 1);
                
                if (lobby.players.length === 0) {
                    await redis.del(`lobby:${lobbyId}`);
                    await redis.srem('lobbies', lobbyId);
                } else {
                    await redis.set(`lobby:${lobbyId}`, lobby);
                    io.to(lobbyId).emit('playerUpdate', lobby.players);
                }
                break;
            }
        }
    });
});

async function startGame(lobbyId) {
    let lobby = await redis.get(`lobby:${lobbyId}`);
    if (!lobby) return;

    lobby.inGame = true;
    await redis.set(`lobby:${lobbyId}`, lobby);
    
    let countdown = 5;
    const interval = setInterval(() => {
        io.to(lobbyId).emit('gameCountdown', countdown);
        countdown--;
        if (countdown < 0) {
            clearInterval(interval);
            io.to(lobbyId).emit('gameStart', lobby.questions);
        }
    }, 1000);
}

async function endGame(lobbyId) {
    let lobby = await redis.get(`lobby:${lobbyId}`);
    if (!lobby) return;

    const finalRanking = lobby.players.sort((a, b) => b.score - a.score);
    io.to(lobbyId).emit('tournamentOver', finalRanking);

    setTimeout(async () => {
        await redis.del(`lobby:${lobbyId}`);
        await redis.srem('lobbies', lobbyId);
    }, 15000);
}


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is live on port ${PORT}`);
});

module.exports = app;
