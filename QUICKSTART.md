# 🚀 Guide de Démarrage Rapide

## Installation

```bash
npm install
```

## Lancement

```bash
npm start
```

L'application sera accessible sur `http://localhost:3000`

## Test Rapide

### 1. Créer une partie
- Ouvrez `http://localhost:3000`
- Entrez votre pseudo (ex: "Alice")
- Cliquez sur "Créer une partie"
- Notez le code de room (8 caractères, ex: `A3B7XY2K`)

### 2. Mode Test (recommandé pour tester seul)
- Dans le lobby, cliquez sur "Ajouter 6 joueurs test"
- 6 bots seront ajoutés automatiquement
- Configurez la composition des rôles (ou laissez par défaut)
- Cliquez sur "Lancer la partie"

### 3. Rejoindre avec de vrais joueurs
- Partagez le code ou le lien avec vos amis
- Ils entrent leur pseudo et le code de room
- Minimum 6 joueurs pour lancer

## Débuggage

### Voir les rooms actives
Ouvrez `http://localhost:3000/api/rooms` pour voir toutes les rooms en mémoire.

### Logs serveur
Le serveur affiche des logs détaillés :
- `[Create]` : Création de room
- `[Join]` : Joueur qui rejoint
- `[Persistence]` : Sauvegarde/chargement
- `[Startup]` : Démarrage du serveur

### Problèmes courants

**"Room introuvable"**
- Vérifiez que le code est correct (8 caractères)
- Vérifiez les logs serveur
- Consultez `/api/rooms` pour voir les rooms disponibles

**Les joueurs ne voient pas les autres**
- Vérifiez que Socket.IO est bien connecté (logs dans la console navigateur)
- Rechargez la page

**La partie ne démarre pas**
- Minimum 6 joueurs requis
- La composition doit correspondre au nombre de joueurs
- Seul le MJ peut lancer

## Structure des Codes

- **Room Code** : 8 caractères alphanumériques majuscules (ex: `A3B7XY2K`)
- **Session Token** : UUID stocké dans localStorage
- **Player Number** : Numéro unique dans la room (1-20)

## Fichiers Importants

- `db.json` : Base de données des rooms (créé automatiquement)
- `server.js` : Serveur principal
- `public/` : Interface web

## Commandes Utiles

```bash
# Démarrer le serveur
npm start

# Supprimer toutes les rooms
rm db.json

# Voir les logs en temps réel
npm start | grep -E "\[(Create|Join|Persistence)\]"
```
