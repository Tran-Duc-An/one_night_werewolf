const socket = io();

// --- STATE ---
let currentRoles = {}; 
let totalSelected = 0;
let requiredRoles = 0;

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
    nightStatus: document.getElementById('nightStatus'),
    actionArea: document.getElementById('actionArea'),
    targetButtons: document.getElementById('targetButtons'),
    logBox: document.getElementById('logBox'),
    voteButtons: document.getElementById('voteButtons'),
    finalList: document.getElementById('finalList'),
    winnerDisplay: document.getElementById('winnerDisplay')
};

// --- ROLE DESCRIPTIONS (for Help Modal) ---
const ROLE_DESCRIPTIONS = {
    'Werewolf': 'Wake up. If alone, view a center card. Otherwise see other wolves.',
    'Minion': 'See who the Werewolves are. Help them win.',
    'Seer': 'View another player\'s card OR two center cards.',
    'Robber': 'Swap your card with another player. View your new card.',
    'Troublemaker': 'Swap two other players\' cards without looking.',
    'Insomniac': 'Wake up and see if your role changed.',
    'Drunk': 'Swap your card with a center card blindly.',
    'Villager': 'No ability.',
    'Mason': 'Wake up and see the other Mason.',
    'Hunter': 'If you die, the person you voted for also dies.'
};

window.toggleRoleModal = () => {
    const modal = document.getElementById('roleModal');
    const list = document.getElementById('roleGuideList');
    if (modal.classList.contains('hidden')) {
        list.innerHTML = '';
        Object.entries(ROLE_DESCRIPTIONS).forEach(([role, desc]) => {
            list.innerHTML += `<div class="role-info-item"><div class="role-info-name">${role}</div><div class="role-info-desc">${desc}</div></div>`;
        });
        modal.classList.remove('hidden');
    } else {
        modal.classList.add('hidden');
    }
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

// --- LOBBY LOGIC ---
elements.joinBtn.onclick = () => {
    const name = elements.username.value || "Player";
    const roomId = elements.roomId.value || "room1";
    socket.emit('join_game', { name, roomId });
    elements.lobbyRoomName.innerText = roomId;
    showScreen('lobby');
    renderRoleSelector(); 
};

socket.on('player_list_update', (players) => {
    elements.playerList.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.innerText = p.name + (p.id === socket.id ? " (You)" : "");
        elements.playerList.appendChild(li);
    });

    requiredRoles = players.length + 3;
    elements.requiredCount.innerText = requiredRoles;
    updateStartButton();

    if (players.length > 0 && players[0].id === socket.id) {
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
        currentRoles[role] = 0;
        const div = document.createElement('div');
        div.className = 'role-selector';
        div.innerHTML = `
            <span>${role}</span>
            <div class="role-controls">
                <button onclick="modifyRole('${role}', -1)">-</button>
                <span id="count-${role}" class="role-count">0</span>
                <button onclick="modifyRole('${role}', 1)">+</button>
            </div>`;
        elements.roleSelectorContainer.appendChild(div);
    });
}

window.modifyRole = (role, change) => {
    const newCount = currentRoles[role] + change;
    if (newCount < 0) return;
    currentRoles[role] = newCount;
    document.getElementById(`count-${role}`).innerText = newCount;
    totalSelected = Object.values(currentRoles).reduce((a, b) => a + b, 0);
    elements.currentCount.innerText = totalSelected;
    updateStartButton();
};

function updateStartButton() {
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
    const roleList = [];
    Object.entries(currentRoles).forEach(([role, count]) => {
        for(let i=0; i<count; i++) roleList.push(role);
    });
    socket.emit('start_game', { customRoleList: roleList });
};

// --- GAME START ---
socket.on('game_roles_update', (counts) => {
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

// --- NIGHT PHASE ---
socket.on('night_announcement', (data) => {
    elements.nightStatus.innerText = `Current Turn: ${data.activeRole}...`;
    elements.actionArea.classList.add('hidden');
});

socket.on('your_turn', (data) => {
    log(`Wake up! You are the ${data.role}`);
    elements.actionArea.classList.remove('hidden');
    elements.targetButtons.innerHTML = '';

    // Helpers
    const createPlayerBtn = (player, onClick) => {
        const btn = document.createElement('button');
        btn.className = 'target-btn';
        btn.innerText = `Select ${player.name}`;
        btn.onclick = () => onClick(player.id, btn);
        elements.targetButtons.appendChild(btn);
    };
    const createCenterBtn = (text, onClick) => {
        const btn = document.createElement('button');
        btn.className = 'target-btn';
        btn.style.background = '#8e44ad';
        btn.innerText = text;
        btn.onclick = onClick;
        elements.targetButtons.appendChild(btn);
    };
    const createInfo = (txt) => {
        const p = document.createElement('p');
        p.innerText = txt;
        p.style.color = '#f1c40f';
        elements.targetButtons.appendChild(p);
    };

    // Role Logic
    switch(data.role) {
        case 'Werewolf':
            if(data.isLoneWolf) {
                createInfo("You are the only Wolf. View a center card:");
                createCenterBtn("View Center Card", () => socket.emit('night_action', { action: 'target_center' }));
            } else {
                createInfo("Look for other Werewolves. (No action needed)");
            }
            break;
            
        case 'Minion':
            createInfo("Look for the Werewolves.");
            socket.emit('night_action', { action: 'check_wolves' });
            break;

        case 'Seer':
            createInfo("View a Player OR 2 Center Cards.");
            data.otherPlayers.forEach(p => createPlayerBtn(p, (id) => socket.emit('night_action', { action: 'target_player', targetId: id })));
            createCenterBtn("View 2 Center Cards", () => socket.emit('night_action', { action: 'target_center' }));
            break;

        case 'Robber':
            createInfo("Steal a card from a player.");
            data.otherPlayers.forEach(p => createPlayerBtn(p, (id) => socket.emit('night_action', { action: 'target_player', targetId: id })));
            break;

        case 'Troublemaker':
            createInfo("Select TWO players to swap.");
            let selection = [];
            data.otherPlayers.forEach(p => {
                createPlayerBtn(p, (id, btn) => {
                    if(selection.includes(id)) return;
                    selection.push(id);
                    btn.style.background = '#27ae60';
                    btn.innerText += " (Selected)";
                    if(selection.length === 2) {
                        socket.emit('night_action', { action: 'target_player', targetId1: selection[0], targetId2: selection[1] });
                        Array.from(elements.targetButtons.children).forEach(b => b.disabled = true);
                    }
                });
            });
            break;

        case 'Drunk':
            createInfo("Swap with a center card.");
            createCenterBtn("Swap with Center", () => socket.emit('night_action', { action: 'target_center' }));
            break;

        case 'Insomniac':
            createInfo("Checking your role...");
            socket.emit('night_action', { action: 'check_self' });
            break;

        case 'Mason':
            createInfo("Looking for other Masons...");
            socket.emit('night_action', { action: 'check_masons' });
            break;

        default:
            createInfo("No night action. Sleep well.");
    }

    // Done Button
    const done = document.createElement('button');
    done.innerText = "DONE / SLEEP";
    done.style.marginTop = "15px";
    done.style.width = "100%";
    done.style.background = "#34495e"; 
    done.onclick = () => {
        socket.emit('turn_done');
        elements.actionArea.classList.add('hidden');
    };
    elements.targetButtons.appendChild(done);
});

socket.on('action_result', (msg) => {
    alert(msg);
    log(msg);
    // Disable action buttons after success
    const container = document.getElementById('targetButtons');
    // Remove all buttons except the Done button (last child usually)
    // Simpler: Just clear and recreate Done
    container.innerHTML = '';
    const doneBtn = document.createElement('button');
    doneBtn.innerText = "ACTION COMPLETE - SLEEP";
    doneBtn.style.background = "#2c3e50"; 
    doneBtn.style.width = "100%";
    doneBtn.onclick = () => {
        socket.emit('turn_done');
        document.getElementById('actionArea').classList.add('hidden');
    };
    container.appendChild(doneBtn);
});

// --- DAY & RESULTS ---
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
            elements.voteButtons.innerHTML = '<p>Vote Cast. Waiting for others...</p>';
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
        li.innerHTML = `<strong>${p.name}</strong> started as ${p.originalRole} -> ended as <strong>${p.role}</strong>`;
        elements.finalList.appendChild(li);
    });
});

socket.on('force_game_end', (msg) => {
    alert(msg);
    location.reload();
});