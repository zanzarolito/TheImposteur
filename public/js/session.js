// Gestion de la session locale avec localStorage

const SESSION_KEY   = 'loupgarou_session_token';
const ROOM_KEY      = 'loupgarou_room_id';
const PLAYER_KEY    = 'loupgarou_player_number';
const MJ_KEY        = 'loupgarou_is_mj';
const STARTED_KEY   = 'loupgarou_game_started';

function getOrCreateSessionToken() {
  let token = localStorage.getItem(SESSION_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, token);
  }
  return token;
}

function saveRoomContext(roomId, playerNumber, isMJ, gameStarted) {
  localStorage.setItem(ROOM_KEY,    roomId);
  localStorage.setItem(PLAYER_KEY,  String(playerNumber));
  localStorage.setItem(MJ_KEY,      isMJ ? 'true' : 'false');
  localStorage.setItem(STARTED_KEY, gameStarted ? 'true' : 'false');
}

function getRoomContext() {
  return {
    roomId:      localStorage.getItem(ROOM_KEY),
    playerNumber: parseInt(localStorage.getItem(PLAYER_KEY)) || 1,
    isMJ:        localStorage.getItem(MJ_KEY) === 'true',
    gameStarted: localStorage.getItem(STARTED_KEY) === 'true'
  };
}

function markGameStarted() {
  localStorage.setItem(STARTED_KEY, 'true');
}

function clearRoomContext() {
  localStorage.removeItem(ROOM_KEY);
  localStorage.removeItem(PLAYER_KEY);
  localStorage.removeItem(MJ_KEY);
  localStorage.removeItem(STARTED_KEY);
}
