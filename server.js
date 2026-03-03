const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static('public'));

const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function saveRooms() {
  const data = {};
  rooms.forEach((room, id) => {
    data[id] = room;
  });
  fs.writeFileSync('db.json', JSON.stringify({ rooms: data }, null, 2));
}

function loadRooms() {
  try {
    if (fs.existsSync('db.json')) {
      const data = JSON.parse(fs.readFileSync('db.json', 'utf8'));
      if (data.rooms) {
        Object.entries(data.rooms).forEach(([id, room]) => {
          rooms.set(id, room);
        });
      }
    }
  } catch (e) {
    console.error('Erreur chargement:', e);
  }
}

loadRooms();

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

io.on('connection', (socket) => {
  console.log(`[Socket] Connexion: ${socket.id}`);

  socket.on('createRoom', ({ playerName, sessionToken }) => {
    const roomId = generateRoomCode();
    console.log(`[Create] Room ${roomId} par ${playerName}`);

    const room = {
      id: roomId,
      status: 'lobby',
      createdAt: Date.now(),
      players: [{
        playerId: socket.id,
        socketId: socket.id,
        sessionToken,
        name: playerName,
        playerNumber: 1,
        isMJ: true,
        isAlive: true,
        role: null,
        isBot: false
      }],
      gameState: {
        phase: 'lobby',
        turn: 0,
        composition: null,
        nightActions: {},
        dayVotes: {}
      }
    };

    rooms.set(roomId, room);
    socket.join(roomId);
    saveRooms();

    console.log(`[Create] Room ${roomId} créée. Total: ${rooms.size}`);
    console.log(`[Create] Rooms en mémoire:`, Array.from(rooms.keys()));

    socket.emit('roomCreated', { roomId, playerNumber: 1, isMJ: true });
  });

  socket.on('joinRoom', ({ roomId, playerName, sessionToken }) => {
    console.log(`[Join] ${playerName} rejoint ${roomId}`);
    console.log(`[Join] Rooms disponibles:`, Array.from(rooms.keys()));

    const room = rooms.get(roomId);

    if (!room) {
      console.log(`[Join] Room ${roomId} NOT FOUND`);
      socket.emit('error', { message: 'Room introuvable' });
      return;
    }

    console.log(`[Join] Room ${roomId} trouvée`);

    if (room.status !== 'lobby') {
      socket.emit('error', { message: 'Partie déjà commencée' });
      return;
    }

    if (room.players.some(p => p.name === playerName)) {
      socket.emit('error', { message: 'Pseudo déjà utilisé' });
      return;
    }

    const playerNumber = room.players.length + 1;
    room.players.push({
      playerId: socket.id,
      socketId: socket.id,
      sessionToken,
      name: playerName,
      playerNumber,
      isMJ: false,
      isAlive: true,
      role: null,
      isBot: false
    });

    socket.join(roomId);
    saveRooms();

    console.log(`[Join] ${playerName} a rejoint ${roomId}. Total joueurs: ${room.players.length}`);

    socket.emit('roomJoined', { roomId, playerNumber, isMJ: false });

    io.to(roomId).emit('playerJoined', {
      players: room.players.map(p => ({
        name: p.name,
        playerNumber: p.playerNumber,
        online: !!p.socketId || p.isBot
      }))
    });
  });

  socket.on('addTestPlayers', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const botNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank'];
    const botsToAdd = Math.min(6, 20 - room.players.length);

    for (let i = 0; i < botsToAdd; i++) {
      room.players.push({
        playerId: `bot-${Date.now()}-${i}`,
        socketId: null,
        sessionToken: `bot-token-${i}`,
        name: `${botNames[i]} (Bot)`,
        playerNumber: room.players.length + 1,
        isMJ: false,
        isAlive: true,
        role: null,
        isBot: true
      });
    }

    saveRooms();

    io.to(roomId).emit('playerJoined', {
      players: room.players.map(p => ({
        name: p.name,
        playerNumber: p.playerNumber,
        online: !!p.socketId || p.isBot
      }))
    });

    socket.emit('testPlayersAdded', { count: botsToAdd });
  });

  socket.on('setComposition', ({ roomId, composition }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    room.gameState.composition = composition;
    saveRooms();

    io.to(roomId).emit('compositionUpdated', { composition });
  });

  socket.on('startGame', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.players.length < 6) {
      socket.emit('error', { message: 'Minimum 6 joueurs requis' });
      return;
    }

    const composition = room.gameState.composition || getDefaultComposition(room.players.length);
    const rolePool = [];

    Object.entries(composition).forEach(([roleId, count]) => {
      for (let i = 0; i < count; i++) {
        rolePool.push(roleId);
      }
    });

    for (let i = rolePool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rolePool[i], rolePool[j]] = [rolePool[j], rolePool[i]];
    }

    room.players.forEach((p, index) => {
      p.role = rolePool[index];
    });

    room.status = 'playing';
    room.gameState.phase = 'night';
    room.gameState.turn = 1;

    saveRooms();

    room.players.forEach(p => {
      if (p.socketId) {
        io.to(p.socketId).emit('roleAssigned', {
          role: p.role,
          playerNumber: p.playerNumber
        });
      }
    });

    io.to(roomId).emit('gameStarted', { phase: 'night', turn: 1 });
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Déconnexion: ${socket.id}`);

    rooms.forEach((room, roomId) => {
      const player = room.players.find(p => p.socketId === socket.id);
      if (player) {
        player.socketId = null;

        if (room.status === 'lobby') {
          room.players = room.players.filter(p => p.playerId !== player.playerId);
          if (room.players.length === 0) {
            rooms.delete(roomId);
            console.log(`[Cleanup] Room ${roomId} supprimée`);
          }
        }

        saveRooms();
      }
    });
  });
});

function getDefaultComposition(playerCount) {
  const compositions = {
    6: { loup: 2, villageois: 2, voyante: 1, sorciere: 1 },
    7: { loup: 2, villageois: 3, voyante: 1, sorciere: 1 },
    8: { loup: 2, villageois: 3, voyante: 1, chasseur: 1, sorciere: 1 },
    9: { loup: 3, villageois: 3, voyante: 1, chasseur: 1, sorciere: 1 },
    10: { loup: 3, villageois: 3, voyante: 1, chasseur: 1, sorciere: 1, cupidon: 1 }
  };

  return compositions[playerCount] || compositions[6];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Server] Démarré sur le port ${PORT}`);
  console.log(`[Server] Rooms en mémoire: ${rooms.size}`);
});
