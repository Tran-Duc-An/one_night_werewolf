const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
// It MUST look like this:
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname)));

const games = {}; 

// The Master List: Defines the order they wake up.
// If a role is not in this list (like Villager), it never wakes up.
const MASTER_NIGHT_ORDER = [
    'Doppelganger', 'Werewolf', 'Minion', 'Mason', 'Seer', 
    'Robber', 'Troublemaker', 'Drunk', 'Insomniac'
];

io.on('connection', (socket) => {
    let currentRoomId = null;

   socket.on('join_game', ({ name, roomId }, callback) => {
        socket.join(roomId);
        currentRoomId = roomId;

        if (!games[roomId]) {
            games[roomId] = {
                players: [], centerCards: [], state: 'LOBBY',
                nightIndex: 0, nightSchedule: [], waitingFor: [], votes: {}
            };
        }
        const game = games[roomId];

        // CHECK: Duplicate Name
        const isDuplicate = game.players.find(p => p.name === name);
        if (isDuplicate) {
            // Send error back to client
            if (callback) callback({ error: "Name already taken in this room" });
            return; 
        }

        game.players.push({ id: socket.id, name, role: null, originalRole: null });
        io.to(roomId).emit('player_list_update', game.players);
        
        // Tell client success
        if (callback) callback({ success: true });
    });

    // --- START GAME (With Custom Roles) ---
    socket.on('start_game', ({ customRoleList }) => {
        const game = games[currentRoomId];
        if (!game) return;

        const playerCount = game.players.length;
        
        // 1. Validate the deck
        if (!customRoleList || customRoleList.length !== playerCount + 3) {
            io.to(currentRoomId).emit('action_result', `Error: Need exactly ${playerCount + 3} roles.`);
            return;
        }

        console.log(`Starting game with deck: ${customRoleList.join(', ')}`);

        // 2. Notify Clients of the selected roles (for the Badge display)
        const roleCounts = {};
        customRoleList.forEach(r => roleCounts[r] = (roleCounts[r] || 0) + 1);
        io.to(currentRoomId).emit('game_roles_update', roleCounts);

        // 3. Shuffle & Assign
        const shuffled = customRoleList.sort(() => 0.5 - Math.random());
        game.players.forEach((p, i) => {
            p.role = shuffled[i];
            p.originalRole = shuffled[i];
            io.to(p.id).emit('game_start_role', { role: p.role });
        });
        game.centerCards = shuffled.slice(playerCount);

        // 4. Build Night Schedule based on SELECTION
        // This ensures we only run turns for roles the host actually picked.
        game.nightSchedule = MASTER_NIGHT_ORDER.filter(role => customRoleList.includes(role));

        // Start
        game.state = 'NIGHT';
        game.nightIndex = 0;
        startNightTurn(currentRoomId);
    });

    // --- NIGHT LOOP & ACTIONS ---
    socket.on('night_action', (data) => {
        const game = games[currentRoomId];
        if (game && game.state === 'NIGHT') handleRoleAction(game, socket.id, data);
    });

    socket.on('turn_done', () => {
        const game = games[currentRoomId];
        if (game) {
            game.waitingFor = game.waitingFor.filter(id => id !== socket.id);
            if (game.waitingFor.length === 0) advanceNightTurn(currentRoomId);
        }
    });

    socket.on('cast_vote', ({ targetId }) => {
        const game = games[currentRoomId];
        game.votes[socket.id] = targetId;
        if (Object.keys(game.votes).length === game.players.length) finishGame(currentRoomId);
    });
    
    // Safety Disconnect
    // --- 2. DISCONNECT (Updated to handle Host leaving) ---
    socket.on('disconnect', () => {
        const game = games[currentRoomId];
        if (!game) return;

        // CHECK: Is the disconnecting user the HOST? (Host is usually index 0)
        const isHost = (game.players.length > 0 && game.players[0].id === socket.id);

        if (isHost) {
            // Notify everyone and delete the room
            io.to(currentRoomId).emit('force_game_end', "The Host has disconnected. Game Over.");
            delete games[currentRoomId];
        } else {
            // Normal player left - remove them from list
            game.players = game.players.filter(p => p.id !== socket.id);
            
            // If game is in lobby, update the list
            if (game.state === 'LOBBY') {
                io.to(currentRoomId).emit('player_list_update', game.players);
            }
            // If game is in NIGHT, handle wait list (Your existing logic)
            else if (game.state === 'NIGHT') {
                game.waitingFor = game.waitingFor.filter(id => id !== socket.id);
                if (game.waitingFor.length === 0) advanceNightTurn(currentRoomId);
            }
        }
    });
});

function startNightTurn(roomId) {
    const game = games[roomId];
    if (game.nightIndex >= game.nightSchedule.length) {
        game.state = 'DAY';
        io.to(roomId).emit('phase_change', 'DAY');
        return;
    }

    const currentRole = game.nightSchedule[game.nightIndex];
    io.to(roomId).emit('night_announcement', { activeRole: currentRole });

    const activePlayers = game.players.filter(p => p.originalRole === currentRole);
    
    if (activePlayers.length > 0) {
        // Real players: Wait for them
        game.waitingFor = activePlayers.map(p => p.id);
        activePlayers.forEach(p => io.to(p.id).emit('your_turn', { 
            role: currentRole, centerCardsCount: 3, 
            otherPlayers: game.players.map(pl => ({id: pl.id, name: pl.name}))
        }));
    } else {
        // No players (Cards in center): Bluff wait
        setTimeout(() => advanceNightTurn(roomId), Math.random() * 3000 + 3000);
    }
}

function advanceNightTurn(roomId) {
    const game = games[roomId];
    game.nightIndex++;
    startNightTurn(roomId);
}

function handleRoleAction(game, actorId, data) {
    const actor = game.players.find(p => p.id === actorId);
    
    if (actor.originalRole === 'Robber' && data.action === 'target_player') {
        const target = game.players.find(p => p.id === data.targetId);
        const temp = actor.role; actor.role = target.role; target.role = temp;
        io.to(actorId).emit('action_result', `Swapped with ${target.name}. New Role: ${actor.role}`);
    }
    
    if (actor.originalRole === 'Seer') {
        if(data.action === 'target_player') {
            const target = game.players.find(p => p.id === data.targetId);
            io.to(actorId).emit('action_result', `${target.name} is ${target.role}`);
        } else {
            const rev = [game.centerCards[0], game.centerCards[1]];
            io.to(actorId).emit('action_result', `Center: ${rev.join(', ')}`);
        }
    }
    
    // Add other role logic (Troublemaker, Drunk, etc) here
}

function finishGame(roomId) {
    const game = games[roomId];
    // Simple win logic for demo
    io.to(roomId).emit('game_results', { winner: "Game Over", players: game.players });
}

server.listen(PORT, () => console.log(`Running on ${PORT}`));