const socket = io();

// --- STATE ---
let myPlayerId = null;
let currentRoles = {}; // Stores { 'Werewolf': 2, 'Seer': 1 }
let totalSelected = 0;
let requiredRoles = 0;

// Available roles to choose from
const AVAILABLE_ROLES = [
    'Werewolf', 'Minion', 'Seer', 'Robber', 'Troublemaker', 
    'Insomniac', 'Drunk', 'Villager', 'Mason', 'Hunter'
];

// --- DOM ELEMENTS ---
const screens = {
    login: document.getElementById('loginScreen'),
    lobby: document.getElementById('lobbyScreen'),
    night: document.getElementById('nightScreen'),
    day: document.getElementById('dayScreen'),
    result: document.getElementById('resultScreen')
};

const elements = {
    username: document.getElementById('username'),
    roomId: document.getElementById('roomId'),
    joinBtn: document.getElementById('joinBtn'),
    playerList: document.getElementById('playerList'),
    hostControls: document.getElementById('hostControls'),
    roleSelectorContainer: document.getElementById('roleSelectorContainer'),
    requiredCount: document.getElementById('requiredCount'),
    currentCount: document.getElementById('currentCount'),
    startBtn: document.getElementById('startBtn'),
    waitingMsg: document.getElementById('waitingMsg'),
    lobbyRoomName: document.getElementById('lobbyRoomName'),
    // Game screens
    nightStatus: document.getElementById('nightStatus'),
    actionArea: document.getElementById('actionArea'),
    targetButtons: document.getElementById('targetButtons'),
    logBox: document.getElementById('logBox'),
    voteButtons: document.getElementById('voteButtons'),
    finalList: document.getElementById('finalList'),
    winnerDisplay: document.getElementById('winnerDisplay')
};

// --- UTILS ---
function showScreen(name) {
    Object.values(screens).forEach(el => el.classList.add('hidden'));
    screens[name].classList.remove('hidden');
}

function log(msg) {
    const d = document.createElement('div');
    d.innerText = `> ${msg}`;
    elements.logBox.appendChild(d);
    elements.logBox.scrollTop = elements.logBox.scrollHeight;
}

// --- 1. LOBBY & ROLE SELECTOR ---
elements.joinBtn.onclick = () => {
    const name = elements.username.value || "Player";
    const roomId = elements.roomId.value;
    socket.emit('join_game', { name, roomId });
    elements.lobbyRoomName.innerText = roomId;
    showScreen('lobby');
    renderRoleSelector(); // Draw the +/- buttons
};

socket.on('player_list_update', (players) => {
    elements.playerList.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.innerText = p.name + (p.id === socket.id ? " (You)" : "");
        elements.playerList.appendChild(li);
    });

    // Update Requirement Math
    requiredRoles = players.length + 3;
    elements.requiredCount.innerText = requiredRoles;
    updateStartButton();

    // Host Check
    if (players[0].id === socket.id) {
        elements.hostControls.classList.remove('hidden');
        elements.waitingMsg.classList.add('hidden');
    } else {
        elements.hostControls.classList.add('hidden');
        elements.waitingMsg.classList.remove('hidden');
    }
});

function renderRoleSelector() {
    elements.roleSelectorContainer.innerHTML = '';
    
    AVAILABLE_ROLES.forEach(role => {
        currentRoles[role] = 0; // Reset count
        
        const div = document.createElement('div');
        div.className = 'role-selector';
        div.innerHTML = `
            <span>${role}</span>
            <div class="role-controls">
                <button onclick="modifyRole('${role}', -1)">-</button>
                <span id="count-${role}" class="role-count">0</span>
                <button onclick="modifyRole('${role}', 1)">+</button>
            </div>
        `;
        elements.roleSelectorContainer.appendChild(div);
    });
}

// Global function for HTML buttons to call
window.modifyRole = (role, change) => {
    const newCount = currentRoles[role] + change;
    if (newCount < 0) return;
    
    currentRoles[role] = newCount;
    document.getElementById(`count-${role}`).innerText = newCount;
    
    // Recalculate total
    totalSelected = Object.values(currentRoles).reduce((a, b) => a + b, 0);
    elements.currentCount.innerText = totalSelected;
    updateStartButton();
};

function updateStartButton() {
    // Only enable start if counts match exactly
    if (totalSelected === requiredRoles) {
        elements.startBtn.disabled = false;
        elements.startBtn.innerText = "Start Game";
        elements.currentCount.style.color = "#2ecc71";
    } else {
        elements.startBtn.disabled = true;
        elements.startBtn.innerText = `Select ${requiredRoles - totalSelected} more`;
        elements.currentCount.style.color = "#e74c3c";
    }
}

elements.startBtn.onclick = () => {
    // Convert counts map {Werewolf: 2} to array ['Werewolf', 'Werewolf']
    const roleList = [];
    Object.entries(currentRoles).forEach(([role, count]) => {
        for(let i=0; i<count; i++) roleList.push(role);
    });
    
    socket.emit('start_game', { customRoleList: roleList });
};

// --- 2. GAME START ---
socket.on('game_roles_update', (counts) => {
    // Helper to draw badges
    const draw = (container) => {
        container.innerHTML = '<small>Roles in Play:</small><br>';
        Object.entries(counts).forEach(([role, qty]) => {
            const span = document.createElement('span');
            span.className = 'role-badge';
            if(['Werewolf','Minion'].includes(role)) span.classList.add('bad');
            span.innerText = `${role} x${qty}`;
            container.appendChild(span);
        });
    };
    draw(document.getElementById('nightRoleSummary'));
    draw(document.getElementById('dayRoleSummary'));
});

socket.on('game_start_role', (data) => {
    log(`Game Started. Role: ${data.role}`);
    document.getElementById('myRoleDisplay').innerText = data.role;
    document.getElementById('dayRoleDisplay').innerText = data.role;
    showScreen('night');
});

// --- 3. NIGHT PHASE ---
socket.on('night_announcement', (data) => {
    elements.nightStatus.innerText = `Current Turn: ${data.activeRole}...`;
    elements.actionArea.classList.add('hidden');
});

socket.on('your_turn', (data) => {
    log("Wake up!");
    elements.actionArea.classList.remove('hidden');
    elements.targetButtons.innerHTML = '';

    // Action Buttons
    data.otherPlayers.forEach(p => {
        if (p.id === socket.id) return;
        const btn = document.createElement('button');
        btn.className = 'target-btn';
        btn.innerText = `Select ${p.name}`;
        btn.onclick = () => socket.emit('night_action', { action: 'target_player', targetId: p.id });
        elements.targetButtons.appendChild(btn);
    });

    if (data.centerCardsCount > 0) {
        const btn = document.createElement('button');
        btn.className = 'target-btn';
        btn.style.background = '#8e44ad';
        btn.innerText = 'View Center';
        btn.onclick = () => socket.emit('night_action', { action: 'target_center' });
        elements.targetButtons.appendChild(btn);
    }

    // Done Button
    const done = document.createElement('button');
    done.innerText = "DONE / SLEEP";
    done.style.marginTop = "15px";
    done.style.background = "#34495e"; 
    done.onclick = () => {
        socket.emit('turn_done');
        elements.actionArea.classList.add('hidden');
    };
    elements.targetButtons.appendChild(done);
});

socket.on('action_result', (msg) => { alert(msg); log(msg); });

// --- 4. DAY & RESULTS ---
socket.on('phase_change', (ph) => {
    if (ph === 'DAY') {
        showScreen('day');
        socket.emit('get_players_for_vote');
    }
});

socket.on('vote_setup', (players) => {
    elements.voteButtons.innerHTML = '';
    players.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'vote-btn';
        btn.innerText = `Vote ${p.name}`;
        btn.onclick = () => {
            socket.emit('cast_vote', { targetId: p.id });
            elements.voteButtons.innerHTML = '<p>Vote Cast. Waiting...</p>';
        };
        elements.voteButtons.appendChild(btn);
    });
});

socket.on('game_results', (data) => {
    showScreen('result');
    elements.winnerDisplay.innerHTML = data.winner;
    elements.finalList.innerHTML = '';
    data.players.forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${p.name}</strong>: ${p.originalRole} -> ${p.role}`;
        elements.finalList.appendChild(li);
    });
});