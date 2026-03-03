# 🐺 Loup-Garou en Ligne

Application web multijoueur pour jouer au Loup-Garou de Thiercelieux avec persistance des parties.

## Fonctionnalités

- ✅ Création et partage de rooms avec code unique
- ✅ Distribution automatique des rôles
- ✅ Gestion des phases nuit/jour
- ✅ Votes en temps réel
- ✅ Persistance des parties (reconnexion après déconnexion)
- ✅ Dashboard Maître du Jeu
- ✅ PWA (installable sur mobile)
- ✅ Mode sombre

## Rôles disponibles

- Villageois
- Loup-Garou
- Voyante
- Sorcière
- Chasseur
- Cupidon
- Petite Fille

## Stack technique

- **Backend**: Node.js + Express + Socket.IO
- **Frontend**: HTML5 + JavaScript vanilla
- **Persistance**: lowdb (JSON file)
- **Temps réel**: WebSocket (Socket.IO)

## Installation

```bash
npm install
```

## Démarrage

```bash
npm start
```

L'application sera accessible sur `http://localhost:3000`

## Déploiement

Compatible avec Render.com, Railway, Heroku, ou tout hébergeur Node.js.

### Variables d'environnement

- `PORT`: Port du serveur (défaut: 3000)

## Architecture

```
├── server.js              # Serveur principal
├── persistence.js         # Gestion persistance
├── game-logic.js          # Logique métier
├── roles.js               # Définition des rôles
└── public/
    ├── index.html         # Accueil
    ├── lobby.html         # Salle d'attente
    ├── game.html          # Interface de jeu
    └── js/
        ├── socket-client.js
        ├── session.js
        ├── lobby.js
        └── game.js
```

## Utilisation

1. Créer une partie et partager le code de room (8 caractères alphanumériques)
2. Les joueurs rejoignent avec le code
3. Le MJ configure la composition des rôles
4. **Mode Test** : Le MJ peut ajouter 6 joueurs bots pour tester
5. Lancement de la partie
6. Les rôles sont distribués automatiquement
7. Le jeu se déroule avec alternance nuit/jour

## Mode Test

Pour faciliter les tests, le MJ peut ajouter jusqu'à 6 joueurs bots depuis le lobby :
- Cliquez sur "Ajouter 6 joueurs test"
- Les bots apparaissent dans la liste des joueurs
- Configurez la composition normalement
- Lancez la partie comme d'habitude

## Persistance

Les parties sont sauvegardées automatiquement. En cas de déconnexion :
- Grace period de 2 minutes avant notification
- Reconnexion automatique avec session token
- État de jeu restauré

## Licence

MIT
