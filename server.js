const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname)));

const games = {}; 

// The Master List: Defines the order they wake up.
const MASTER_NIGHT_ORDER = [
    'Doppelganger', 'Werewolf', 'Minion', 'Mason', 'Seer', 
    'Robber', 'Troublemaker', 'Drunk', 'Insomniac'
];

io.on('connection', (socket) => {
    let currentRoomId = null;

    // --- JOIN & LOBBY ---
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

        // Prevent duplicate names
        const isDuplicate = game.players.find(p => p.name === name);
        if (isDuplicate) {
            if (callback) callback({ error: "Name already taken" });
            return; 
        }

        game.players.push({ id: socket.id, name, role: null, originalRole: null });
        io.to(roomId).emit('player_list_update', game.players);
        
        if (callback) callback({ success: true });
    });

    // --- START GAME ---
    socket.on('start_game', ({ customRoleList }) => {
        const game = games[currentRoomId];
        if (!game) return;

        const playerCount = game.players.length;
        
        // Validation
        if (!customRoleList || customRoleList.length !== playerCount + 3) {
            io.to(currentRoomId).emit('action_result', `Error: Need exactly ${playerCount + 3} roles.`);
            return;
        }

        console.log(`Starting game in ${currentRoomId} with: ${customRoleList.join(', ')}`);

        // Notify Clients of roles
        const roleCounts = {};
        customRoleList.forEach(r => roleCounts[r] = (roleCounts[r] || 0) + 1);
        io.to(currentRoomId).emit('game_roles_update', roleCounts);

        // Shuffle & Assign
        const shuffled = customRoleList.sort(() => 0.5 - Math.random());
        game.players.forEach((p, i) => {
            p.role = shuffled[i];
            p.originalRole = shuffled[i];
            io.to(p.id).emit('game_start_role', { role: p.role });
        });
        game.centerCards = shuffled.slice(playerCount);

        // Build Night Schedule (Only include roles that are actually in play)
        game.nightSchedule = MASTER_NIGHT_ORDER.filter(role => customRoleList.includes(role));

        // Start Night
        game.state = 'NIGHT';
        game.nightIndex = 0;
        startNightTurn(currentRoomId);
    });

    // --- NIGHT ACTIONS ---
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

    // --- VOTING ---
    socket.on('get_players_for_vote', () => {
        const game = games[currentRoomId];
        if(game) io.to(socket.id).emit('vote_setup', game.players);
    });

    socket.on('cast_vote', ({ targetId }) => {
        const game = games[currentRoomId];
        if (!game) return;
        
        game.votes[socket.id] = targetId;
        
        // Check if everyone voted
        if (Object.keys(game.votes).length === game.players.length) {
            finishGame(currentRoomId);
        }
    });
    
    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        const game = games[currentRoomId];
        if (!game) return;

        const isHost = (game.players.length > 0 && game.players[0].id === socket.id);

        if (isHost) {
            io.to(currentRoomId).emit('force_game_end', "Host disconnected.");
            delete games[currentRoomId];
        } else {
            game.players = game.players.filter(p => p.id !== socket.id);
            if (game.state === 'LOBBY') {
                io.to(currentRoomId).emit('player_list_update', game.players);
            } else if (game.state === 'NIGHT') {
                game.waitingFor = game.waitingFor.filter(id => id !== socket.id);
                if (game.waitingFor.length === 0) advanceNightTurn(currentRoomId);
            }
        }
    });
});

// --- GAME LOGIC FUNCTIONS ---

function startNightTurn(roomId) {
    const game = games[roomId];
    
    // Check if night is over
    if (game.nightIndex >= game.nightSchedule.length) {
        game.state = 'DAY';
        io.to(roomId).emit('phase_change', 'DAY');
        return;
    }

    const currentRole = game.nightSchedule[game.nightIndex];
    io.to(roomId).emit('night_announcement', { activeRole: currentRole });

    // Identify players who woke up
    const activePlayers = game.players.filter(p => p.originalRole === currentRole);
    
    // Identify Lone Wolf status
    const wolves = game.players.filter(p => p.originalRole === 'Werewolf');
    const isLoneWolf = (currentRole === 'Werewolf' && wolves.length === 1);

    if (activePlayers.length > 0) {
        game.waitingFor = activePlayers.map(p => p.id);
        
        activePlayers.forEach(p => {
            io.to(p.id).emit('your_turn', { 
                role: currentRole, 
                isLoneWolf: isLoneWolf,
                centerCardsCount: 3, 
                otherPlayers: game.players.filter(pl => pl.id !== p.id)
                                          .map(pl => ({id: pl.id, name: pl.name}))
            });
        });
    } else {
        // Pseudo-wait for roles not in play to bluff timings
        setTimeout(() => advanceNightTurn(roomId), Math.random() * 4000 + 3000);
    }
}

function advanceNightTurn(roomId) {
    const game = games[roomId];
    if(!game) return;
    game.nightIndex++;
    startNightTurn(roomId);
}

function handleRoleAction(game, actorId, data) {
    const actor = game.players.find(p => p.id === actorId);
    if (!actor) return;

    // --- WEREWOLF ---
    if (actor.originalRole === 'Werewolf') {
        // If Lone Wolf, they clicked Center
        if (data.action === 'target_center') {
            const card = game.centerCards[Math.floor(Math.random() * game.centerCards.length)];
            io.to(actorId).emit('action_result', `Lone Wolf: You saw a center card: ${card}`);
        }
    }
    
    // --- MINION ---
    if (actor.originalRole === 'Minion' && data.action === 'check_wolves') {
        const wolves = game.players
            .filter(p => p.originalRole === 'Werewolf')
            .map(p => p.name);
        io.to(actorId).emit('action_result', `The Werewolves are: ${wolves.join(', ') || 'None'}`);
    }

    // --- SEER ---
    if (actor.originalRole === 'Seer') {
        if (data.action === 'target_player') {
            const target = game.players.find(p => p.id === data.targetId);
            io.to(actorId).emit('action_result', `${target.name} is the ${target.role}`);
        } else if (data.action === 'target_center') {
            const rev = [game.centerCards[0], game.centerCards[1]];
            io.to(actorId).emit('action_result', `Center Cards: ${rev.join(', ')}`);
        }
    }

    // --- ROBBER ---
    if (actor.originalRole === 'Robber' && data.action === 'target_player') {
        const target = game.players.find(p => p.id === data.targetId);
        const temp = actor.role; 
        actor.role = target.role; 
        target.role = temp;
        io.to(actorId).emit('action_result', `You stole ${target.name}'s card. You are now the ${actor.role}`);
    }

    // --- TROUBLEMAKER ---
    if (actor.originalRole === 'Troublemaker' && data.targetId1 && data.targetId2) {
        const p1 = game.players.find(p => p.id === data.targetId1);
        const p2 = game.players.find(p => p.id === data.targetId2);
        if (p1 && p2) {
            const temp = p1.role; p1.role = p2.role; p2.role = temp;
            io.to(actorId).emit('action_result', `Swapped ${p1.name} and ${p2.name}.`);
        }
    }

    // --- DRUNK ---
    if (actor.originalRole === 'Drunk' && data.action === 'target_center') {
        const centerIndex = Math.floor(Math.random() * game.centerCards.length);
        const temp = actor.role;
        actor.role = game.centerCards[centerIndex];
        game.centerCards[centerIndex] = temp;
        io.to(actorId).emit('action_result', `Swapped with Center Card. You don't know your new role.`);
    }

    // --- INSOMNIAC ---
    if (actor.originalRole === 'Insomniac' && data.action === 'check_self') {
        io.to(actorId).emit('action_result', `Your role is currently: ${actor.role}`);
    }

    // --- MASON ---
    if (actor.originalRole === 'Mason' && data.action === 'check_masons') {
         const otherMasons = game.players
            .filter(p => p.originalRole === 'Mason' && p.id !== actorId)
            .map(p => p.name);
        io.to(actorId).emit('action_result', `Other Masons: ${otherMasons.join(', ') || 'None'}`);
    }
}

function finishGame(roomId) {
    const game = games[roomId];
    
    // 1. Tally Votes
    const voteCounts = {};
    Object.values(game.votes).forEach(targetId => {
        voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
    });

    // 2. Determine Deaths (Max votes, at least 1)
    let maxVotes = 0;
    Object.values(voteCounts).forEach(c => { if(c > maxVotes) maxVotes = c; });
    
    let deadPlayerIds = [];
    if (maxVotes > 0) { // Some house rules require >1 vote, here we just say >0
        deadPlayerIds = Object.keys(voteCounts).filter(id => voteCounts[id] === maxVotes);
    }

    // 3. Determine Winner
    const wolves = game.players.filter(p => p.role === 'Werewolf');
    const deadPlayers = game.players.filter(p => deadPlayerIds.includes(p.id));
    const deadWolves = deadPlayers.filter(p => p.role === 'Werewolf');
    
    // Logic: 
    // - If Wolf dies -> Village wins.
    // - If no Wolf dies AND Wolves exist -> Wolves win.
    // - If No Wolves exist:
    //      - If nobody dies -> Village wins.
    //      - If somebody dies -> Village loses.
    
    let winner = "";
    
    if (wolves.length > 0) {
        if (deadWolves.length > 0) winner = "Village Wins! (A Werewolf died)";
        else winner = "Werewolves Win!";
    } else {
        if (deadPlayers.length === 0) winner = "Village Wins! (No Wolves, nobody died)";
        else winner = "Village Loses! (No Wolves, but you killed a Villager)";
    }

    io.to(roomId).emit('game_results', { 
        winner: winner, 
        players: game.players 
    });
}

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));