const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs');

const { distributeRoles, checkVictory, getNextNightStep, resolveNightKills, resolveDayVote } = require('./game-logic');
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

// ─── Simulation des bots ─────────────────────────────────────────────────────

// Choisit un élément aléatoire dans un tableau
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Simule les actions nocturnes des bots pour l'étape en cours
function simulateBotNightActions(io, room, step) {
  // Délai aléatoire pour simuler la réflexion (1,5 – 3 s)
  const delay = 1500 + Math.random() * 1500;

  setTimeout(() => {
    // Vérifier que la partie est toujours à cette étape (guard contre race conditions)
    if (room.status !== 'playing' || room.gameState.nightStep !== step) return;

    const alive = room.players.filter(p => p.isAlive);

    if (step === 'cupidon') {
      const bot = alive.find(p => p.role === 'cupidon' && p.isBot);
      if (!bot) return;

      const pool = alive.filter(p => p.playerId !== bot.playerId);
      if (pool.length < 2) { advanceNightStep(io, room); return; }

      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      const [p1, p2] = shuffled;
      p1.loverPartnerId = p2.playerId;
      p2.loverPartnerId = p1.playerId;
      if (p1.socketId) io.to(p1.socketId).emit('youAreLovers', { partnerName: p2.name });
      if (p2.socketId) io.to(p2.socketId).emit('youAreLovers', { partnerName: p1.name });
      touch(room); saveRooms();
      advanceNightStep(io, room);

    } else if (step === 'voyante') {
      const bot = alive.find(p => p.role === 'voyante' && p.isBot);
      if (!bot) return;
      // La voyante bot voit un rôle aléatoire (pas de UI, on avance)
      touch(room);
      advanceNightStep(io, room);

    } else if (step === 'loups') {
      const aliveWolves = alive.filter(p => p.role === 'loup');
      const botWolves   = aliveWolves.filter(p => p.isBot && !room.gameState.wolfVotes[p.playerId]);
      if (botWolves.length === 0) return; // Tous les loups bots ont déjà voté

      // Les loups bots votent pour une cible non-loup aléatoire
      const targets = alive.filter(p => p.role !== 'loup');
      if (targets.length === 0) { advanceNightStep(io, room); return; }
      const target = pickRandom(targets);

      botWolves.forEach(wolf => { room.gameState.wolfVotes[wolf.playerId] = target.playerId; });

      const votedWolves = aliveWolves.filter(w => room.gameState.wolfVotes[w.playerId]);

      // Informer les loups humains du vote des bots
      aliveWolves.filter(w => !w.isBot && w.socketId).forEach(w => {
        io.to(w.socketId).emit('wolfVoteUpdate', {
          votes: room.gameState.wolfVotes,
          total: aliveWolves.length,
          voted: votedWolves.length
        });
      });

      if (votedWolves.length >= aliveWolves.length) {
        const counts = {};
        Object.values(room.gameState.wolfVotes).forEach(id => { counts[id] = (counts[id] || 0) + 1; });
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        room.gameState.wolfTarget = top ? top[0] : null;
        touch(room); saveRooms();
        advanceNightStep(io, room);
      } else {
        touch(room); saveRooms();
      }

    } else if (step === 'sorciere') {
      const bot = alive.find(p => p.role === 'sorciere' && p.isBot);
      if (!bot) return;
      // Stratégie bot : utiliser la potion de vie si quelqu'un est ciblé, jamais la mort
      if (room.gameState.wolfTarget && room.gameState.witchPotions.heal) {
        room.gameState.witchHealed = true;
        room.gameState.witchPotions.heal = false;
      }
      touch(room); saveRooms();
      advanceNightStep(io, room);

    } else if (step === 'petite_fille') {
      const bot = alive.find(p => p.role === 'petite_fille' && p.isBot);
      if (!bot) return;
      // La petite fille bot passe son tour discrètement
      touch(room);
      advanceNightStep(io, room);
    }
  }, delay);
}

// Simule le vote du jour de tous les bots vivants
function simulateBotDayVotes(io, room) {
  const aliveBots = room.players.filter(p => p.isAlive && p.isBot);
  if (aliveBots.length === 0) return;

  const delay = 1500 + Math.random() * 1500;

  setTimeout(() => {
    if (room.status !== 'playing' || !room.gameState.voteOpen) return;

    const alive = room.players.filter(p => p.isAlive);

    aliveBots.forEach(bot => {
      if (room.gameState.dayVotes[bot.playerId]) return; // déjà voté
      const targets = alive.filter(p => p.playerId !== bot.playerId);
      if (targets.length === 0) return;
      room.gameState.dayVotes[bot.playerId] = pickRandom(targets).playerId;
    });

    touch(room); saveRooms();

    const aliveReal  = alive.filter(p => !p.isBot).length;
    const votedReal  = alive.filter(p => !p.isBot && room.gameState.dayVotes[p.playerId]).length;

    io.to(room.id).emit('voteUpdate', { voteCount: votedReal, aliveCount: aliveReal });

    const mj = room.players.find(p => p.isMJ && p.socketId);
    if (mj) io.to(mj.socketId).emit('mjVoteUpdate', { votes: room.gameState.dayVotes });

    if (aliveReal === 0 || votedReal >= aliveReal) resolveDay(io, room);
  }, delay);
}

// Gère le tir automatique d'un Chasseur bot à sa mort
function simulateBotChasseur(io, room, deadHunter, allDeaths, phase) {
  const targets = room.players.filter(p => p.isAlive && p.playerId !== deadHunter.playerId);

  if (targets.length > 0) {
    const target = pickRandom(targets);
    const extraDeaths = resolveNightKills([target.playerId], room.players);
    allDeaths.push(...extraDeaths);
    io.to(room.id).emit('chasseurShot', {
      name: target.name,
      role: target.role,
      players: getPublicPlayers(room)
    });
  }

  room.gameState.waitingForChasseur = null;
  touch(room);

  const victory = checkVictory(room.players);
  if (victory) { saveRooms(); endGame(io, room, victory); return; }
  saveRooms();

  if (phase === 'night') {
    finishNightResolution(io, room, allDeaths);
  } else {
    // Phase jour : la mort vient d'être annoncée via playerEliminated juste avant l'appel
    setTimeout(() => startNewNight(io, room), 4000);
  }
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

  // Informations privées selon l'étape
  if (nextStep === 'loups') {
    const wolves = alivePlayers.filter(p => p.role === 'loup');
    const wolfNames = wolves.map(w => ({ name: w.name, playerId: w.playerId }));
    wolves.forEach(wolf => {
      if (wolf.socketId) {
        io.to(wolf.socketId).emit('wolvesInfo', { teammates: wolfNames });
      }
    });
  } else if (nextStep === 'sorciere') {
    const sorciere = alivePlayers.find(p => p.role === 'sorciere');
    if (sorciere && sorciere.socketId) {
      const victim = room.players.find(p => p.playerId === room.gameState.wolfTarget);
      io.to(sorciere.socketId).emit('sorciereInfo', {
        victimName: victim ? victim.name : null,
        victimId: room.gameState.wolfTarget || null,
        potions: room.gameState.witchPotions
      });
    }
  }

  // Simulation automatique des bots pour cette étape
  simulateBotNightActions(io, room, nextStep);
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

  // Gestion du Chasseur : il tire en mourant
  const deadHunter = deaths.find(d => d.role === 'chasseur');
  if (deadHunter) {
    if (deadHunter.isBot) {
      // Bot chasseur : tir automatique, puis on finit la nuit normalement
      simulateBotChasseur(io, room, deadHunter, deaths, 'night');
      return;
    }
    // Chasseur humain : attendre son tir
    room.gameState.waitingForChasseur = deadHunter.playerId;
    saveRooms();
    const deathInfo = deaths.map(d => ({ name: d.name, role: d.role, playerId: d.playerId }));
    io.to(room.id).emit('nightEnd', { deaths: deathInfo, waitingForChasseur: true });
    if (deadHunter.socketId) {
      io.to(deadHunter.socketId).emit('chasseurAlert', {
        message: 'Vous mourez cette nuit. Désignez un joueur à éliminer.'
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
  room.gameState.dayVotes = {};
  room.gameState.voteOpen = false;
  touch(room);
  saveRooms();

  io.to(room.id).emit('dayStarted', {
    turn: room.gameState.turn,
    players: getPublicPlayers(room)
  });
}

function resolveDay(io, room) {
  const votes = Object.entries(room.gameState.dayVotes).map(([voterId, targetId]) => ({
    voterId, targetId
  }));

  const eliminatedId = resolveDayVote(votes, room.players);

  if (!eliminatedId) {
    room.gameState.voteOpen = false;
    touch(room);
    saveRooms();
    io.to(room.id).emit('noElimination', { players: getPublicPlayers(room) });
  } else {
    const eliminated = room.players.find(p => p.playerId === eliminatedId);
    if (eliminated) {
      eliminated.isAlive = false;
      touch(room);

      // Chasseur éliminé de jour
      if (eliminated.role === 'chasseur') {
        room.gameState.voteOpen = false;
        if (eliminated.isBot) {
          // Bot chasseur : tir automatique avant l'annonce
          const targets = room.players.filter(p => p.isAlive && p.playerId !== eliminated.playerId);
          if (targets.length > 0) {
            const t = pickRandom(targets);
            resolveNightKills([t.playerId], room.players);
            io.to(room.id).emit('chasseurShot', { name: t.name, role: t.role, players: getPublicPlayers(room) });
          }
          // Laisser le code tomber dans l'emit playerEliminated ci-dessous
        } else {
          // Chasseur humain : attendre son tir
          room.gameState.waitingForChasseur = eliminated.playerId;
          saveRooms();
          io.to(room.id).emit('playerEliminated', {
            name: eliminated.name,
            role: eliminated.role,
            playerId: eliminated.playerId,
            players: getPublicPlayers(room),
            waitingForChasseur: true
          });
          if (eliminated.socketId) {
            io.to(eliminated.socketId).emit('chasseurAlert', {
              message: 'Vous êtes éliminé. Désignez un joueur à éliminer avant de partir.'
            });
          }
          return;
        }
      }

      saveRooms();
      io.to(room.id).emit('playerEliminated', {
        name: eliminated.name,
        role: eliminated.role,
        playerId: eliminated.playerId,
        players: getPublicPlayers(room)
      });
    }
  }

  room.gameState.voteOpen = false;
  saveRooms();

  const victory = checkVictory(room.players);
  if (victory) {
    endGame(io, room, victory);
    return;
  }

  // Nouvelle nuit
  setTimeout(() => startNewNight(io, room), 4000);
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

    if (room.players.length < 6) {
      socket.emit('gameError', { message: 'Il faut au minimum 6 joueurs pour lancer la partie.' });
      return;
    }

    const composition = room.gameState.composition || getDefaultComposition(room.players.length);
    const totalRoles = Object.values(composition).reduce((a, b) => a + b, 0);

    if (totalRoles !== room.players.length) {
      socket.emit('gameError', {
        message: `La composition ne correspond pas : ${totalRoles} rôles pour ${room.players.length} joueurs.`
      });
      return;
    }

    // Distribuer les rôles via game-logic
    const assigned = distributeRoles(room.players, composition);
    assigned.forEach((p, i) => {
      room.players[i].role = p.role;
      room.players[i].isAlive = true;
      room.players[i].loverPartnerId = null;
    });

    room.status = 'playing';
    room.gameState.phase = 'night';
    room.gameState.turn = 1;
    room.gameState.nightStep = null;
    room.gameState.composition = composition;
    room.gameState.witchPotions = { heal: true, kill: true };
    touch(room);
    saveRooms();

    // Envoyer le rôle à chaque joueur connecté
    room.players.forEach(p => {
      if (p.socketId) {
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

  // ── nightAction ───────────────────────────────────────────────────────────
  socket.on('nightAction', ({ roomId, step, action }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    if (room.gameState.phase !== 'night' || room.gameState.nightStep !== step) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || !player.isAlive) return;

    const alivePlayers = room.players.filter(p => p.isAlive);

    if (step === 'cupidon' && player.role === 'cupidon') {
      const { player1Id, player2Id } = action;
      if (player1Id === player2Id) {
        socket.emit('actionError', { message: 'Choisissez deux joueurs différents.' });
        return;
      }
      const p1 = room.players.find(p => p.playerId === player1Id);
      const p2 = room.players.find(p => p.playerId === player2Id);
      if (p1 && p2) {
        p1.loverPartnerId = player2Id;
        p2.loverPartnerId = player1Id;
        if (p1.socketId) io.to(p1.socketId).emit('youAreLovers', { partnerName: p2.name });
        if (p2.socketId) io.to(p2.socketId).emit('youAreLovers', { partnerName: p1.name });
      }
      touch(room);
      saveRooms();
      advanceNightStep(io, room);

    } else if (step === 'voyante' && player.role === 'voyante') {
      const { targetId } = action;
      const target = room.players.find(p => p.playerId === targetId);
      if (target) {
        socket.emit('voyantResult', { targetName: target.name, targetRole: target.role });
      }
      touch(room);
      advanceNightStep(io, room);

    } else if (step === 'loups' && player.role === 'loup') {
      const { targetId } = action;
      room.gameState.wolfVotes[player.playerId] = targetId;

      const aliveWolves = alivePlayers.filter(p => p.role === 'loup');
      const votedWolves = aliveWolves.filter(w => room.gameState.wolfVotes[w.playerId]);

      // Informer les autres loups du vote
      aliveWolves.forEach(w => {
        if (w.socketId && w.playerId !== player.playerId) {
          io.to(w.socketId).emit('wolfVoteUpdate', {
            votes: room.gameState.wolfVotes,
            total: aliveWolves.length,
            voted: votedWolves.length
          });
        }
      });

      if (votedWolves.length >= aliveWolves.length) {
        // Calculer la cible majoritaire
        const counts = {};
        Object.values(room.gameState.wolfVotes).forEach(id => {
          counts[id] = (counts[id] || 0) + 1;
        });
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        room.gameState.wolfTarget = top ? top[0] : null;
        touch(room);
        saveRooms();
        advanceNightStep(io, room);
      } else {
        touch(room);
        saveRooms();
      }

    } else if (step === 'sorciere' && player.role === 'sorciere') {
      const { type, targetId } = action;
      if (type === 'heal' && room.gameState.witchPotions.heal) {
        room.gameState.witchHealed = true;
        room.gameState.witchPotions.heal = false;
      } else if (type === 'kill' && room.gameState.witchPotions.kill && targetId) {
        room.gameState.witchKillTarget = targetId;
        room.gameState.witchPotions.kill = false;
      }
      touch(room);
      saveRooms();
      advanceNightStep(io, room);
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

  // ── startVote : le MJ ouvre le vote du jour ───────────────────────────────
  socket.on('startVote', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    if (room.gameState.phase !== 'day') return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || !player.isMJ) return;

    room.gameState.dayVotes = {};
    room.gameState.voteOpen = true;
    touch(room);
    saveRooms();

    const alivePlayers = room.players.filter(p => p.isAlive);
    io.to(roomId).emit('voteStarted', {
      players: getPublicPlayers(room),
      aliveCount: alivePlayers.length
    });

    // Simulation automatique des bots
    simulateBotDayVotes(io, room);
  });

  // ── submitVote : un joueur vote pendant la phase jour ─────────────────────
  socket.on('submitVote', ({ roomId, targetId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    if (room.gameState.phase !== 'day' || !room.gameState.voteOpen) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || !player.isAlive) return;

    const target = room.players.find(p => p.playerId === targetId && p.isAlive);
    if (!target) return;

    room.gameState.dayVotes[player.playerId] = targetId;
    touch(room);
    saveRooms();

    const alivePlayers = room.players.filter(p => p.isAlive);
    const votedCount = alivePlayers.filter(p =>
      room.gameState.dayVotes[p.playerId] && !p.isBot
    ).length;
    const aliveReal = alivePlayers.filter(p => !p.isBot).length;

    io.to(roomId).emit('voteUpdate', {
      voteCount: votedCount,
      aliveCount: aliveReal
    });

    // Mettre à jour le MJ avec les votes
    const mj = room.players.find(p => p.isMJ && p.socketId);
    if (mj) {
      io.to(mj.socketId).emit('mjVoteUpdate', { votes: room.gameState.dayVotes });
    }

    // Auto-clôture si tous les joueurs humains ont voté
    if (votedCount >= aliveReal) {
      resolveDay(io, room);
    }
  });

  // ── closeVote : le MJ clôture le vote ────────────────────────────────────
  socket.on('closeVote', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    if (room.gameState.phase !== 'day' || !room.gameState.voteOpen) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || !player.isMJ) return;

    resolveDay(io, room);
  });

  // ── chasseurShot : le chasseur tire en mourant ────────────────────────────
  socket.on('chasseurShot', ({ roomId, targetId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || player.role !== 'chasseur') return;
    if (room.gameState.waitingForChasseur !== player.playerId) return;

    const target = room.players.find(p => p.playerId === targetId && p.isAlive);
    if (!target) return;

    const chasseurDeaths = resolveNightKills([targetId], room.players);
    room.gameState.waitingForChasseur = null;
    touch(room);

    const victory = checkVictory(room.players);
    if (victory) {
      saveRooms();
      endGame(io, room, victory);
      return;
    }

    saveRooms();
    io.to(room.id).emit('chasseurShot', {
      name: target.name,
      role: target.role,
      players: getPublicPlayers(room)
    });

    // Reprendre le fil selon la phase
    if (room.gameState.phase === 'night') {
      setTimeout(() => finishNightResolution(io, room, []), 3000);
    } else {
      setTimeout(() => startNewNight(io, room), 4000);
    }
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
