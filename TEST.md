# Guide de Test

## Étape 1 : Démarrer le serveur

```bash
npm start
```

Vous devriez voir :
```
[Server] Démarré sur le port 3000
[Server] Rooms en mémoire: 0
```

## Étape 2 : Test Socket.IO

Ouvrez : `http://localhost:3000/simple-test.html`

Vous devriez voir :
- "Socket.IO chargé !"
- "Connecté ! Socket ID: xxxxx"

Si vous voyez une erreur "io is not defined", Socket.IO ne se charge pas.

## Étape 3 : Créer une room

1. Ouvrez : `http://localhost:3000`
2. Attendez "✓ Connecté" (en vert)
3. Entrez un pseudo (ex: "Alice")
4. Cliquez "Créer une partie"

Logs serveur attendus :
```
[Socket] Nouvelle connexion: xxxxx
[Create] Création room XXXXXXXX par Alice
[Create] Room XXXXXXXX créée. Total rooms: 1
```

## Étape 4 : Vérifier la room

Ouvrez : `http://localhost:3000/api/rooms`

Vous devriez voir :
```json
{
  "rooms": [
    {
      "id": "XXXXXXXX",
      "status": "lobby",
      "playerCount": 1,
      "players": ["Alice"]
    }
  ],
  "count": 1
}
```

## Étape 5 : Rejoindre la room

1. Ouvrez un nouvel onglet : `http://localhost:3000`
2. Attendez "✓ Connecté"
3. Entrez un pseudo (ex: "Bob")
4. Entrez le code EXACT de la room (8 caractères)
5. Cliquez "Rejoindre une partie"

Logs serveur attendus :
```
[Socket] Nouvelle connexion: yyyyy
[Join] Bob tente de rejoindre XXXXXXXX
[Join] Rooms disponibles: [ 'XXXXXXXX' ]
[Join] ✓ Room XXXXXXXX trouvée
[Join] ✓ Bob a rejoint XXXXXXXX. Total joueurs: 2
```

## Problèmes courants

### "io is not defined"
- Socket.IO ne se charge pas
- Vérifiez que le serveur est démarré
- Vérifiez `/socket.io/socket.io.js` dans le navigateur

### "Room introuvable"
- Le code est incorrect
- Vérifiez `/api/rooms` pour voir les rooms disponibles
- Copiez-collez le code exact depuis le lobby

### Rien ne se passe
- Ouvrez la console navigateur (F12)
- Regardez les logs serveur
- Vérifiez que "✓ Connecté" apparaît
