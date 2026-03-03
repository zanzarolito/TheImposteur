// Test simple du serveur
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static('public'));

app.get('/test', (req, res) => {
  res.json({ status: 'OK', message: 'Serveur fonctionne' });
});

io.on('connection', (socket) => {
  console.log('Client connecté:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client déconnecté:', socket.id);
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Serveur de test sur http://localhost:${PORT}`);
  console.log(`Test API: http://localhost:${PORT}/test`);
});
