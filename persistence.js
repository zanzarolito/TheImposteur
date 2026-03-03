// Module de persistance avec lowdb

const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const adapter = new FileSync('db.json');
const db = low(adapter);

// Initialiser la structure de la base de données
db.defaults({ rooms: {} }).write();

const TTL = 24 * 60 * 60 * 1000; // 24 heures

function persistRoom(room) {
  const toSave = {
    ...room,
    lastActivityAt: Date.now(),
    expiresAt: Date.now() + TTL,
    players: room.players.map(p => ({
      ...p,
      socketId: null // Ne pas persister les socket IDs
    }))
  };
  
  // Utiliser la syntaxe correcte pour lowdb
  const rooms = db.get('rooms').value() || {};
  rooms[room.id] = toSave;
  db.set('rooms', rooms).write();
  
  console.log(`[Persistence] Room ${room.id} sauvegardée`);
  
  // Vérifier immédiatement
  const check = db.get('rooms').value();
  console.log(`[Persistence] Vérification: Room ${room.id} existe =`, !!check[room.id]);
}

function loadRoom(roomId) {
  console.log(`[Persistence] Tentative de chargement de la room ${roomId}`);
  
  const allRooms = db.get('rooms').value();
  console.log(`[Persistence] Rooms disponibles:`, Object.keys(allRooms || {}));
  
  const room = allRooms ? allRooms[roomId] : null;
  
  if (!room) {
    console.log(`[Persistence] Room ${roomId} non trouvée dans la base`);
    return null;
  }
  
  // Vérifier le TTL
  if (Date.now() > room.expiresAt) {
    console.log(`[Persistence] Room ${roomId} expirée`);
    deleteRoom(roomId);
    return null;
  }
  
  console.log(`[Persistence] Room ${roomId} chargée avec succès`);
  return room;
}

function deleteRoom(roomId) {
  const rooms = db.get('rooms').value() || {};
  delete rooms[roomId];
  db.set('rooms', rooms).write();
}

function getAllRooms() {
  return db.get('rooms').value() || {};
}

function cleanExpiredRooms() {
  const rooms = getAllRooms();
  const now = Date.now();
  let cleaned = 0;
  
  for (const [id, room] of Object.entries(rooms)) {
    if (now > room.expiresAt) {
      deleteRoom(id);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`[Cleanup] ${cleaned} rooms expirées supprimées`);
  }
}

// Nettoyage automatique toutes les heures
setInterval(cleanExpiredRooms, 60 * 60 * 1000);

module.exports = {
  persistRoom,
  loadRoom,
  deleteRoom,
  getAllRooms,
  cleanExpiredRooms
};
