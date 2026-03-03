// Gestion de la session locale avec localStorage

const SESSION_KEY = 'loupgarou_session_token';
const ROOM_KEY = 'loupgarou_room_id';
const PLAYER_KEY = 'loupgarou_player_number';

function getOrCreateSessionToken() {
  let token = localStorage.getItem(SESSION_KEY);
  if (!token) {
    token = crypto.randomUUID();
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
