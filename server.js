const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs');

const { distributeRoles, checkVictory, getNextNightStep, resolveNightKills } = require('./game-logic');
const { getDefaultComposition } = require('./roles');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static('public'));

// ─── Persistance ────────────────────────────────────────────────────────────

const DB_FILE = 'db.json';
const rooms = new Map(); // roomId -> room

function saveRooms() {
  const data = {};
  rooms.forEach((room, id) => {
    // Ne pas persister les timers en mémoire
    data[id] = {
      ...room,
      players: room.players.map(({ reconnectTimer, ...p }) => p)
    };
  });
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify({ rooms: data }, null, 2));
  } catch (e) {
    console.error('[DB] Erreur sauvegarde:', e.message);
  }
}

function loadRooms() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (data.rooms) {
        const now = Date.now();
        Object.entries(data.rooms).forEach(([id, room]) => {
          // Ignorer les rooms expirées (30 min d'inactivité)
          if (room.lastActivityAt && now - room.lastActivityAt > 30 * 60 * 1000) return;
          // Réinitialiser tous les sockets (perdus au redémarrage)
          room.players.forEach(p => { p.socketId = null; p.reconnectTimer = null; });
          rooms.set(id, room);
        });
      }
    }
  } catch (e) {
    console.error('[DB] Erreur chargement:', e.message);
  }
}

// Nettoyage automatique toutes les heures
setInterval(() => {
  const now = Date.now();
  let count = 0;
  rooms.forEach((room, id) => {
    const inactif = now - (room.lastActivityAt || room.createdAt) > 30 * 60 * 1000;
    if (inactif) {
      rooms.delete(id);
      count++;
    }
  });
  if (count > 0) {
    console.log(`[Cleanup] ${count} salle(s) expirée(s) supprimée(s)`);
    saveRooms();
  }
}, 60 * 60 * 1000);

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

function touch(room) {
  room.lastActivityAt = Date.now();
}

function getPlayerByToken(room, sessionToken) {
  return room.players.find(p => p.sessionToken === sessionToken);
}

function getPublicPlayers(room) {
  return room.players.map(p => ({
    playerId: p.playerId,
    name: p.name,
    playerNumber: p.playerNumber,
    isMJ: p.isMJ,
    isAlive: p.isAlive,
    isBot: p.isBot,
    online: !!p.socketId || p.isBot
  }));
}

// Uniquement pour le MJ : inclut les rôles
function getMJPlayers(room) {
  return room.players.map(p => ({
    playerId: p.playerId,
    name: p.name,
    playerNumber: p.playerNumber,
    isMJ: p.isMJ,
    isAlive: p.isAlive,
    isBot: p.isBot,
    online: !!p.socketId || p.isBot,
    role: p.role,
    loverPartnerId: p.loverPartnerId
  }));
}

// ─── Helpers divers ──────────────────────────────────────────────────────────

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Boucle de jeu (nuit) ───────────────────────────────────────────────────

function advanceNightStep(io, room) {
  const alivePlayers = room.players.filter(p => p.isAlive);
  const nextStep = getNextNightStep(room.gameState.nightStep, room.gameState.turn, alivePlayers);
  room.gameState.nightStep = nextStep;
  room.gameState.nightActions = {};
  touch(room);

  if (nextStep === 'end') {
    resolveNight(io, room);
    return;
  }

  saveRooms();
  io.to(room.id).emit('nightStepChanged', { step: nextStep, turn: room.gameState.turn });

  const mj = room.players.find(p => p.isMJ && p.socketId);

  // Informations spécifiques selon l'étape — envoyées au MJ
  if (nextStep === 'loups') {
    const wolves = alivePlayers.filter(p => p.role === 'loup');
    const wolfNames = wolves.map(w => ({ name: w.name, playerId: w.playerId }));
    if (mj) io.to(mj.socketId).emit('mjNightStepInfo', { step: 'loups', wolves: wolfNames });

  } else if (nextStep === 'sorciere') {
    const victim = room.players.find(p => p.playerId === room.gameState.wolfTarget);
    if (mj) {
      io.to(mj.socketId).emit('sorciereInfo', {
        victimName: victim ? victim.name : null,
        victimId: room.gameState.wolfTarget || null,
        potions: room.gameState.witchPotions
      });
    }
  }
}

function resolveNight(io, room) {
  const victims = [];

  // Victime des loups (sauf si la sorcière a guéri)
  if (room.gameState.wolfTarget && !room.gameState.witchHealed) {
    victims.push(room.gameState.wolfTarget);
  }
  // Victime de la potion de mort
  if (room.gameState.witchKillTarget) {
    victims.push(room.gameState.witchKillTarget);
  }

  let deaths = resolveNightKills(victims, room.players);

  // Gestion du Chasseur : le MJ choisit sa cible
  const deadHunter = deaths.find(d => d.role === 'chasseur');
  if (deadHunter) {
    room.gameState.waitingForChasseur = deadHunter.playerId;
    saveRooms();
    const deathInfo = deaths.map(d => ({ name: d.name, role: d.role, playerId: d.playerId }));
    io.to(room.id).emit('nightEnd', { deaths: deathInfo, waitingForChasseur: true });
    const mj = room.players.find(p => p.isMJ && p.socketId);
    if (mj) {
      io.to(mj.socketId).emit('chasseurAlert', {
        message: `${deadHunter.name} (Chasseur) est mort cette nuit. Choisissez sa cible.`
      });
    }
    return;
  }

  finishNightResolution(io, room, deaths);
}

function finishNightResolution(io, room, deaths) {
  room.gameState.wolfTarget = null;
  room.gameState.wolfVotes = {};
  room.gameState.witchHealed = false;
  room.gameState.witchKillTarget = null;
  room.gameState.waitingForChasseur = null;
  touch(room);

  const victory = checkVictory(room.players);
  if (victory) {
    endGame(io, room, victory);
    return;
  }

  saveRooms();

  const deathInfo = deaths.map(d => ({ name: d.name, role: d.role, playerId: d.playerId }));
  io.to(room.id).emit('nightEnd', {
    deaths: deathInfo,
    players: getPublicPlayers(room)
  });

  // Phase jour après 5 secondes
  setTimeout(() => startDay(io, room), 5000);
}

function startDay(io, room) {
  room.gameState.phase = 'day';
  room.gameState.voteOpen = false;
  touch(room);
  saveRooms();

  io.to(room.id).emit('dayStarted', {
    turn: room.gameState.turn,
    players: getPublicPlayers(room)
  });

  // Le MJ voit immédiatement le panneau d'élimination
  const mj = room.players.find(p => p.isMJ && p.socketId);
  if (mj) io.to(mj.socketId).emit('mjDayControl', { players: getMJPlayers(room) });
}

function startNewNight(io, room) {
  room.gameState.turn++;
  room.gameState.phase = 'night';
  room.gameState.nightStep = null;
  room.gameState.wolfVotes = {};
  room.gameState.wolfTarget = null;
  room.gameState.witchHealed = false;
  room.gameState.witchKillTarget = null;
  touch(room);
  saveRooms();

  io.to(room.id).emit('newNight', {
    turn: room.gameState.turn,
    players: getPublicPlayers(room)
  });

  setTimeout(() => advanceNightStep(io, room), 3000);
}

function endGame(io, room, victory) {
  room.status = 'ended';
  touch(room);
  saveRooms();
  io.to(room.id).emit('gameEnd', {
    winner: victory.winner,
    winners: victory.players.map(p => ({ name: p.name, role: p.role })),
    allPlayers: room.players.map(p => ({ name: p.name, role: p.role, isAlive: p.isAlive }))
  });
}

// ─── API REST ────────────────────────────────────────────────────────────────

app.get('/api/rooms', (req, res) => {
  const list = [];
  rooms.forEach((room, id) => {
    list.push({
      id,
      status: room.status,
      playerCount: room.players.length,
      players: room.players.map(p => p.name)
    });
  });
  res.json({ rooms: list, count: rooms.size });
});

// ─── Socket.IO ───────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  // ── identify : reconnexion via session token ──────────────────────────────
  socket.on('identify', ({ sessionToken, roomId }) => {
    if (!sessionToken || !roomId) {
      socket.emit('sessionExpired', { reason: 'missingData' });
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('sessionExpired', { reason: 'roomNotFound' });
      return;
    }

    const player = getPlayerByToken(room, sessionToken);
    if (!player) {
      socket.emit('sessionExpired', { reason: 'tokenMismatch' });
      return;
    }

    // Annuler le timer de grâce s'il était en cours
    if (player.reconnectTimer) {
      clearTimeout(player.reconnectTimer);
      player.reconnectTimer = null;
    }

    player.socketId = socket.id;
    socket.join(roomId);
    touch(room);
    saveRooms();

    console.log(`[Reconnect] ${player.name} → ${roomId}`);

    // Notifier les autres joueurs
    socket.to(roomId).emit('playerReconnected', { playerName: player.name });
    io.to(roomId).emit('playersUpdate', { players: getPublicPlayers(room) });

    // Envoyer l'état complet au joueur qui revient
    socket.emit('sessionRestored', {
      roomId,
      playerNumber: player.playerNumber,
      isMJ: player.isMJ,
      status: room.status,
      players: getPublicPlayers(room),
      gameState: {
        phase: room.gameState.phase,
        turn: room.gameState.turn,
        composition: room.gameState.composition,
        nightStep: room.gameState.nightStep,
        voteOpen: room.gameState.voteOpen || false
      }
    });

    // Si la partie est en cours, renvoyer son rôle
    if (room.status === 'playing' && player.role) {
      socket.emit('roleAssigned', { role: player.role, playerNumber: player.playerNumber });
    }

    // Si MJ, renvoyer la vue complète
    if (player.isMJ) {
      socket.emit('mjUpdate', { players: getMJPlayers(room) });
    }
  });

  // ── createRoom ────────────────────────────────────────────────────────────
  socket.on('createRoom', ({ playerName, sessionToken }) => {
    if (!playerName || !sessionToken) return;

    let roomId;
    do { roomId = generateRoomCode(); } while (rooms.has(roomId));

    const room = {
      id: roomId,
      status: 'lobby',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      players: [{
        playerId: sessionToken,
        socketId: socket.id,
        sessionToken,
        name: playerName.trim().slice(0, 20),
        playerNumber: 1,
        isMJ: true,
        isAlive: true,
        role: null,
        isBot: false,
        loverPartnerId: null,
        reconnectTimer: null
      }],
      gameState: {
        phase: 'lobby',
        turn: 0,
        composition: null,
        nightStep: null,
        nightActions: {},
        wolfVotes: {},
        wolfTarget: null,
        witchPotions: { heal: true, kill: true },
        witchHealed: false,
        witchKillTarget: null,
        dayVotes: {},
        voteOpen: false,
        waitingForChasseur: null
      }
    };

    rooms.set(roomId, room);
    socket.join(roomId);
    saveRooms();

    console.log(`[Room] Créée: ${roomId} par ${playerName}`);
    socket.emit('roomCreated', { roomId, playerNumber: 1, isMJ: true });
  });

  // ── joinRoom ──────────────────────────────────────────────────────────────
  socket.on('joinRoom', ({ roomId, playerName, sessionToken }) => {
    if (!roomId || !playerName || !sessionToken) return;

    const room = rooms.get(roomId.toUpperCase().trim());
    if (!room) {
      socket.emit('joinError', { message: 'Salle introuvable. Vérifiez le code.' });
      return;
    }

    // Vérifier si ce joueur est déjà dans la salle (reconnexion)
    const existing = getPlayerByToken(room, sessionToken);
    if (existing) {
      if (existing.reconnectTimer) {
        clearTimeout(existing.reconnectTimer);
        existing.reconnectTimer = null;
      }
      existing.socketId = socket.id;
      socket.join(roomId);
      touch(room);
      saveRooms();
      socket.emit('roomJoined', {
        roomId,
        playerNumber: existing.playerNumber,
        isMJ: existing.isMJ
      });
      io.to(roomId).emit('playersUpdate', { players: getPublicPlayers(room) });
      return;
    }

    if (room.status !== 'lobby') {
      socket.emit('joinError', { message: 'La partie a déjà commencé.' });
      return;
    }

    const trimmedName = playerName.trim().slice(0, 20);
    if (!trimmedName) {
      socket.emit('joinError', { message: 'Pseudo invalide.' });
      return;
    }

    if (room.players.some(p => p.name.toLowerCase() === trimmedName.toLowerCase())) {
      socket.emit('joinError', { message: 'Ce pseudo est déjà utilisé dans cette salle.' });
      return;
    }

    if (room.players.length >= 20) {
      socket.emit('joinError', { message: 'La salle est pleine (20 joueurs max).' });
      return;
    }

    const playerNumber = room.players.length + 1;
    room.players.push({
      playerId: sessionToken,
      socketId: socket.id,
      sessionToken,
      name: trimmedName,
      playerNumber,
      isMJ: false,
      isAlive: true,
      role: null,
      isBot: false,
      loverPartnerId: null,
      reconnectTimer: null
    });

    socket.join(roomId);
    touch(room);
    saveRooms();

    console.log(`[Room] ${trimmedName} a rejoint ${roomId} (${room.players.length} joueurs)`);

    socket.emit('roomJoined', { roomId, playerNumber, isMJ: false });
    io.to(roomId).emit('playersUpdate', { players: getPublicPlayers(room) });

    // Mettre à jour le dashboard MJ
    const mj = room.players.find(p => p.isMJ && p.socketId);
    if (mj) {
      io.to(mj.socketId).emit('mjUpdate', { players: getMJPlayers(room) });
    }
  });

  // ── addTestPlayers (MJ uniquement) ───────────────────────────────────────
  socket.on('addTestPlayers', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'lobby') return;
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender || !sender.isMJ) return;

    const botNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Gabriel', 'Héloïse'];
    const existing = room.players.map(p => p.name);
    const available = botNames.filter(n => !existing.includes(`${n} (Bot)`));
    const toAdd = Math.min(available.length, 20 - room.players.length);

    for (let i = 0; i < toAdd; i++) {
      const botToken = `bot-${Date.now()}-${i}`;
      room.players.push({
        playerId: botToken,
        socketId: null,
        sessionToken: botToken,
        name: `${available[i]} (Bot)`,
        playerNumber: room.players.length + 1,
        isMJ: false,
        isAlive: true,
        role: null,
        isBot: true,
        loverPartnerId: null,
        reconnectTimer: null
      });
    }

    touch(room);
    saveRooms();
    io.to(roomId).emit('playersUpdate', { players: getPublicPlayers(room) });
    socket.emit('testPlayersAdded', { count: toAdd });

    const mj = room.players.find(p => p.isMJ && p.socketId);
    if (mj) io.to(mj.socketId).emit('mjUpdate', { players: getMJPlayers(room) });
  });

  // ── setComposition (MJ uniquement) ───────────────────────────────────────
  socket.on('setComposition', ({ roomId, composition }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'lobby') return;
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender || !sender.isMJ) return;
    room.gameState.composition = composition;
    touch(room);
    saveRooms();
    io.to(roomId).emit('compositionUpdated', { composition });
  });

  // ── startGame ─────────────────────────────────────────────────────────────
  socket.on('startGame', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'lobby') return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || !player.isMJ) return;

    // Le MJ n'a pas de rôle : seuls les joueurs non-MJ participent
    const gamePlayers = room.players.filter(p => !p.isMJ);

    if (gamePlayers.length < 6) {
      socket.emit('gameError', { message: 'Il faut au minimum 6 joueurs (hors MJ) pour lancer la partie.' });
      return;
    }

    const composition = room.gameState.composition || getDefaultComposition(gamePlayers.length);
    const totalRoles = Object.values(composition).reduce((a, b) => a + b, 0);

    if (totalRoles !== gamePlayers.length) {
      socket.emit('gameError', {
        message: `La composition ne correspond pas : ${totalRoles} rôles pour ${gamePlayers.length} joueurs.`
      });
      return;
    }

    // Distribuer les rôles uniquement aux joueurs non-MJ
    const assigned = distributeRoles(gamePlayers, composition);
    assigned.forEach((p, i) => {
      gamePlayers[i].role = p.role;
      gamePlayers[i].isAlive = true;
      gamePlayers[i].loverPartnerId = null;
    });

    room.status = 'playing';
    room.gameState.phase = 'night';
    room.gameState.turn = 1;
    room.gameState.nightStep = null;
    room.gameState.composition = composition;
    room.gameState.witchPotions = { heal: true, kill: true };
    touch(room);
    saveRooms();

    // Envoyer le rôle à chaque joueur connecté (pas au MJ)
    room.players.forEach(p => {
      if (p.socketId && !p.isMJ) {
        io.to(p.socketId).emit('roleAssigned', {
          role: p.role,
          playerNumber: p.playerNumber
        });
      }
    });

    io.to(roomId).emit('gameStarted', {
      phase: 'night',
      turn: 1,
      players: getPublicPlayers(room)
    });

    // Tableau de bord MJ avec tous les rôles
    io.to(socket.id).emit('mjUpdate', { players: getMJPlayers(room) });

    // Première nuit après 8s (laisse le temps de voir son rôle)
    setTimeout(() => advanceNightStep(io, room), 8000);
  });

  // ── mjNightAction : le MJ effectue l'action de nuit ─────────────────────
  socket.on('mjNightAction', ({ roomId, step, action }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    if (room.gameState.phase !== 'night' || room.gameState.nightStep !== step) return;

    const mj = room.players.find(p => p.socketId === socket.id);
    if (!mj || !mj.isMJ) return;

    const alivePlayers = room.players.filter(p => p.isAlive);

    if (step === 'cupidon') {
      const { player1Id, player2Id } = action;
      if (player1Id === player2Id) return;
      const p1 = room.players.find(p => p.playerId === player1Id);
      const p2 = room.players.find(p => p.playerId === player2Id);
      if (p1 && p2) {
        p1.loverPartnerId = player2Id;
        p2.loverPartnerId = player1Id;
        if (p1.socketId) io.to(p1.socketId).emit('youAreLovers', { partnerName: p2.name });
        if (p2.socketId) io.to(p2.socketId).emit('youAreLovers', { partnerName: p1.name });
      }
      touch(room); saveRooms();
      advanceNightStep(io, room);

    } else if (step === 'voyante') {
      const { targetId } = action;
      const target = room.players.find(p => p.playerId === targetId);
      if (target) {
        // Montrer au MJ ET à la voyante (sur son téléphone, discrètement)
        socket.emit('voyantResult', { targetName: target.name, targetRole: target.role });
        const voyante = alivePlayers.find(p => p.role === 'voyante' && p.socketId);
        if (voyante) io.to(voyante.socketId).emit('voyantResult', { targetName: target.name, targetRole: target.role });
      }
      touch(room); saveRooms();
      advanceNightStep(io, room);

    } else if (step === 'loups') {
      const { targetId } = action;
      const target = room.players.find(p => p.playerId === targetId && p.isAlive && !p.isMJ);
      if (!target) return;
      room.gameState.wolfTarget = targetId;
      touch(room); saveRooms();
      advanceNightStep(io, room);

    } else if (step === 'sorciere') {
      const { type, targetId } = action;
      if (type === 'heal' && room.gameState.witchPotions.heal) {
        room.gameState.witchHealed = true;
        room.gameState.witchPotions.heal = false;
      } else if (type === 'kill' && room.gameState.witchPotions.kill && targetId) {
        room.gameState.witchKillTarget = targetId;
        room.gameState.witchPotions.kill = false;
      }
      touch(room); saveRooms();
      advanceNightStep(io, room);

    } else if (step === 'petite_fille') {
      touch(room); saveRooms();
      advanceNightStep(io, room);
    }
  });

  // ── mjEliminatePlayer : le MJ élimine un joueur après le vote du jour ────
  socket.on('mjEliminatePlayer', ({ roomId, targetId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    if (room.gameState.phase !== 'day') return;

    const mj = room.players.find(p => p.socketId === socket.id);
    if (!mj || !mj.isMJ) return;

    // Égalité / personne
    if (!targetId || targetId === 'none') {
      touch(room); saveRooms();
      io.to(roomId).emit('noElimination', { players: getPublicPlayers(room) });
      const victory = checkVictory(room.players);
      if (victory) { endGame(io, room, victory); return; }
      setTimeout(() => startNewNight(io, room), 4000);
      return;
    }

    const target = room.players.find(p => p.playerId === targetId && p.isAlive && !p.isMJ);
    if (!target) return;

    // resolveNightKills gère la cascade amoureux
    const deaths = resolveNightKills([targetId], room.players);
    touch(room);

    // Chasseur parmi les morts → le MJ choisit sa cible
    const deadChasseur = deaths.find(d => d.role === 'chasseur');
    if (deadChasseur) {
      room.gameState.waitingForChasseur = deadChasseur.playerId;
      saveRooms();
      io.to(roomId).emit('playerEliminated', {
        name: target.name, role: target.role, playerId: target.playerId,
        players: getPublicPlayers(room), waitingForChasseur: true
      });
      io.to(socket.id).emit('chasseurAlert', {
        message: `${deadChasseur.name} (Chasseur) est éliminé. Choisissez sa cible.`
      });
      return;
    }

    saveRooms();

    // Annoncer toutes les morts (cible + amoureux éventuel)
    deaths.forEach(d => {
      io.to(roomId).emit('playerEliminated', {
        name: d.name, role: d.role, playerId: d.playerId,
        players: getPublicPlayers(room)
      });
    });

    const victory = checkVictory(room.players);
    if (victory) { endGame(io, room, victory); return; }
    setTimeout(() => startNewNight(io, room), 4000);
  });

  // ── mjChasseurShot : le MJ choisit la cible du Chasseur ──────────────────
  socket.on('mjChasseurShot', ({ roomId, targetId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    if (!room.gameState.waitingForChasseur) return;

    const mj = room.players.find(p => p.socketId === socket.id);
    if (!mj || !mj.isMJ) return;

    const target = room.players.find(p => p.playerId === targetId && p.isAlive && !p.isMJ);
    if (!target) return;

    resolveNightKills([targetId], room.players);
    room.gameState.waitingForChasseur = null;
    touch(room);

    const victory = checkVictory(room.players);
    if (victory) { saveRooms(); endGame(io, room, victory); return; }

    saveRooms();
    io.to(room.id).emit('chasseurShot', {
      name: target.name, role: target.role, players: getPublicPlayers(room)
    });

    if (room.gameState.phase === 'night') {
      setTimeout(() => finishNightResolution(io, room, []), 3000);
    } else {
      setTimeout(() => startNewNight(io, room), 4000);
    }
  });

  // ── mjForceNextStep : le MJ peut forcer l'étape suivante ─────────────────
  socket.on('mjForceNextStep', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    if (room.gameState.phase !== 'night') return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || !player.isMJ) return;

    console.log(`[MJ] Force next step dans ${roomId}`);
    advanceNightStep(io, room);
  });

  // ── disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id}`);

    rooms.forEach((room, roomId) => {
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) return;

      player.socketId = null;

      if (room.status === 'lobby') {
        // En lobby : supprimer après 5s si pas reconnecté
        player.reconnectTimer = setTimeout(() => {
          const p = room.players.find(pl => pl.sessionToken === player.sessionToken);
          if (p && !p.socketId && !p.isBot) {
            room.players = room.players.filter(pl => pl.sessionToken !== player.sessionToken);
            room.players.forEach((pl, i) => { pl.playerNumber = i + 1; });

            if (room.players.length === 0) {
              rooms.delete(roomId);
              console.log(`[Room] ${roomId} supprimée (vide)`);
            } else {
              io.to(roomId).emit('playersUpdate', { players: getPublicPlayers(room) });
              const mj = room.players.find(pl => pl.isMJ && pl.socketId);
              if (mj) io.to(mj.socketId).emit('mjUpdate', { players: getMJPlayers(room) });
            }
            saveRooms();
          }
        }, 5000);

      } else if (room.status === 'playing') {
        // En partie : grace period de 2 minutes
        touch(room);
        saveRooms();

        socket.to(roomId).emit('playerReconnecting', {
          playerName: player.name,
          graceSeconds: 120
        });

        player.reconnectTimer = setTimeout(() => {
          const p = room.players.find(pl => pl.sessionToken === player.sessionToken);
          if (p && !p.socketId) {
            io.to(roomId).emit('playerDisconnected', {
              playerName: player.name,
              gracePeriodExpired: true
            });
          }
        }, 120000);
      }

      io.to(roomId).emit('playersUpdate', { players: getPublicPlayers(room) });
    });
  });
});

// ─── Démarrage ───────────────────────────────────────────────────────────────

loadRooms();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Server] http://localhost:${PORT}`);
  console.log(`[Server] ${rooms.size} salle(s) chargée(s) depuis le disque`);
});
