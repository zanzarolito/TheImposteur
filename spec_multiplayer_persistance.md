# Spécification : Système de Connexion Multijoueur avec Salles et Persistance

## Vue d'ensemble

Système permettant à plusieurs joueurs de se connecter à des salles de jeu privées pour jouer à 7 Wonders Duel en ligne. Chaque salle accueille exactement 2 joueurs et utilise un code unique pour l'identification.

Cette version ajoute une couche de **persistance côté serveur** pour gérer tous les cas de déconnexion involontaire : fermeture d'onglet, rechargement de page, perte réseau, changement d'appareil, crash navigateur, etc.

---

## 1. Architecture Technique

### 1.1 Stack Technologique
- **Backend** : Node.js + Express + Socket.IO
- **Frontend** : HTML5 + JavaScript vanilla
- **Communication** : WebSocket (Socket.IO) pour temps réel
- **Persistance** : `lowdb` (JSON file) ou Redis (production)
- **Déploiement** : Render.com (compatible HTTPS)

### 1.2 Structure des Fichiers

```
├── server.js                    # Serveur principal avec gestion des rooms
├── persistence.js               # Module de persistance (lecture/écriture)
├── db.json                      # Base de données JSON locale (lowdb)
├── public/
│   ├── index.html              # Lobby (création/rejoindre room)
│   ├── game.html               # Interface de jeu
│   └── js/
│       ├── multiplayer.js      # Client Socket.IO
│       └── session.js          # Gestion session locale (localStorage)
```

---

## 2. Modèle de Persistance

### 2.1 Principe Général

L'état du jeu est sauvegardé **à chaque action** dans un stockage persistant. L'identité d'un joueur est liée à un **Session Token** (UUID généré côté client, stocké en `localStorage`), indépendant du socket ID.

```
Session Token (localStorage)  ←→  Room ID  ←→  Game State (JSON)
      stable                            |              sauvegardé à chaque action
   persiste entre rechargements         |
```

### 2.2 Structure d'une Room Persistée

```javascript
{
  id: "ABC123",
  status: "waiting" | "playing" | "finished" | "abandoned",
  createdAt: 1709500000000,
  lastActivityAt: 1709503600000,
  expiresAt: 1709590000000,          // TTL : 24h après dernière activité
  players: [
    {
      sessionToken: "uuid-v4-alice",  // ← clé d'identité stable
      id: "socket-id-1",             // ← volatile, mis à null si déconnecté
      name: "Alice",
      playerNumber: 1,
      connectedAt: 1709500000000,
      disconnectedAt: null,
      reconnectGracePeriod: 120000    // 2 min avant de notifier l'adversaire
    }
  ],
  gameState: { /* état complet du jeu */ },
  gameStateVersion: 42,              // Incrémenté à chaque sauvegarde
  actionLog: [                       // Historique des actions pour replay/debug
    { version: 1, action: "buildCard", player: 1, data: {...}, timestamp: ... },
    ...
  ]
}
```

### 2.3 Session Token (Client)

```javascript
// session.js — chargé sur toutes les pages
const SESSION_KEY = '7wd_session_token';
const ROOM_KEY    = '7wd_room_id';
const PLAYER_KEY  = '7wd_player_number';

function getOrCreateSessionToken() {
  let token = localStorage.getItem(SESSION_KEY);
  if (!token) {
    token = crypto.randomUUID(); // UUID v4 natif
    localStorage.setItem(SESSION_KEY, token);
  }
  return token;
}

function saveRoomContext(roomId, playerNumber) {
  localStorage.setItem(ROOM_KEY, roomId);
  localStorage.setItem(PLAYER_KEY, String(playerNumber));
}

function getRoomContext() {
  return {
    roomId: localStorage.getItem(ROOM_KEY),
    playerNumber: parseInt(localStorage.getItem(PLAYER_KEY))
  };
}

function clearRoomContext() {
  localStorage.removeItem(ROOM_KEY);
  localStorage.removeItem(PLAYER_KEY);
}
```

---

## 3. Cas de Déconnexion et Réponses Système

### 3.1 Tableau des Cas

| # | Scénario | Déclencheur | Comportement attendu |
|---|----------|-------------|----------------------|
| 1 | Fermeture d'onglet accidentelle | `disconnect` socket | Partie conservée, grace period 2 min |
| 2 | Rechargement de page (F5) | `disconnect` + reconnect rapide | Reconnexion transparente, état restauré |
| 3 | Perte réseau temporaire | Timeout socket | Grace period, reconnexion auto Socket.IO |
| 4 | Changement d'appareil | Nouvel appareil, même session token | Reconnexion possible si même token |
| 5 | Crash navigateur | `disconnect` brutal | Identique au cas 1 |
| 6 | Session token perdu (navigation privée) | Token inconnu du serveur | Proposition de rejoindre via code room |
| 7 | Inactivité longue (partie en pause) | TTL dépassé | Room marquée `abandoned`, nettoyage |
| 8 | Déconnexion en lobby | `disconnect` en status `waiting` | Room supprimée, l'autre joueur notifié |
| 9 | Déconnexion pendant l'écran de fin | `disconnect` en status `finished` | Résultats conservés, aucune action bloquée |
| 10 | Les 2 joueurs déconnectés simultanément | Double `disconnect` | Room conservée avec TTL normal |

### 3.2 Grace Period (Cas 1, 3, 5)

Quand un joueur se déconnecte en cours de partie, le serveur ne notifie **pas immédiatement** l'adversaire.

```javascript
// Durées configurables
const GRACE_PERIODS = {
  lobby: 0,         // Suppression immédiate
  playing: 120000,  // 2 minutes
  finished: 0       // Aucune action bloquée, notif immédiate OK
};

socket.on('disconnect', () => {
  const { room, player } = findPlayerBySocket(socket.id);
  if (!room) return;

  player.id = null;
  player.disconnectedAt = Date.now();

  if (room.status === 'lobby') {
    rooms.delete(room.id);
    socket.to(room.id).emit('roomClosed', { reason: 'hostLeft' });
    return;
  }

  if (room.status === 'playing') {
    const grace = GRACE_PERIODS.playing;
    player.reconnectTimer = setTimeout(() => {
      // Grace period expirée : notifier l'adversaire
      socket.to(room.id).emit('playerDisconnected', {
        playerName: player.name,
        gracePeriodExpired: true
      });
      persistRoom(room); // Sauvegarder l'état du timeout
    }, grace);

    // Notifier immédiatement que l'adversaire est "en train de se reconnecter"
    socket.to(room.id).emit('playerReconnecting', {
      playerName: player.name,
      graceSeconds: grace / 1000
    });

    persistRoom(room);
  }
});
```

### 3.3 Reconnexion par Session Token

C'est le **flux principal** de récupération. À chaque connexion Socket.IO, le client envoie son token.

```javascript
// Côté client (multiplayer.js)
this.socket.on('connect', () => {
  const token = getOrCreateSessionToken();
  const { roomId, playerNumber } = getRoomContext();

  this.socket.emit('identify', {
    sessionToken: token,
    roomId,       // Peut être null si pas de contexte local
    playerNumber
  });
});

// Côté serveur
socket.on('identify', ({ sessionToken, roomId, playerNumber }) => {
  // Cas 1 : Le joueur avait une room en cours
  if (roomId) {
    const room = rooms.get(roomId) || loadRoomFromDisk(roomId);
    if (!room) {
      socket.emit('sessionExpired', { reason: 'roomNotFound' });
      return;
    }

    const player = room.players.find(p => p.sessionToken === sessionToken);
    if (!player) {
      socket.emit('sessionExpired', { reason: 'tokenMismatch' });
      return;
    }

    // Mettre à jour le socket ID
    if (player.reconnectTimer) {
      clearTimeout(player.reconnectTimer);
      player.reconnectTimer = null;
    }
    player.id = socket.id;
    player.disconnectedAt = null;
    socket.join(roomId);

    // Annuler la notif de déco si elle était en attente
    socket.to(roomId).emit('playerReconnected', { playerName: player.name });

    // Renvoyer l'état complet
    socket.emit('sessionRestored', {
      roomId,
      playerNumber: player.playerNumber,
      gameState: room.gameState,
      gameStateVersion: room.gameStateVersion,
      players: room.players.map(p => ({ name: p.name, playerNumber: p.playerNumber, online: !!p.id }))
    });

    persistRoom(room);
    return;
  }

  // Cas 2 : Pas de contexte local, chercher par token dans toutes les rooms
  const existingRoom = findRoomByToken(sessionToken);
  if (existingRoom) {
    // Rediriger vers la bonne room
    const player = existingRoom.players.find(p => p.sessionToken === sessionToken);
    socket.emit('redirectToRoom', {
      roomId: existingRoom.id,
      playerNumber: player.playerNumber,
      gameState: existingRoom.gameState
    });
    return;
  }

  // Cas 3 : Vraiment nouveau joueur, rien à restaurer
  socket.emit('noSession');
});
```

### 3.4 Cas Spécial : Changement d'Appareil (Cas 4)

Si un joueur perd son téléphone mais a le token dans son cloud (ex: navigateur synchronisé), il peut continuer sur un autre appareil.

Condition : le **session token** est identique. Si le joueur est sur un appareil complètement différent sans token, voir cas 6.

### 3.5 Session Token Perdu (Cas 6)

Le joueur arrive sans token valide mais connaît le code de la room.

```javascript
// Côté client : formulaire "Rejoindre une partie existante"
// Si l'identifiant du token échoue, proposer :
socket.on('sessionExpired', ({ reason }) => {
  if (reason === 'tokenMismatch') {
    showUI('rejoindre-avec-code', {
      message: "Votre session a expiré. Entrez le code de la room et votre nom pour reprendre."
    });
  }
});

// Côté serveur : rejoindre en tant que "spectateur du joueur X"
socket.on('claimPlayer', ({ roomId, playerNumber, playerName }) => {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'playing') {
    socket.emit('error', 'Impossible de rejoindre cette partie.');
    return;
  }

  const player = room.players.find(p => p.playerNumber === playerNumber);
  if (player.id !== null) {
    // L'autre joueur est encore connecté, refuser
    socket.emit('error', 'Ce joueur est déjà connecté.');
    return;
  }

  // Vérifier le nom pour éviter l'usurpation
  if (player.name !== playerName) {
    socket.emit('error', 'Nom incorrect.');
    return;
  }

  // Générer un nouveau token pour ce joueur
  const newToken = generateServerToken();
  player.sessionToken = newToken;
  player.id = socket.id;
  socket.join(roomId);

  socket.emit('sessionRestored', {
    roomId,
    playerNumber,
    newSessionToken: newToken, // Client doit le stocker
    gameState: room.gameState
  });
});
```

---

## 4. Persistance sur Disque

### 4.1 Sauvegarde

La room est persistée **après chaque action de jeu** et à chaque changement de statut.

```javascript
// persistence.js
const fs = require('fs');
const DB_PATH = './db.json';

function loadDB() {
  if (!fs.existsSync(DB_PATH)) return { rooms: {} };
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function persistRoom(room) {
  const db = loadDB();
  // Ne pas persister les timers
  const toSave = {
    ...room,
    players: room.players.map(({ reconnectTimer, ...p }) => p)
  };
  db.rooms[room.id] = toSave;
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function loadRoomFromDisk(roomId) {
  const db = loadDB();
  const room = db.rooms[roomId];
  if (!room) return null;

  // Vérifier le TTL
  if (Date.now() > room.expiresAt) {
    delete db.rooms[roomId];
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    return null;
  }
  return room;
}

function deleteRoom(roomId) {
  const db = loadDB();
  delete db.rooms[roomId];
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// Au démarrage du serveur : charger les rooms actives en mémoire
function hydrateRoomsOnStartup(roomsMap) {
  const db = loadDB();
  const now = Date.now();
  for (const [id, room] of Object.entries(db.rooms)) {
    if (now < room.expiresAt) {
      room.players.forEach(p => { p.id = null; }); // Tous hors ligne au redémarrage
      roomsMap.set(id, room);
    }
  }
  console.log(`[Startup] ${roomsMap.size} rooms chargées depuis le disque.`);
}
```

### 4.2 Sauvegarde de l'État de Jeu

```javascript
// À appeler dans chaque action (buildCard, discardCard, buildWonder, etc.)
function saveGameState(roomId, newState) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.gameState = newState;
  room.gameStateVersion++;
  room.lastActivityAt = Date.now();
  room.expiresAt = Date.now() + 24 * 60 * 60 * 1000; // +24h

  // Ajouter au log (optionnel, pour debug/replay)
  room.actionLog.push({
    version: room.gameStateVersion,
    timestamp: Date.now(),
    state: newState // ou juste le diff
  });

  persistRoom(room);
}

// Événement serveur
socket.on('gameStateUpdate', ({ roomId, gameState }) => {
  const room = rooms.get(roomId);
  if (!room) return;

  room.gameState = gameState;
  saveGameState(roomId, gameState);

  // Diffuser aux autres joueurs de la room
  socket.to(roomId).emit('gameStateSync', gameState);
});
```

### 4.3 Nettoyage Automatique (TTL)

```javascript
// Exécuté toutes les heures
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, room] of rooms.entries()) {
    if (now > room.expiresAt) {
      rooms.delete(id);
      deleteRoom(id);
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`[Cleanup] ${cleaned} rooms expirées supprimées.`);
}, 60 * 60 * 1000);
```

---

## 5. Gestion des Connexions Socket.IO (Mise à Jour)

### 5.1 Événements Serveur → Client (Nouveaux)

| Événement | Données | Description |
|-----------|---------|-------------|
| `sessionRestored` | `{ roomId, playerNumber, gameState, gameStateVersion }` | Session récupérée avec succès |
| `sessionExpired` | `{ reason }` | Session introuvable ou expirée |
| `redirectToRoom` | `{ roomId, playerNumber, gameState }` | Rediriger vers une room existante |
| `noSession` | — | Pas de session à restaurer |
| `playerReconnecting` | `{ playerName, graceSeconds }` | L'adversaire se reconnecte |
| `playerReconnected` | `{ playerName }` | L'adversaire est revenu |
| `playerDisconnected` | `{ playerName, gracePeriodExpired }` | L'adversaire est vraiment parti |
| `roomClosed` | `{ reason }` | La room a été fermée |

### 5.2 Événements Client → Serveur (Nouveaux)

| Événement | Données | Description |
|-----------|---------|-------------|
| `identify` | `{ sessionToken, roomId, playerNumber }` | Identification à la connexion |
| `claimPlayer` | `{ roomId, playerNumber, playerName }` | Reprendre un slot sans token |
| `requestSync` | `{ roomId, knownVersion }` | Demander un état si version obsolète |
| `abandonRoom` | `roomId` | Quitter définitivement la partie |

---

## 6. Expérience Utilisateur en Cas de Déconnexion

### 6.1 Indicateurs Visuels

```javascript
// Dans game.html
socket.on('playerReconnecting', ({ playerName, graceSeconds }) => {
  showBanner('warning', `⏳ ${playerName} s'est déconnecté. Attente de reconnexion... (${graceSeconds}s)`);
  startCountdown(graceSeconds, () => {
    showBanner('error', `${playerName} ne s'est pas reconnecté. Vous pouvez attendre ou quitter.`);
    showButton('abandonRoom', 'Retour au lobby');
    showButton('waitMore', 'Attendre encore');
  });
});

socket.on('playerReconnected', ({ playerName }) => {
  hideBanner();
  notify(`✅ ${playerName} est de retour !`, 'success');
});
```

### 6.2 Bouton "Continuer une partie"

Sur `index.html`, si un contexte de room existe en localStorage :

```javascript
// session.js
window.addEventListener('DOMContentLoaded', () => {
  const { roomId, playerNumber } = getRoomContext();
  if (roomId) {
    showButton('resume-btn', `Reprendre la partie (Room ${roomId})`);
    document.getElementById('resume-btn').onclick = () => {
      window.location.href = `game.html?room=${roomId}&player=${playerNumber}`;
    };
  }
});
```

### 6.3 Message de Resynchronisation

Si un joueur revient après une longue absence (version de l'état obsolète) :

```javascript
socket.on('sessionRestored', ({ gameState, gameStateVersion }) => {
  const localVersion = G.version || 0;
  if (gameStateVersion > localVersion + 1) {
    notify('🔄 Votre état de jeu a été mis à jour pendant votre absence.', 'info');
  }
  syncGameState(gameState);
});
```

---

## 7. Flux Complet avec Persistance

### 7.1 Diagramme : Reconnexion Transparente (F5 / Fermeture Onglet)

```
Joueur 1                    Serveur                  Joueur 2
   |                           |                         |
   | [ferme l'onglet]           |                         |
   |--disconnect (brutal)------>|                         |
   |                           |--playerReconnecting----->|
   |                           |  (grace 2 min)           |
   | [rouvre l'onglet]          |                         |
   |--identify(token, room)---->|                         |
   |                           | [token reconnu]          |
   |<--sessionRestored(state)---|                         |
   |                           |--playerReconnected------>|
   |                           |                         |
```

### 7.2 Diagramme : Session Token Perdu

```
Joueur 1 (nouveau device)    Serveur
   |                            |
   |--identify(?, room)-------->|
   |                            | [token inconnu]
   |<--sessionExpired-----------|
   |                            |
   | [formulaire claimPlayer]   |
   |--claimPlayer(room, 1, nom)->|
   |                            | [nom vérifié, slot libre]
   |<--sessionRestored(state)---|
   |                            |
```

---

## 8. Sécurité (Mise à Jour)

### 8.1 Validations Supplémentaires

- ✅ Un token ne peut revendiquer qu'un seul slot par room
- ✅ `claimPlayer` impossible si le slot est déjà occupé (socket actif)
- ✅ Vérification du nom lors d'un `claimPlayer`
- ✅ Rate limiting sur `identify` et `claimPlayer` (max 10/min par IP)
- ✅ Session tokens expirés nettoyés avec la room

### 8.2 Ce que le système ne protège PAS

- ❌ Pas d'authentification réelle : un joueur connaissant le code et le nom peut usurper
- ❌ Pas de chiffrement du `gameState` en transit (utiliser HTTPS)
- Pour un niveau de sécurité supérieur : implémenter des comptes utilisateurs (voir Section 11)

---

## 9. Configuration pour Render.com (Inchangée)

Identique à la v1.0 — voir section 6 de la spec originale.

À noter : sur Render.com (plan gratuit), le serveur peut être mis en veille après inactivité. La persistance sur disque (db.json) est perdue au redémarrage. Options :

- **Plan payant Render** : disque persistant
- **Redis externe** (ex: Upstash) : persistance fiable, gratuit jusqu'à 10k commandes/jour
- **Approche hybride** : stocker db.json dans un bucket S3/R2 (sauvegarde toutes les 5 min)

---

## 10. Points d'Attention

### 10.1 Données en Mémoire vs Disque

| Donnée | En mémoire (Map) | Sur disque (JSON) |
|--------|-----------------|-------------------|
| Rooms actives | ✅ | ✅ |
| Socket IDs | ✅ | ❌ (volatile) |
| Timers (grace period) | ✅ | ❌ |
| Game State | ✅ | ✅ |
| Action Log | ✅ | ✅ (optionnel) |
| Rooms expirées | ❌ | ❌ (nettoyées) |

### 10.2 Gestion du Redémarrage Serveur

Au redémarrage, toutes les connexions Socket.IO sont perdues. Les clients tenteront de se reconnecter via `reconnection: true`. Le serveur rechargera les rooms depuis le disque avec tous les sockets à `null`. Les joueurs seront guidés par `sessionRestored` vers le bon état.

### 10.3 Limites du Système

- L'`actionLog` peut devenir volumineux sur des parties longues. Limiter à 200 entrées ou ne conserver que le dernier état.
- `lowdb` (JSON) n'est pas adapté à plus de ~50 rooms simultanées. Migrer vers SQLite ou Redis pour la production.

---

## 11. Améliorations Futures

### 11.1 Court Terme
- [ ] Indicateur "en ligne / hors ligne" pour chaque joueur
- [ ] Toast "Reprise de la partie" au retour du joueur
- [ ] Sauvegarde d'une "partie abandonnée" consultable en lecture seule

### 11.2 Moyen Terme
- [ ] Comptes utilisateurs → tokens liés à un compte, pas à un navigateur
- [ ] Migration vers Redis pour la persistance multi-instance
- [ ] Limit du nombre de reconnexions par partie (anti-abus)
- [ ] Replay des actions depuis l'`actionLog`

### 11.3 Long Terme
- [ ] Tournois avec gestion d'état persistante multi-parties
- [ ] Historique des parties par joueur
- [ ] Détection de triche (vérification server-side des actions)

---

## 12. Glossaire (Mise à Jour)

| Terme | Définition |
|-------|------------|
| **Room** | Salle de jeu privée identifiée par un code unique |
| **Socket ID** | Identifiant volatile de connexion Socket.IO (change à chaque reconnexion) |
| **Session Token** | UUID stable stocké en `localStorage`, clé d'identité persistante du joueur |
| **Game State** | État complet du jeu (cartes, joueurs, scores, etc.) |
| **Grace Period** | Délai avant de notifier l'adversaire d'une déconnexion (défaut : 2 min) |
| **TTL** | Time To Live — durée de vie d'une room inactive avant nettoyage (défaut : 24h) |
| **Hydration** | Rechargement des rooms persistées en mémoire au démarrage du serveur |
| **Claim** | Action de reprendre un slot de joueur sans session token valide |
| **Sync** | Synchronisation de l'état entre les clients |
| **Draft** | Phase de sélection des merveilles en début de partie |

---

**Version** : 2.0  
**Date** : 2026-03-03  
**Basée sur** : Spec v1.0 — Système de Connexion Multijoueur avec Salles
