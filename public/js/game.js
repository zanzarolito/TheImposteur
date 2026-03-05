// ─── game.js — Interface de jeu Loup-Garou (MJ contrôle tout) ────────────────

const params = new URLSearchParams(window.location.search);
const roomId = params.get('room');

if (!roomId) window.location.href = 'index.html';

const socket = io({ reconnection: true, reconnectionAttempts: 10 });

// ── État local ────────────────────────────────────────────────────────────────
let isMJ        = false;
let players     = [];
let currentStep = null;
let mjSelected  = [];   // sélections MJ (cupidon: 2, autres: 1)
let witchState  = {};   // état sorcière pour le MJ

// ── Infos des rôles ───────────────────────────────────────────────────────────
const ROLES = {
  loup:        { name: 'Loup-Garou',   icon: '🐺', desc: 'Vous êtes un Loup-Garou. Le MJ vous dira qui éliminer.' },
  villageois:  { name: 'Villageois',   icon: '👨‍🌾', desc: 'Trouvez et éliminez les loups-garous !' },
  voyante:     { name: 'Voyante',      icon: '🔮', desc: 'Le MJ vous révèlera secrètement le rôle d\'un joueur chaque nuit.' },
  sorciere:    { name: 'Sorcière',     icon: '🧪', desc: 'Le MJ vous indiquera comment utiliser vos potions.' },
  chasseur:    { name: 'Chasseur',     icon: '🏹', desc: 'Si vous mourez, le MJ vous demandera de désigner une cible.' },
  cupidon:     { name: 'Cupidon',      icon: '💘', desc: 'Le MJ désignera vos amoureux la première nuit.' },
  petite_fille:{ name: 'Petite Fille', icon: '👧', desc: 'Vous pouvez tenter d\'espionner les loups-garous.' }
};

const STEP_LABELS = {
  cupidon:      'Cupidon se réveille',
  voyante:      'La Voyante se réveille',
  loups:        'Les Loups-Garous se réveillent',
  sorciere:     'La Sorcière se réveille',
  petite_fille: 'La Petite Fille peut espionner'
};

// ── Connexion & identification ────────────────────────────────────────────────

socket.on('connect', () => {
  const token = getOrCreateSessionToken();
  socket.emit('identify', { sessionToken: token, roomId });
});

socket.on('sessionRestored', (data) => {
  isMJ    = data.isMJ;
  players = data.players;

  saveRoomContext(roomId, data.playerNumber, data.isMJ, true);

  if (isMJ) showMJDashboard();

  const phase = data.gameState.phase;
  const turn  = data.gameState.turn;

  if (phase === 'night') {
    setPhaseTitle(`🌙 Nuit ${turn}`);
    showScreen('waiting-screen');
    setText('waiting-text', 'Reconnexion à la partie en cours…');
  } else if (phase === 'day') {
    setPhaseTitle(`☀️ Jour ${turn}`);
    showScreen('waiting-screen');
    setText('waiting-text', 'Discussion en cours…');
    if (isMJ) showMJDayControls();
  }
});

socket.on('sessionExpired', () => {
  clearRoomContext();
  window.location.href = 'index.html';
});

// ── Rôle attribué ─────────────────────────────────────────────────────────────

socket.on('roleAssigned', ({ role }) => {
  if (isMJ) return; // Le MJ n'a pas de rôle
  const info = ROLES[role] || { name: role, icon: '❓', desc: '' };
  setText('role-icon', info.icon);
  setText('role-name', info.name);
  setText('role-description', info.desc);
  showScreen('role-reveal');
});

document.getElementById('hide-role-btn').addEventListener('click', () => {
  showScreen('waiting-screen');
  setText('waiting-text', 'En attente du début de la nuit…');
});

// ── Amoureux ──────────────────────────────────────────────────────────────────

socket.on('youAreLovers', ({ partnerName }) => {
  if (isMJ) return;
  setText('lovers-partner', `Votre partenaire amoureux : ${partnerName}`);
  showScreen('lovers-reveal');
});

document.getElementById('lovers-ok-btn').addEventListener('click', () => {
  showScreen('waiting-screen');
  setText('waiting-text', 'En attente de la suite de la nuit…');
});

// ── Voyante : résultat (reçu sur le téléphone de la voyante) ─────────────────

socket.on('voyantResult', ({ targetName, targetRole }) => {
  if (isMJ) {
    // Affichage MJ dans le dashboard (géré par showMJVoyantResult)
    const info = ROLES[targetRole] || { name: targetRole, icon: '❓' };
    setText('mj-voyant-result-text', `${targetName} est : ${info.icon} ${info.name}`);
    show('mj-voyant-result');
    return;
  }
  // Voyante player — écran discret
  const info = ROLES[targetRole] || { name: targetRole, icon: '❓' };
  setText('voyant-result-text', `${targetName} est : ${info.icon} ${info.name}`);
  showScreen('voyant-screen');
});

document.getElementById('voyant-ok-btn').addEventListener('click', () => {
  showScreen('waiting-screen');
  setText('waiting-text', 'En attente de la suite…');
});

// ── Nouvelle nuit ─────────────────────────────────────────────────────────────

socket.on('newNight', ({ turn, players: p }) => {
  players = p;
  setPhaseTitle(`🌙 Nuit ${turn}`);
  setPhaseDesc('Le village s\'endort…');
  showScreen('waiting-screen');
  setText('waiting-text', 'La nuit tombe sur le village…');

  if (isMJ) {
    hide('mj-night-controls');
    hide('mj-day-controls');
    hide('mj-chasseur-controls');
    updateMJPlayersList();
  }
});

// ── Étape de nuit ─────────────────────────────────────────────────────────────

socket.on('nightStepChanged', ({ step, turn }) => {
  currentStep = step;
  setPhaseTitle(`🌙 Nuit ${turn}`);
  setPhaseDesc(STEP_LABELS[step] || step);

  if (isMJ) {
    showMJNightAction(step);
  } else {
    showScreen('waiting-screen');
    setText('waiting-text', `${STEP_LABELS[step] || step}…`);
  }
});

// Infos supplémentaires pour le MJ à l'étape loups
socket.on('mjNightStepInfo', ({ step, wolves }) => {
  if (step === 'loups' && wolves) {
    const names = wolves.map(w => w.name).join(', ');
    setText('mj-step-desc', `Loups en jeu : ${names}. Choisissez leur victime.`);
  }
});

// ── MJ : Panneau de contrôle nuit ─────────────────────────────────────────────

function showMJNightAction(step) {
  mjSelected = [];
  witchState = {};

  // Masquer tout, puis afficher le bon sous-panneau
  hide('mj-day-controls');
  hide('mj-chasseur-controls');
  show('mj-night-controls');

  // Reset sous-éléments
  hide('mj-cupidon-hint');
  hide('mj-sorciere-options');
  hide('mj-voyant-result');
  show('mj-selection-grid');
  const confirmBtn = document.getElementById('mj-confirm-night-btn');
  confirmBtn.disabled = true;
  confirmBtn.style.display = 'none';
  confirmBtn.textContent = 'Confirmer';
  confirmBtn.onclick = null;

  const alive = players.filter(p => p.isAlive && !p.isMJ);

  setText('mj-step-title', STEP_LABELS[step] || step);

  if (step === 'cupidon') {
    setText('mj-step-desc', 'Sélectionnez 2 joueurs comme amoureux.');
    show('mj-cupidon-hint');
    setText('mj-cupidon-count', '0/2');
    renderPlayerGrid('mj-selection-grid', alive, onMJCupidonSelect);
    confirmBtn.style.display = 'block';

  } else if (step === 'voyante') {
    setText('mj-step-desc', 'Choisissez le joueur que la Voyante observe.');
    renderPlayerGrid('mj-selection-grid', alive, onMJSingleSelect);
    confirmBtn.style.display = 'block';
    confirmBtn.onclick = () => {
      if (mjSelected.length !== 1) return;
      socket.emit('mjNightAction', { roomId, step: 'voyante', action: { targetId: mjSelected[0] } });
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Révélation envoyée…';
    };

  } else if (step === 'loups') {
    setText('mj-step-desc', 'Choisissez la victime des Loups-Garous.');
    renderPlayerGrid('mj-selection-grid', alive, onMJSingleSelect);
    confirmBtn.style.display = 'block';
    confirmBtn.onclick = () => {
      if (mjSelected.length !== 1) return;
      socket.emit('mjNightAction', { roomId, step: 'loups', action: { targetId: mjSelected[0] } });
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Victime désignée…';
    };

  } else if (step === 'sorciere') {
    setText('mj-step-desc', 'Informez la Sorcière et gérez les potions.');
    hide('mj-selection-grid');
    show('mj-sorciere-options');
    // sorciereInfo arrivera du serveur et complétera le panneau

  } else if (step === 'petite_fille') {
    setText('mj-step-desc', 'La Petite Fille peut espionner ou dormir. Continuez quand c\'est fait.');
    hide('mj-selection-grid');
    confirmBtn.style.display = 'block';
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Continuer →';
    confirmBtn.onclick = () => {
      socket.emit('mjNightAction', { roomId, step: 'petite_fille', action: {} });
      confirmBtn.disabled = true;
    };
  }
}

function onMJSingleSelect(playerId) {
  mjSelected = [playerId];
  highlightSelected('mj-selection-grid', mjSelected);
  const btn = document.getElementById('mj-confirm-night-btn');
  btn.disabled = false;
}

function onMJCupidonSelect(playerId) {
  if (mjSelected.includes(playerId)) {
    mjSelected = mjSelected.filter(id => id !== playerId);
  } else if (mjSelected.length < 2) {
    mjSelected.push(playerId);
  }
  highlightSelected('mj-selection-grid', mjSelected);
  setText('mj-cupidon-count', `${mjSelected.length}/2`);
  const btn = document.getElementById('mj-confirm-night-btn');
  btn.disabled = mjSelected.length !== 2;
  if (mjSelected.length === 2) {
    btn.onclick = () => {
      socket.emit('mjNightAction', {
        roomId, step: 'cupidon',
        action: { player1Id: mjSelected[0], player2Id: mjSelected[1] }
      });
      btn.disabled = true;
      btn.textContent = 'Couple désigné…';
    };
  }
}

// ── MJ : Sorcière ─────────────────────────────────────────────────────────────

socket.on('sorciereInfo', ({ victimName, victimId, potions }) => {
  if (!isMJ) return;

  witchState = { victimId, potions, killTarget: null };

  const healSection = document.getElementById('mj-heal-section');
  const killSection = document.getElementById('mj-kill-section');
  const healBtn     = document.getElementById('mj-heal-btn');

  if (victimName) {
    setText('mj-wolf-victim', `☠ Les loups ciblent : ${victimName}`);
    healSection.style.display = potions.heal ? 'block' : 'none';
    if (!potions.heal) {
      setText('mj-wolf-victim', `☠ Les loups ciblent : ${victimName} (potion de Vie épuisée)`);
    }
  } else {
    setText('mj-wolf-victim', 'Les loups n\'ont pas désigné de victime.');
    healSection.style.display = 'none';
  }

  if (potions.kill) {
    const alive = players.filter(p => p.isAlive && !p.isMJ);
    renderPlayerGrid('mj-kill-grid', alive, (pid) => {
      witchState.killTarget = pid;
      highlightSelected('mj-kill-grid', [pid]);
    });
    killSection.style.display = 'block';
  } else {
    killSection.style.display = 'none';
  }

  healBtn.onclick = () => {
    socket.emit('mjNightAction', { roomId, step: 'sorciere', action: { type: 'heal' } });
    healBtn.disabled = true;
    setText('mj-wolf-victim', `💊 Victime sauvée.`);
    healSection.style.display = 'none';
  };

  document.getElementById('mj-sorciere-skip-btn').onclick = () => {
    socket.emit('mjNightAction', { roomId, step: 'sorciere', action: { type: 'skip' } });
  };

  // Le bouton "Utiliser la potion de mort" apparaît quand une cible est sélectionnée
  // On l'ajoute dynamiquement après la grille si kill
  if (potions.kill) {
    let killConfirmBtn = document.getElementById('mj-kill-confirm-btn');
    if (!killConfirmBtn) {
      killConfirmBtn = document.createElement('button');
      killConfirmBtn.id = 'mj-kill-confirm-btn';
      killConfirmBtn.className = 'btn btn-secondary';
      killConfirmBtn.style.marginTop = '10px';
      killConfirmBtn.textContent = '☠ Utiliser la Potion de Mort';
      document.getElementById('mj-kill-section').appendChild(killConfirmBtn);
    }
    killConfirmBtn.style.display = 'block';
    killConfirmBtn.onclick = () => {
      if (!witchState.killTarget) return;
      socket.emit('mjNightAction', {
        roomId, step: 'sorciere',
        action: { type: 'kill', targetId: witchState.killTarget }
      });
      killConfirmBtn.disabled = true;
    };
  }
});

// ── Fin de nuit ───────────────────────────────────────────────────────────────

socket.on('nightEnd', ({ deaths, players: p, waitingForChasseur }) => {
  if (p) players = p;
  setPhaseTitle('🌅 Réveil du village');
  setPhaseDesc('');

  if (isMJ) {
    hide('mj-night-controls');
    updateMJPlayersList();
  }

  const list = document.getElementById('death-list');
  list.innerHTML = '';
  setText('death-title', 'Cette nuit…');

  if (deaths.length === 0) {
    list.innerHTML = '<p style="color:var(--success);">🕊 Personne n\'est mort cette nuit.</p>';
  } else {
    deaths.forEach(d => {
      const info = ROLES[d.role] || { icon: '❓', name: d.role };
      const el = document.createElement('p');
      el.style.marginBottom = '8px';
      el.innerHTML = `${info.icon} <strong>${d.name}</strong> était <em>${info.name}</em>`;
      list.appendChild(el);
    });
  }

  setText('death-continue', waitingForChasseur
    ? 'Le MJ va gérer le tir du Chasseur…'
    : 'La phase de jour va commencer dans quelques secondes.');
  showScreen('death-screen');
});

// ── Phase Jour ────────────────────────────────────────────────────────────────

socket.on('dayStarted', ({ turn, players: p }) => {
  players = p;
  setPhaseTitle(`☀️ Jour ${turn}`);
  setPhaseDesc('Discussion en cours.');
  showScreen('waiting-screen');
  setText('waiting-text', 'Discutez ensemble. Le MJ va bientôt désigner l\'éliminé.');

  if (isMJ) {
    hide('mj-night-controls');
    updateMJPlayersList();
    showMJDayControls();
  }
});

// Reçu si le MJ était déconnecté et se reconnecte en cours de jour
socket.on('mjDayControl', ({ players: p }) => {
  if (!isMJ) return;
  players = p;
  updateMJPlayersList();
  showMJDayControls();
});

function showMJDayControls() {
  hide('mj-night-controls');
  hide('mj-chasseur-controls');
  show('mj-day-controls');

  const alive = players.filter(p => p.isAlive && !p.isMJ);
  renderPlayerGrid('mj-vote-grid', alive, (playerId) => {
    socket.emit('mjEliminatePlayer', { roomId, targetId: playerId });
    // Désactiver la grille après sélection
    document.querySelectorAll('#mj-vote-grid .player-card').forEach(c => {
      c.style.pointerEvents = 'none';
    });
    document.getElementById('mj-no-elim-btn').disabled = true;
  });
}

document.getElementById('mj-no-elim-btn').addEventListener('click', () => {
  socket.emit('mjEliminatePlayer', { roomId, targetId: 'none' });
  document.getElementById('mj-no-elim-btn').disabled = true;
  document.querySelectorAll('#mj-vote-grid .player-card').forEach(c => {
    c.style.pointerEvents = 'none';
  });
});

// ── Élimination ───────────────────────────────────────────────────────────────

socket.on('playerEliminated', ({ name, role, players: p, waitingForChasseur }) => {
  if (p) players = p;

  const info = ROLES[role] || { icon: '❓', name: role };
  setText('death-title', 'Joueur éliminé');
  document.getElementById('death-list').innerHTML =
    `<p>${info.icon} <strong>${name}</strong> était <em>${info.name}</em></p>`;
  setText('death-continue', waitingForChasseur
    ? 'Le MJ va gérer le tir du Chasseur…'
    : 'La nuit va commencer dans quelques secondes.');
  showScreen('death-screen');

  if (isMJ) {
    hide('mj-day-controls');
    hide('mj-night-controls');
    updateMJPlayersList();
  }
});

socket.on('noElimination', ({ players: p }) => {
  if (p) players = p;

  setText('death-title', 'Résultat du vote');
  document.getElementById('death-list').innerHTML =
    '<p style="color:var(--warning);">⚖️ Égalité — personne n\'est éliminé ce tour.</p>';
  setText('death-continue', 'La nuit va commencer.');
  showScreen('death-screen');

  if (isMJ) {
    hide('mj-day-controls');
    updateMJPlayersList();
  }
});

// ── Chasseur (géré par le MJ) ─────────────────────────────────────────────────

socket.on('chasseurAlert', ({ message }) => {
  if (!isMJ) return;

  setText('mj-chasseur-msg', message);

  hide('mj-night-controls');
  hide('mj-day-controls');
  show('mj-chasseur-controls');

  const alive = players.filter(p => p.isAlive && !p.isMJ);
  renderPlayerGrid('mj-chasseur-grid', alive, (playerId) => {
    socket.emit('mjChasseurShot', { roomId, targetId: playerId });
    document.querySelectorAll('#mj-chasseur-grid .player-card').forEach(c => {
      c.style.pointerEvents = 'none';
    });
  });
});

socket.on('chasseurShot', ({ name, role, players: p }) => {
  if (p) players = p;
  const info = ROLES[role] || { icon: '❓', name: role };
  showNotif(`${info.icon} ${name} (${info.name}) abattu par le Chasseur`, 'warning');

  if (isMJ) {
    hide('mj-chasseur-controls');
    updateMJPlayersList();
  }
});

// ── Reconnexion joueurs ───────────────────────────────────────────────────────

socket.on('playerReconnecting', ({ playerName }) => {
  showNotif(`⏳ ${playerName} s'est déconnecté…`, 'warning');
});

socket.on('playerReconnected', ({ playerName }) => {
  showNotif(`✅ ${playerName} est de retour !`, 'success');
});

socket.on('playerDisconnected', ({ playerName }) => {
  showNotif(`❌ ${playerName} ne s'est pas reconnecté.`, 'error');
});

socket.on('playersUpdate', ({ players: p }) => {
  players = p;
  if (isMJ) updateMJPlayersList();
});

// ── Fin de partie ─────────────────────────────────────────────────────────────

socket.on('gameEnd', ({ winner, winners, allPlayers }) => {
  const WINNERS = {
    village: { label: 'Le Village a gagné !',    icon: '🏡', sub: 'Les loups ont été éliminés.' },
    loups:   { label: 'Les Loups ont gagné !',    icon: '🐺', sub: 'Ils ont envahi le village.' },
    lovers:  { label: 'Les Amoureux ont gagné !', icon: '💕', sub: 'Leur amour a triomphé.' }
  };
  const info = WINNERS[winner] || { label: 'Fin de partie', icon: '🎮', sub: '' };

  setText('end-icon', info.icon);
  setText('end-winner', info.label);
  setText('end-subtitle', info.sub);

  const rolesDiv = document.getElementById('end-all-roles');
  rolesDiv.innerHTML = '<h3 style="margin-bottom:10px;">Rôles révélés :</h3>';
  (allPlayers || []).forEach(p => {
    const ri = p.role ? (ROLES[p.role] || { icon: '❓', name: p.role }) : null;
    const row = document.createElement('p');
    row.style.marginBottom = '6px';
    const roleLabel = ri ? `${ri.icon} ${ri.name}` : '👑 Maître du Jeu';
    row.innerHTML = `${p.isAlive ? '🟢' : '💀'} <strong>${p.name}</strong> — ${roleLabel}`;
    rolesDiv.appendChild(row);
  });

  if (isMJ) hide('mj-dashboard');
  showScreen('game-end-screen');
  setPhaseTitle('🏆 Fin de partie');
  clearRoomContext();
});

// ── Dashboard MJ ──────────────────────────────────────────────────────────────

socket.on('mjUpdate', ({ players: p }) => {
  players = p;
  if (isMJ) updateMJPlayersList();
});

function showMJDashboard() {
  show('mj-dashboard');
  updateMJPlayersList();
}

function updateMJPlayersList() {
  const div = document.getElementById('mj-players-list');
  if (!div) return;
  div.innerHTML = '';
  players.forEach(p => {
    const ri = ROLES[p.role] || { icon: '❓', name: p.role || '?' };
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #2a2a4a;font-size:.9rem;';
    row.innerHTML = `
      <span>${p.isAlive ? '🟢' : '💀'} ${p.name}${p.isMJ ? ' 👑' : ''}</span>
      <span style="color:var(--text-muted)">${p.role ? ri.icon + ' ' + ri.name : '—'}</span>
    `;
    div.appendChild(row);
  });
}

// Le MJ peut forcer l'avance de l'étape en cas de blocage
document.addEventListener('keydown', (e) => {
  if (!isMJ) return;
  if (e.key === 'F9') socket.emit('mjForceNextStep', { roomId });
});

// ── Helpers joueurs ───────────────────────────────────────────────────────────

function highlightSelected(containerId, ids) {
  document.querySelectorAll(`#${containerId} .player-card`).forEach(card => {
    card.classList.toggle('selected', ids.includes(card.dataset.id));
  });
}

// ── Rendu grille joueurs ──────────────────────────────────────────────────────

function renderPlayerGrid(containerId, list, onSelect) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  grid.innerHTML = '';
  list.forEach(p => {
    const card = document.createElement('div');
    card.className = 'player-card' + (!p.isAlive ? ' dead' : '');
    card.dataset.id = p.playerId;
    card.innerHTML = `
      <div style="font-size:1.3rem;">${p.isAlive ? '👤' : '💀'}</div>
      <div style="margin-top:5px;font-size:.85rem;">${p.name}</div>
    `;
    if (p.isAlive) card.addEventListener('click', () => onSelect(p.playerId));
    grid.appendChild(card);
  });
}

// ── Utilitaires UI ────────────────────────────────────────────────────────────

const SCREENS = [
  'role-reveal', 'lovers-reveal', 'voyant-screen',
  'waiting-screen', 'death-screen', 'game-end-screen'
];

function showScreen(id) {
  SCREENS.forEach(sid => {
    const el = document.getElementById(sid);
    if (el) el.style.display = (sid === id) ? 'block' : 'none';
  });
}

function show(id) { const el = document.getElementById(id); if (el) el.style.display = 'block'; }
function hide(id) { const el = document.getElementById(id); if (el) el.style.display = 'none';  }

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setPhaseTitle(t) { setText('phase-title', t); }
function setPhaseDesc(d)  { setText('phase-description', d); }

function showNotif(msg, type = 'info') {
  const n = document.getElementById('notification');
  if (!n) return;
  n.textContent = msg;
  n.className = `notification ${type} show`;
  setTimeout(() => n.classList.remove('show'), 4000);
}
