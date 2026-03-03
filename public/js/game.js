// ─── game.js — Interface de jeu Loup-Garou ───────────────────────────────────

const params = new URLSearchParams(window.location.search);
const roomId = params.get('room');

if (!roomId) window.location.href = 'index.html';

const socket = io({ reconnection: true, reconnectionAttempts: 10 });

// ── État local ────────────────────────────────────────────────────────────────
let myRole      = null;
let isMJ        = false;
let players     = [];
let selectedTargets = [];
let currentStep = null;
let witchState  = {};
let hasVoted    = false;
let voteOpen    = false;

// ── Infos des rôles ───────────────────────────────────────────────────────────
const ROLES = {
  loup:        { name: 'Loup-Garou',   icon: '🐺', desc: 'Votez chaque nuit pour éliminer un villageois.' },
  villageois:  { name: 'Villageois',   icon: '👨‍🌾', desc: 'Trouvez et éliminez les loups-garous !' },
  voyante:     { name: 'Voyante',      icon: '🔮', desc: 'Chaque nuit, révèle le rôle d\'un joueur.' },
  sorciere:    { name: 'Sorcière',     icon: '🧪', desc: 'Potion de Vie et potion de Mort à usage unique.' },
  chasseur:    { name: 'Chasseur',     icon: '🏹', desc: 'Vous tirez un joueur en mourant.' },
  cupidon:     { name: 'Cupidon',      icon: '💘', desc: 'Désignez deux amoureux la première nuit.' },
  petite_fille:{ name: 'Petite Fille', icon: '👧', desc: 'Vous pouvez espionner les loups-garous.' }
};

const STEP_LABELS = {
  cupidon:     'Cupidon se réveille',
  voyante:     'La Voyante se réveille',
  loups:       'Les Loups-Garous se réveillent',
  sorciere:    'La Sorcière se réveille',
  petite_fille:'La Petite Fille peut espionner'
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
    if (data.gameState.voteOpen) {
      showDayVote();
    } else {
      setText('waiting-text', 'Le MJ va ouvrir le vote.');
    }
  }
});

socket.on('sessionExpired', () => {
  clearRoomContext();
  window.location.href = 'index.html';
});

// ── Rôle attribué ─────────────────────────────────────────────────────────────

socket.on('roleAssigned', ({ role }) => {
  myRole = role;
  showRoleReveal(role);
});

function showRoleReveal(role) {
  const info = ROLES[role] || { name: role, icon: '❓', desc: '' };
  setText('role-icon', info.icon);
  setText('role-name', info.name);
  setText('role-description', info.desc);
  showScreen('role-reveal');
}

document.getElementById('hide-role-btn').addEventListener('click', () => {
  showScreen('waiting-screen');
  setText('waiting-text', 'En attente du début de la nuit…');
});

// ── Amoureux ──────────────────────────────────────────────────────────────────

socket.on('youAreLovers', ({ partnerName }) => {
  setText('lovers-partner', `Votre partenaire amoureux : ${partnerName}`);
  showScreen('lovers-reveal');
});

document.getElementById('lovers-ok-btn').addEventListener('click', () => {
  showScreen('waiting-screen');
  setText('waiting-text', 'En attente de la suite de la nuit…');
});

// ── Nouvelle nuit ─────────────────────────────────────────────────────────────

socket.on('newNight', ({ turn, players: p }) => {
  players = p;
  hasVoted = false;
  voteOpen = false;
  selectedTargets = [];

  setPhaseTitle(`🌙 Nuit ${turn}`);
  setPhaseDesc('Le village s\'endort…');
  showScreen('waiting-screen');
  setText('waiting-text', 'La nuit tombe sur le village…');

  if (isMJ) {
    show('mj-night-controls');
    hide('mj-day-controls');
    setText('mj-current-step', `Nuit ${turn} — en cours`);
    updateMJPlayersList();
  }
});

// ── Étape de nuit ─────────────────────────────────────────────────────────────

socket.on('nightStepChanged', ({ step, turn }) => {
  currentStep = step;
  setPhaseTitle(`🌙 Nuit ${turn}`);
  setPhaseDesc(STEP_LABELS[step] || step);

  if (isMJ) {
    setText('mj-current-step', `Étape : ${STEP_LABELS[step] || step}`);
    return;
  }

  const stepRoles = {
    cupidon:     ['cupidon'],
    voyante:     ['voyante'],
    loups:       ['loup'],
    sorciere:    ['sorciere'],
    petite_fille:['petite_fille']
  };

  if ((stepRoles[step] || []).includes(myRole)) {
    showNightAction(step);
  } else {
    showScreen('waiting-screen');
    setText('waiting-text', `${STEP_LABELS[step] || step}…`);
  }
});

function showNightAction(step) {
  selectedTargets = [];
  resetNightUI();

  const actions = {
    cupidon:     { title: '💘 Cupidon',        desc: 'Désignez 2 joueurs comme amoureux.' },
    voyante:     { title: '🔮 Voyante',         desc: 'Choisissez un joueur pour voir son rôle.' },
    loups:       { title: '🐺 Loups-Garous',    desc: 'Choisissez votre victime cette nuit.' },
    sorciere:    { title: '🧪 Sorcière',        desc: 'Attendez les informations…' },
    petite_fille:{ title: '👧 Petite Fille',    desc: 'Vous pouvez observer ou dormir.' }
  };

  const a = actions[step] || { title: step, desc: '' };
  setText('action-title', a.title);
  setText('action-description', a.desc);

  if (step === 'cupidon') {
    show('cupidon-hint');
    renderPlayerGrid('player-selection', getAlivePlayers(), onCupidonSelect);
    document.getElementById('confirm-action-btn').disabled = true;

  } else if (step === 'voyante') {
    renderPlayerGrid('player-selection', getAlivePlayers(true), onSingleSelect);
    document.getElementById('confirm-action-btn').disabled = true;

  } else if (step === 'loups') {
    renderPlayerGrid('player-selection', getAliveNotWolves(), onSingleSelect);
    document.getElementById('confirm-action-btn').disabled = true;

  } else if (step === 'sorciere') {
    hide('player-selection');
    document.getElementById('confirm-action-btn').style.display = 'none';
    // UI complétée par sorciereInfo
    show('witch-options');
    setText('witch-victim-info', 'En attente des informations…');

  } else if (step === 'petite_fille') {
    hide('player-selection');
    setText('confirm-action-btn', 'Je dors (ne rien faire)');
    document.getElementById('confirm-action-btn').disabled = false;
  }

  showScreen('night-action');
}

function resetNightUI() {
  hide('witch-options');
  hide('voyant-result');
  hide('cupidon-hint');
  show('player-selection');
  document.getElementById('player-selection').innerHTML = '';
  document.getElementById('confirm-action-btn').disabled = true;
  document.getElementById('confirm-action-btn').style.display = 'block';
  document.getElementById('confirm-action-btn').textContent = 'Confirmer';
  document.getElementById('confirm-action-btn').onclick = null;
}

// ── Sélections joueurs ────────────────────────────────────────────────────────

function onCupidonSelect(playerId) {
  if (selectedTargets.includes(playerId)) {
    selectedTargets = selectedTargets.filter(id => id !== playerId);
  } else if (selectedTargets.length < 2) {
    selectedTargets.push(playerId);
  }
  highlightSelected('player-selection', selectedTargets);
  setText('cupidon-count', `${selectedTargets.length}/2 sélectionné(s)`);
  document.getElementById('confirm-action-btn').disabled = selectedTargets.length !== 2;
}

function onSingleSelect(playerId) {
  selectedTargets = [playerId];
  highlightSelected('player-selection', selectedTargets);
  document.getElementById('confirm-action-btn').disabled = false;
}

function highlightSelected(containerId, ids) {
  document.querySelectorAll(`#${containerId} .player-card`).forEach(card => {
    card.classList.toggle('selected', ids.includes(card.dataset.id));
  });
}

// ── Confirmer l'action de nuit ────────────────────────────────────────────────

document.getElementById('confirm-action-btn').addEventListener('click', () => {
  if (currentStep === 'cupidon' && selectedTargets.length === 2) {
    socket.emit('nightAction', {
      roomId, step: 'cupidon',
      action: { player1Id: selectedTargets[0], player2Id: selectedTargets[1] }
    });
    showScreen('waiting-screen');
    setText('waiting-text', 'Les amoureux ont été désignés. En attente…');

  } else if (currentStep === 'voyante' && selectedTargets.length === 1) {
    socket.emit('nightAction', {
      roomId, step: 'voyante',
      action: { targetId: selectedTargets[0] }
    });

  } else if (currentStep === 'loups' && selectedTargets.length === 1) {
    socket.emit('nightAction', {
      roomId, step: 'loups',
      action: { targetId: selectedTargets[0] }
    });
    setText('confirm-action-btn', 'Vote envoyé…');
    document.getElementById('confirm-action-btn').disabled = true;

  } else if (currentStep === 'petite_fille') {
    socket.emit('nightAction', { roomId, step: 'petite_fille', action: { type: 'skip' } });
    showScreen('waiting-screen');
    setText('waiting-text', 'Vous dormez sagement…');
  }
});

// ── Voyante : résultat ────────────────────────────────────────────────────────

socket.on('voyantResult', ({ targetName, targetRole }) => {
  const info = ROLES[targetRole] || { name: targetRole, icon: '❓' };
  hide('player-selection');
  show('voyant-result');
  setText('voyant-result-text', `${targetName} est : ${info.icon} ${info.name}`);

  const btn = document.getElementById('confirm-action-btn');
  btn.textContent = 'Continuer ✓';
  btn.disabled = false;
  btn.onclick = () => {
    showScreen('waiting-screen');
    setText('waiting-text', 'En attente de la suite…');
    btn.onclick = null;
  };
});

// ── Loups : coéquipiers ───────────────────────────────────────────────────────

socket.on('wolvesInfo', ({ teammates }) => {
  const token  = getOrCreateSessionToken();
  const others = teammates.filter(t => t.playerId !== token);
  if (others.length > 0) {
    const names = others.map(t => t.name).join(', ');
    setText('action-description', `Vos complices : ${names}. Choisissez une victime.`);
  }
});

// ── Sorcière ──────────────────────────────────────────────────────────────────

socket.on('sorciereInfo', ({ victimName, victimId, potions }) => {
  witchState = { victimId, victimName, potions, killTarget: null };

  const healSection = document.getElementById('witch-heal-section');
  const killSection = document.getElementById('witch-kill-section');
  const healBtn     = document.getElementById('witch-heal-btn');
  const confirmBtn  = document.getElementById('confirm-action-btn');

  confirmBtn.style.display = 'none';

  // Victime loups
  if (victimName) {
    setText('witch-victim-info', `☠ Les loups ciblent : ${victimName}`);
    healSection.style.display = potions.heal ? 'block' : 'none';
    if (!potions.heal) {
      setText('witch-victim-info', `☠ Les loups ciblent : ${victimName} (potion de Vie épuisée)`);
    }
  } else {
    setText('witch-victim-info', 'Les loups n\'ont pas désigné de victime.');
    healSection.style.display = 'none';
  }

  // Potion de mort
  if (potions.kill) {
    renderPlayerGrid('witch-kill-grid', getAlivePlayers(), (pid) => {
      witchState.killTarget = pid;
      highlightSelected('witch-kill-grid', [pid]);
      confirmBtn.style.display = 'block';
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Utiliser la potion de Mort ☠';
    });
    killSection.style.display = 'block';
  } else {
    killSection.style.display = 'none';
  }

  healBtn.onclick = () => {
    socket.emit('nightAction', { roomId, step: 'sorciere', action: { type: 'heal' } });
    showScreen('waiting-screen');
    setText('waiting-text', 'Potion de Vie utilisée ✓');
  };

  document.getElementById('witch-skip-btn').onclick = () => {
    socket.emit('nightAction', { roomId, step: 'sorciere', action: { type: 'skip' } });
    showScreen('waiting-screen');
    setText('waiting-text', 'Vous passez votre tour.');
  };

  confirmBtn.onclick = () => {
    if (!witchState.killTarget) return;
    socket.emit('nightAction', {
      roomId, step: 'sorciere',
      action: { type: 'kill', targetId: witchState.killTarget }
    });
    showScreen('waiting-screen');
    setText('waiting-text', 'Potion de Mort utilisée ☠');
  };
});

// ── Fin de nuit ───────────────────────────────────────────────────────────────

socket.on('nightEnd', ({ deaths, players: p, waitingForChasseur }) => {
  if (p) players = p;
  setPhaseTitle('🌅 Réveil du village');
  setPhaseDesc('');

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
    ? 'Le Chasseur doit désigner sa cible…'
    : 'La phase de jour va commencer dans quelques secondes.');
  showScreen('death-screen');

  if (isMJ) updateMJPlayersList();
});

// ── Phase Jour ────────────────────────────────────────────────────────────────

socket.on('dayStarted', ({ turn, players: p }) => {
  players = p;
  hasVoted = false;
  voteOpen = false;

  setPhaseTitle(`☀️ Jour ${turn}`);
  setPhaseDesc('Débat en cours.');
  showScreen('waiting-screen');
  setText('waiting-text', 'Discutez ensemble. Le MJ va bientôt ouvrir le vote.');

  if (isMJ) {
    hide('mj-night-controls');
    show('mj-day-controls');
    show('mj-vote-btn');
    hide('mj-close-vote-btn');
    updateMJPlayersList();
  }
});

// ── Vote ──────────────────────────────────────────────────────────────────────

socket.on('voteStarted', ({ players: p, aliveCount }) => {
  players = p;
  voteOpen = true;
  hasVoted = false;
  setText('vote-total', aliveCount);
  setText('vote-current', '0');
  document.getElementById('my-vote-status').style.display = 'none';
  showDayVote();

  if (isMJ) {
    hide('mj-vote-btn');
    show('mj-close-vote-btn');
  }
});

function showDayVote() {
  setPhaseTitle('🗳 Vote du village');
  const alive = players.filter(p => p.isAlive);
  renderPlayerGrid('vote-grid', alive, (playerId) => {
    if (hasVoted) return;
    socket.emit('submitVote', { roomId, targetId: playerId });
    hasVoted = true;
    document.getElementById('my-vote-status').style.display = 'block';
    highlightSelected('vote-grid', [playerId]);
  });
  showScreen('day-vote');
}

socket.on('voteUpdate', ({ voteCount, aliveCount }) => {
  setText('vote-current', voteCount);
  setText('vote-total', aliveCount);
});

// ── Élimination ───────────────────────────────────────────────────────────────

socket.on('playerEliminated', ({ name, role, players: p, waitingForChasseur }) => {
  if (p) players = p;
  voteOpen = false;

  const info = ROLES[role] || { icon: '❓', name: role };
  setText('death-title', 'Joueur éliminé');
  document.getElementById('death-list').innerHTML =
    `<p>${info.icon} <strong>${name}</strong> était <em>${info.name}</em></p>`;
  setText('death-continue', waitingForChasseur
    ? 'Le Chasseur doit désigner sa cible…'
    : 'La nuit va commencer dans quelques secondes.');
  showScreen('death-screen');

  if (isMJ) {
    hide('mj-close-vote-btn');
    hide('mj-vote-btn');
    hide('mj-day-controls');
    updateMJPlayersList();
  }
});

socket.on('noElimination', ({ players: p }) => {
  if (p) players = p;
  voteOpen = false;

  setText('death-title', 'Résultat du vote');
  document.getElementById('death-list').innerHTML =
    '<p style="color:var(--warning);">⚖️ Égalité — personne n\'est éliminé ce tour.</p>';
  setText('death-continue', 'La nuit va commencer.');
  showScreen('death-screen');

  if (isMJ) {
    hide('mj-close-vote-btn');
    hide('mj-vote-btn');
    hide('mj-day-controls');
  }
});

// ── Chasseur ──────────────────────────────────────────────────────────────────

socket.on('chasseurAlert', ({ message }) => {
  setText('chasseur-msg', message);
  renderPlayerGrid('chasseur-grid', players.filter(p => p.isAlive), (playerId) => {
    socket.emit('chasseurShot', { roomId, targetId: playerId });
    showScreen('waiting-screen');
    setText('waiting-text', 'Tir effectué. En attente…');
  });
  showScreen('chasseur-screen');
  setPhaseTitle('🏹 Tir du Chasseur');
});

socket.on('chasseurShot', ({ name, role, players: p }) => {
  if (p) players = p;
  const info = ROLES[role] || { icon: '❓', name: role };
  showNotif(`${info.icon} ${name} (${info.name}) abattu par le Chasseur`, 'warning');
  if (isMJ) updateMJPlayersList();
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
    const ri = ROLES[p.role] || { icon: '❓', name: p.role };
    const row = document.createElement('p');
    row.style.marginBottom = '6px';
    row.innerHTML = `${p.isAlive ? '🟢' : '💀'} <strong>${p.name}</strong> — ${ri.icon} ${ri.name}`;
    rolesDiv.appendChild(row);
  });

  showScreen('game-end-screen');
  setPhaseTitle('🏆 Fin de partie');
  clearRoomContext();
});

// ── Dashboard MJ ──────────────────────────────────────────────────────────────

socket.on('mjUpdate', ({ players: p }) => {
  players = p;
  updateMJPlayersList();
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

document.getElementById('mj-next-btn').addEventListener('click', () => {
  socket.emit('mjForceNextStep', { roomId });
});

document.getElementById('mj-vote-btn').addEventListener('click', () => {
  socket.emit('startVote', { roomId });
});

document.getElementById('mj-close-vote-btn').addEventListener('click', () => {
  socket.emit('closeVote', { roomId });
  hide('mj-close-vote-btn');
});

// ── Helpers joueurs ───────────────────────────────────────────────────────────

function getAlivePlayers(excludeSelf = false) {
  const token = getOrCreateSessionToken();
  return players.filter(p => p.isAlive && (!excludeSelf || p.playerId !== token));
}

function getAliveNotWolves() {
  // Les loups ne peuvent voter que pour des non-loups (règle classique)
  return players.filter(p => p.isAlive && p.role !== 'loup');
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
  'role-reveal', 'lovers-reveal', 'night-action', 'day-vote',
  'waiting-screen', 'death-screen', 'chasseur-screen', 'game-end-screen'
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

function highlightSelected(containerId, ids) {
  document.querySelectorAll(`#${containerId} .player-card`).forEach(card => {
    card.classList.toggle('selected', ids.includes(card.dataset.id));
  });
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
