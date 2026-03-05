const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
const isMJ = urlParams.get('mj') === 'true';

const client = new SocketClient();
const socket = client.connect();

let players = [];
let composition = {};

console.log('[Lobby] Room ID:', roomId, 'MJ:', isMJ);
console.log('[Lobby] Room ID length:', roomId ? roomId.length : 0);
console.log('[Lobby] Room ID chars:', roomId ? roomId.split('') : []);

document.getElementById('room-code').textContent = roomId;

if (isMJ) {
  document.getElementById('mj-controls').style.display = 'block';
  document.getElementById('player-waiting').style.display = 'none';
}

// Copier le code
document.getElementById('copy-code-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(roomId).then(() => {
    showNotification('Code copié !', 'success');
  });
});

// Copier le lien
document.getElementById('copy-link-btn').addEventListener('click', () => {
  const link = `${window.location.origin}/?join=${roomId}`;
  navigator.clipboard.writeText(link).then(() => {
    showNotification('Lien copié !', 'success');
  });
});

// Configuration de la composition
if (isMJ) {
  const roleInputs = ['loup', 'villageois', 'voyante', 'sorciere', 'chasseur', 'cupidon', 'petite_fille'];
  
  roleInputs.forEach(roleId => {
    document.getElementById(roleId).addEventListener('input', updateComposition);
  });
  
  function updateComposition() {
    composition = {};
    roleInputs.forEach(roleId => {
      const value = parseInt(document.getElementById(roleId).value) || 0;
      if (value > 0) {
        composition[roleId] = value;
      }
    });
    
    const totalRoles = Object.values(composition).reduce((a, b) => a + b, 0);
    // Le MJ n'a pas de rôle : on ne compte que les joueurs non-MJ
    const playerCount = players.filter(p => !p.isMJ).length;

    const status = document.getElementById('composition-status');
    const startBtn = document.getElementById('start-game-btn');

    if (totalRoles === playerCount && playerCount >= 6) {
      status.textContent = `✓ Configuration valide (${totalRoles} rôles)`;
      status.style.color = '#4caf50';
      startBtn.disabled = false;
    } else if (playerCount < 6) {
      status.textContent = `Minimum 6 joueurs requis (actuellement ${playerCount})`;
      status.style.color = '#ff9800';
      startBtn.disabled = true;
    } else {
      status.textContent = `${totalRoles} rôles pour ${playerCount} joueurs`;
      status.style.color = '#f44336';
      startBtn.disabled = true;
    }
    
    socket.emit('setComposition', { roomId, composition });
  }
  
  document.getElementById('start-game-btn').addEventListener('click', () => {
    console.log('[Lobby] Lancement de la partie');
    socket.emit('startGame', { roomId });
  });
  
  document.getElementById('add-test-players-btn').addEventListener('click', () => {
    console.log('[Lobby] Ajout de joueurs test');
    socket.emit('addTestPlayers', { roomId });
  });
}

// Événements socket
socket.on('playerJoined', ({ players: updatedPlayers }) => {
  console.log('[Lobby] Joueurs mis à jour:', updatedPlayers);
  players = updatedPlayers;
  updatePlayerList();
  if (isMJ) updateComposition();
});

socket.on('testPlayersAdded', ({ count }) => {
  showNotification(`${count} joueurs test ajoutés`, 'success');
});

socket.on('gameStarted', () => {
  console.log('[Lobby] Partie démarrée, redirection...');
  window.location.href = `game.html?room=${roomId}`;
});

socket.on('roleAssigned', ({ role, playerNumber }) => {
  console.log('[Lobby] Rôle assigné:', role);
  localStorage.setItem('loupgarou_role', role);
  localStorage.setItem('loupgarou_player_number', playerNumber);
});

socket.on('error', ({ message }) => {
  showNotification(message, 'error');
});

function updatePlayerList() {
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  
  players.forEach(player => {
    const li = document.createElement('li');
    li.textContent = player.name;
    if (player.online) {
      li.classList.add('online');
    }
    list.appendChild(li);
  });
  
  document.getElementById('player-count').textContent = players.length;
}

function showNotification(message, type = 'info') {
  const notif = document.getElementById('notification');
  notif.textContent = message;
  notif.className = `notification ${type} show`;
  setTimeout(() => {
    notif.classList.remove('show');
  }, 3000);
}
