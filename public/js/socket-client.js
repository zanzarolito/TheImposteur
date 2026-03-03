// Client Socket.IO simplifié

class SocketClient {
  constructor() {
    this.socket = null;
  }
  
  connect() {
    this.socket = io({
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10
    });
    
    this.socket.on('connect', () => {
      console.log('[Socket] Connecté au serveur');
    });
    
    this.socket.on('disconnect', () => {
      console.log('[Socket] Déconnecté du serveur');
    });
    
    this.socket.on('connect_error', (error) => {
      console.error('[Socket] Erreur de connexion:', error);
    });
    
    return this.socket;
  }
  
  createRoom(playerName) {
    const token = getOrCreateSessionToken();
    console.log('[Client] Création de room avec:', { playerName, token });
    this.socket.emit('createRoom', { playerName, sessionToken: token });
  }
  
  joinRoom(roomId, playerName) {
    const token = getOrCreateSessionToken();
    console.log('[Client] Rejoindre room:', { roomId, playerName, token });
    console.log('[Client] RoomId length:', roomId.length);
    console.log('[Client] RoomId chars:', roomId.split(''));
    this.socket.emit('joinRoom', { roomId, playerName, sessionToken: token });
  }
  
  on(event, callback) {
    this.socket.on(event, callback);
  }
  
  emit(event, data) {
    this.socket.emit(event, data);
  }
}
