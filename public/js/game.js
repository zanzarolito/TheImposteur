const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');

const client = new SocketClient();
const socket = client.connect();

let myRole = localStorage.getItem('loupgarou_role');
let myPlayerNumber = parseInt(localStorage.getItem('loupgarou_player_number'));
let players = [];
let selectedTarget = null;

const ROLE_INFO = {
  loup: { name: 'Loup-Garou', description: 'Éliminez les villageois chaque nuit' },
  villageois: { name: 'Villageois', description: 'Trouvez et éliminez les loups-garous' },
  voyante: { name: 'Voyante', description: 'Vous pouvez voir le rôle d\'un joueur chaque nuit' },
  sorciere: { name: 'Sorcière', description: 'Vous avez une potion de vie et une potion de mort' },
  chasseur: { name: 'Chasseur', description: 'Vous éliminez un joueur en mourant' },
  cupidon: { name: 'Cupidon', description: 'Désignez deux amoureux la première nuit' },
  petite_fille: { name: 'Petite Fille', description: 'Vous pouvez espionner les loups-garous' }
};

// Afficher le rôle au démarrage
socket.on('roleAssigned', ({ role }) => {
  myRole = role;
  showRoleReveal(role);
});

socket.on('gameStarted', ({ phase, turn, currentStep }) => {
  updatePhase(phase, currentStep);
});

socket.on('nightStepChanged', ({ step }) => {
  updateNightStep(step);
});

socket.on('nightEnd', ({ deaths }) => {
  showDeaths(deaths);
});

socket.on('newNight', ({ turn }) => {
  document.getElementById('phase-title').textContent = `Nuit ${turn}`;
  hideAllScreens();
  document.getElementById('waiting-screen').style.display = 'block';
});

socket.on('playerEliminated', ({ name, role }) => {
  showNotification(`${name} (${ROLE_INFO[role].name}) a été éliminé`, 'warning');
});

socket.on('noElimination', () => {
  showNotification('Égalité - Personne n\'est éliminé', 'info');
});

socket.on('gameEnd', ({ winner, players: winners }) => {
  const winnerNames = {
    village: 'Le Village',
    loups: 'Les Loups-Garous',
    lovers: 'Les Amoureux'
  };
  showNotification(`${winnerNames[winner]} ont gagné !`, 'success');
});

socket.on('voteUpdate', ({ voteCount, aliveCount }) => {
  document.getElementById('vote-current').textContent = voteCount;
  document.getElementById('vote-total').textContent = aliveCount;
});

socket.on('playerReconnecting', ({ playerName, graceSeconds }) => {
  showNotification(`${playerName} s'est déconnecté. Reconnexion...`, 'warning');
});

socket.on('playerReconnected', ({ playerName }) => {
  showNotification(`${playerName} est de retour`, 'success');
});

function showRoleReveal(role) {
  const info = ROLE_INFO[role];
  document.getElementById('role-name').textContent = info.name;
  document.getElementById('role-description').textContent = info.description;
  document.getElementById('role-reveal').style.display = 'block';
}

document.getElementById('hide-role-btn').addEventListener('click', () => {
  document.getElementById('role-reveal').style.display = 'none';
  document.getElementById('waiting-screen').style.display = 'block';
});

function updatePhase(phase, step) {
  if (phase === 'night') {
    updateNightStep(step);
  } else if (phase === 'day') {
    showDayVote();
  }
}

function updateNightStep(step) {
  hideAllScreens();
  
  const stepRoles = {
    cupidon: ['cupidon'],
    voyante: ['voyante'],
    loups: ['loup'],
    sorciere: ['sorciere'],
    petite_fille: ['petite_fille']
  };
  
  if (stepRoles[step] && stepRoles[step].includes(myRole)) {
    showNightAction(step);
  } else {
    document.getElementById('waiting-screen').style.display = 'block';
  }
}

function showNightAction(step) {
  document.getElementById('night-action').style.display = 'block';
  
  const actions = {
    cupidon: { title: 'Cupidon', description: 'Choisissez deux joueurs à rendre amoureux' },
    voyante: { title: 'Voyante', description: 'Choisissez un joueur pour voir son rôle' },
    loups: { title: 'Loups-Garous', description: 'Choisissez une victime' },
    sorciere: { title: 'Sorcière', description: 'Utilisez vos potions' },
    petite_fille: { title: 'Petite Fille', description: 'Espionner les loups ?' }
  };
  
  const action = actions[step];
  document.getElementById('action-title').textContent = action.title;
  document.getElementById('action-description').textContent = action.description;
  
  // TODO: Afficher la sélection de joueurs
}

function showDayVote() {
  hideAllScreens();
  document.getElementById('day-vote').style.display = 'block';
  // TODO: Afficher les joueurs vivants pour le vote
}

function showDeaths(deaths) {
  hideAllScreens();
  document.getElementById('death-announcement').style.display = 'block';
  
  const list = document.getElementById('death-list');
  list.innerHTML = '';
  
  if (deaths.length === 0) {
    list.innerHTML = '<p>Personne n\'est mort cette nuit</p>';
  } else {
    deaths.forEach(death => {
      const p = document.createElement('p');
      p.textContent = `${death.name} (${ROLE_INFO[death.role].name}) est mort`;
      list.appendChild(p);
    });
  }
  
  setTimeout(() => {
    document.getElementById('death-announcement').style.display = 'none';
    showDayVote();
  }, 5000);
}

function hideAllScreens() {
  document.getElementById('role-reveal').style.display = 'none';
  document.getElementById('night-action').style.display = 'none';
  document.getElementById('day-vote').style.display = 'none';
  document.getElementById('waiting-screen').style.display = 'none';
  document.getElementById('death-announcement').style.display = 'none';
}

function showNotification(message, type = 'info') {
  const notif = document.getElementById('notification');
  notif.textContent = message;
  notif.className = `notification ${type} show`;
  setTimeout(() => {
    notif.classList.remove('show');
  }, 3000);
}
