🐺

**Loup-Garou en Ligne**

Spécification Fonctionnelle

v1.0 --- Mars 2026

  ----------------------- -----------------------------------------------
  **Statut**              Brouillon

  **Auteur**              Anjara

  **Date**                Mars 2026

  **Stack cible**         Node.js / WebSocket / PWA
  ----------------------- -----------------------------------------------

**1. Contexte & Objectifs**

**1.1 Vision du produit**

L\'application Loup-Garou en Ligne est une PWA (Progressive Web App) qui
remplace les cartes physiques du jeu de société Loup-Garou de
Thiercelieux. Elle facilite la logistique d\'une partie en gérant la
distribution des rôles, les phases de jeu et les votes, tout en
permettant à chaque joueur de consulter son rôle sur son propre
téléphone.

Le jeu se joue en présentiel : les joueurs sont dans la même pièce, mais
chacun consulte son téléphone pour les actions privées. L\'application
est un outil de facilitation, non un jeu en ligne asynchrone.

**1.2 Objectifs fonctionnels**

-   Permettre la création et le partage d\'une room de jeu via un simple
    lien URL

-   Distribuer les rôles de façon aléatoire et confidentielle à chaque
    joueur

-   Orchestrer automatiquement les phases nuit/jour, en activant les
    joueurs concernés

-   Gérer les votes en temps réel sur les téléphones des joueurs

-   Donner au Maître du Jeu (MJ) un tableau de bord complet pour
    superviser et animer

**1.3 Hors périmètre v1**

-   Jeu asynchrone (joueurs dans des lieux différents)

-   Chat vocal ou vidéo intégré

-   Comptes utilisateurs persistants / historique de parties

-   Modes de jeu alternatifs (Village, variantes custom)

**2. Architecture Générale**

**2.1 Stack technique recommandée**

  --------------------- -------------------------------------------------
  **Frontend**          HTML/CSS/JS --- PWA responsive (mobile-first)

  **Backend**           Node.js + Express

  **Temps réel**        WebSocket (Socket.io)

  **État du jeu**       En mémoire côté serveur (pas de BDD requise en
                        v1)

  **Hébergement**       Tout hébergeur Node.js (Render, Railway, VPS\...)

  **Déploiement**       Une seule URL publique, rooms identifiées par
                        code
  --------------------- -------------------------------------------------

**2.2 Modèle de données principal**

**Room**

-   roomId : string (code court, ex. ABC-123)

-   createdAt : timestamp

-   status : \'lobby\' \| \'playing\' \| \'ended\'

-   players : Player\[\]

-   gameState : GameState

-   settings : GameSettings

**Player**

-   playerId : string (socket.id)

-   name : string

-   role : Role \| null

-   isAlive : boolean

-   isMJ : boolean

-   loverPartnerId : string \| null (Cupidon)

**GameState**

-   phase : \'night\' \| \'day\'

-   turn : number

-   currentNightStep : NightStep

-   victim : playerId \| null (victime désignée cette nuit)

-   witchHealUsed : boolean

-   witchKillUsed : boolean

-   votes : Map\<playerId, targetId\>

**3. Parcours Utilisateur**

**3.1 Création d\'une room**

-   L\'utilisateur arrive sur la page d\'accueil

-   Il saisit son pseudo et clique sur « Créer une partie »

-   L\'application génère un code de room unique (ex. LOUP-7X2K) et une
    URL de partage

-   Le créateur devient automatiquement Maître du Jeu

-   Il est redirigé vers le lobby avec son URL à partager

**3.2 Rejoindre une room**

-   Un joueur reçoit le lien et l\'ouvre sur son téléphone

-   Il saisit son pseudo (vérification d\'unicité dans la room)

-   Il entre dans le lobby et attend le lancement de la partie

-   Le MJ voit apparaître chaque joueur en temps réel

**3.3 Lobby --- avant le lancement**

**Vue MJ**

-   Liste des joueurs connectés (nom, statut)

-   Configuration de la composition : choix des rôles et quantité de
    chaque rôle

-   Validation automatique : le total de rôles doit égaler le nombre de
    joueurs

-   Bouton « Lancer la partie » (activé uniquement si la composition est
    valide)

-   Possibilité d\'expulser un joueur

**Vue Joueur**

-   Liste des joueurs présents dans la room

-   Indicateur d\'attente : « Le Maître du Jeu prépare la partie\... »

-   Son propre pseudo, avec possibilité de le modifier avant le
    lancement

**3.4 Distribution des rôles**

-   Au lancement, le serveur assigne aléatoirement les rôles

-   Chaque joueur voit sa carte s\'afficher sur son écran (plein écran,
    avec animation)

-   La carte reste visible aussi longtemps que le joueur appuie dessus
    (puis se masque)

-   Cas Cupidon : avant la phase Nuit 1, Cupidon désigne ses 2 amoureux
    en privé

-   Le MJ voit toutes les cartes attribuées dans son tableau de bord

**4. Déroulement d\'une Partie**

**4.1 Structure d\'un tour**

  --------------------- -------------------------------------------------
  **Phase Nuit**        Les rôles spéciaux agissent dans un ordre défini.
                        Chaque joueur concerné est activé automatiquement
                        sur son téléphone.

  **Réveil**            Le MJ annonce les victimes. L\'application
                        affiche les résultats à tous.

  **Phase Jour**        Débat libre entre joueurs (hors application).
                        Vote en temps réel via l\'app.

  **Élimination**       Le joueur le plus voté est éliminé. Sa carte est
                        révélée à tous.

  **Vérification**      L\'app vérifie les conditions de victoire. Si non
                        remplie, nouveau tour.
  --------------------- -------------------------------------------------

**4.2 Phase Nuit --- ordre des rôles**

Le MJ conserve le bouton « Étape suivante » pour contrôler le rythme.
L\'application active automatiquement l\'écran du joueur concerné à
chaque étape.

  -------- --------------- ------------------------------------ ----------------
  **\#**   **Rôle**        **Action**                           **Visibilité**

  1        Cupidon (tour 1 Désigne 2 joueurs comme amoureux.    Privé
           seulement)      Ceux-ci apprennent leur statut.      

  2        Voyante         Appuie sur un joueur pour voir sa    Privé
                           carte en secret.                     

  3        Loups-Garous    Tous les LG voient les noms des      Partagé entre LG
                           autres LG. Ils votent pour désigner  
                           une victime (majorité).              

  4        Sorcière        Voit qui a été désigné victime. Peut Privé
                           utiliser potion de Vie et/ou de      
                           Mort.                                

  5        Petite Fille    Peut tenter d\'espionner les LG      Privé
                           (bouton optionnel visible seulement  
                           pour ce rôle).                       
  -------- --------------- ------------------------------------ ----------------

**4.3 Réveil --- affichage des résultats**

-   L\'application affiche le nom du ou des joueurs éliminés cette nuit

-   Si la Sorcière a sauvé la victime, aucune mort n\'est annoncée

-   Si la Sorcière a tué quelqu\'un d\'autre, cette mort est annoncée en
    plus

-   Les cartes des joueurs éliminés sont révélées à tous

-   Le MJ peut confirmer ou modifier le résultat avant l\'affichage
    (override manuel)

**4.4 Phase Jour --- débat & vote**

-   Le débat se passe oralement (hors application)

-   Le MJ lance le vote via son tableau de bord

-   Chaque joueur vivant voit la liste des joueurs et appuie sur celui
    qu\'il veut éliminer

-   Les votes s\'affichent en temps réel (compteur visible par tous,
    identité anonyme)

-   À la clôture du vote, le joueur le plus voté est éliminé (égalité =
    personne éliminé, ou re-vote, configurable)

-   Sa carte est révélée. L\'app vérifie les conditions de victoire.

**5. Rôles & Pouvoirs**

Tous les rôles suivants sont disponibles dès la v1. Le MJ choisit
librement la composition avant chaque partie.

  ------------ -------------- ---------------------- --------------- ----------------
  **Rôle**     **Camp**       **Pouvoir**            **Moment        **Usage**
                                                     d\'action**     

  Villageois   Village        Aucun pouvoir spécial. Jour (vote)     Illimité
                              Participe aux votes.                   

  Loup-Garou   Loups-Garous   Voit les autres LG.    Nuit (toujours) Chaque nuit
                              Vote pour éliminer une                 
                              victime chaque nuit.                   

  Voyante      Village        Révèle la carte        Nuit (toujours) 1 fois/nuit
                              secrète d\'un joueur                   
                              de son choix.                          

  Sorcière     Village        Potion de Vie (sauve   Nuit (après LG) 1 fois chacune
                              la victime des LG) +                   
                              Potion de Mort                         
                              (élimine n\'importe                    
                              qui).                                  

  Chasseur     Village        À sa mort (nuit ou     À sa mort       1 fois (mort)
                              jour), tire et élimine                 
                              immédiatement un                       
                              joueur.                                

  Cupidon      Village        La 1ère nuit, désigne  Nuit 1          1 fois total
                              2 amoureux. Si l\'un   seulement       
                              meurt, l\'autre meurt                  
                              aussi.                                 

  Petite Fille Village        Peut espionner les LG  Nuit (LG)       Optionnel/nuit
                              pendant leur phase                     
                              (risque : si les LG la                 
                              signalent, elle                        
                              meurt).                                
  ------------ -------------- ---------------------- --------------- ----------------

**5.1 Règles spéciales : les Amoureux**

-   Cupidon peut se désigner lui-même comme amoureux

-   Un amoureux Loup-Garou et un amoureux Villageois forment un 3ème
    camp : ils gagnent ensemble si tous les autres joueurs sont éliminés

-   La mort d\'un amoureux entraîne automatiquement la mort de l\'autre
    (résolution immédiate côté serveur)

-   Le Chasseur peut tirer même s\'il meurt d\'amour

**5.2 Règles spéciales : la Petite Fille**

-   Elle peut activer le mode « espionnage » durant la phase LG (bouton
    visible uniquement pour elle)

-   Si un LG appuie sur « J\'ai vu la Petite Fille espionner », elle est
    ajoutée comme victime supplémentaire

-   Le MJ est informé de la tentative d\'espionnage (dashboard)

**6. Rôle du Maître du Jeu**

**6.1 Dashboard MJ**

Le MJ dispose d\'une vue dédiée, inaccessible aux autres joueurs, qui
centralise :

-   La liste complète des joueurs avec leur rôle, leur statut
    (vivant/mort), et leur partenaire amoureux éventuel

-   L\'étape en cours de la phase nuit

-   Les actions effectuées (qui a voté quoi chez les LG, si la Sorcière
    a utilisé ses potions\...)

-   Le bouton « Étape suivante » pour faire avancer la nuit

-   Un journal des événements de la partie

**6.2 Capacités du MJ**

  --------------------- -------------------------------------------------
  **Voir toutes les     À tout moment, le MJ voit le rôle de chaque
  cartes**              joueur, y compris les morts.

  **Avancer             Bouton « Étape suivante » pour passer au rôle
  manuellement**        suivant la nuit, ou déclencher le vote le jour.

  **Éliminer un         Le MJ peut marquer manuellement un joueur comme
  joueur**              mort (cas particuliers, erreurs).

  **Ressusciter un      Le MJ peut annuler une élimination (ex. erreur de
  joueur**              vote, règle litigieuse).

  **Mettre en pause**   Suspend toutes les actions des joueurs. Utile
                        pour régler un litige.

  **Terminer la         Force la fin de partie avec un camp vainqueur
  partie**              désigné manuellement.

  **Transférer le rôle  Désigne un autre joueur comme MJ. L\'ancien MJ
  MJ**                  devient joueur ordinaire.
  --------------------- -------------------------------------------------

**6.3 Transfert automatique du rôle MJ**

-   Si le MJ se déconnecte, le serveur attend 30 secondes avant de
    transférer le rôle

-   Le rôle est transféré au joueur connecté depuis le plus longtemps

-   Une notification est envoyée à tous les joueurs

-   L\'ancien MJ peut reprendre son rôle s\'il se reconnecte dans les 2
    minutes

**7. Conditions de Victoire**

  --------------------- -------------------------------------------------
  **Village gagne**     Tous les Loups-Garous sont éliminés (et les
                        Amoureux ne sont pas les 2 derniers survivants).

  **Loups-Garous        Les LG sont en nombre égal ou supérieur aux
  gagnent**             Villageois encore en vie.

  **Les Amoureux        Les 2 amoureux sont les seuls survivants (tous
  gagnent**             les autres joueurs sont morts).
  --------------------- -------------------------------------------------

La vérification est automatique après chaque élimination (nuit et jour).
En cas de victoire, l\'application affiche un écran de fin avec le camp
vainqueur et la révélation de tous les rôles.

**7.1 Priorité de résolution**

-   1\. Vérification Amoureux (prioritaire si seuls 2 joueurs restent)

-   2\. Vérification Loups-Garous (NbLG \>= NbVillageois)

-   3\. Vérification Village (NbLG == 0)

**8. Gestion des Rooms & Déconnexions**

**8.1 Cycle de vie d\'une room**

-   Une room est créée au lancement et identifiée par un code court (ex.
    LOUP-7X2K)

-   La room reste active tant qu\'au moins un joueur est connecté

-   La room est supprimée de la mémoire serveur 30 minutes après que
    tous les joueurs se sont déconnectés

-   Il n\'y a pas de persistance BDD en v1 : une room ne peut pas être
    reprise après expiration

**8.2 Déconnexion en cours de partie**

  --------------------- -------------------------------------------------
  **Partie non          Le joueur est retiré du lobby. Sa place est
  commencée**           libérée.

  **Partie en cours**   Le joueur est marqué \'absent\' mais reste dans
                        la partie. Son rôle est conservé.

  **Reconnexion**       Le joueur retrouve automatiquement son état
                        (rôle, statut) en entrant le même pseudo dans la
                        même room.

  **Déconnexion MJ**    Transfert automatique du rôle MJ après 30
                        secondes (cf. §6.3).

  **Tous déconnectés**  La room reste en mémoire 30 minutes, puis est
                        supprimée.
  --------------------- -------------------------------------------------

**8.3 Limites de la room**

-   Minimum : 6 joueurs pour lancer une partie

-   Maximum : 20 joueurs

-   Un joueur ne peut rejoindre une room dont la partie est déjà
    commencée

**9. Interfaces & Écrans**

**9.1 Liste des écrans**

  --------------------- -------------------------------------------------
  **Accueil**           Saisie du pseudo, boutons Créer / Rejoindre une
                        room

  **Rejoindre**         Saisie du code de room (si accès sans lien
                        direct)

  **Lobby (joueur)**    Liste des participants, attente du lancement

  **Lobby (MJ)**        Liste des participants, configurateur de rôles,
                        bouton Lancer

  **Ma Carte**          Affichage plein écran du rôle du joueur (maintien
                        = révélation)

  **Nuit --- Action**   Interface d\'action spécifique au rôle (vote LG,
                        révélation voyante, potions sorcière\...)

  **Nuit --- Attente**  Écran neutre pour les joueurs sans action cette
                        nuit

  **Réveil**            Annonce des victimes de la nuit

  **Jour --- Vote**     Liste des joueurs vivants, bouton de vote,
                        compteur en temps réel

  **Résultat vote**     Annonce de l\'élimination et révélation de la
                        carte

  **Fin de partie**     Camp vainqueur, révélation de tous les rôles

  **Dashboard MJ**      Vue complète : rôles, état, actions, journal,
                        contrôles
  --------------------- -------------------------------------------------

**9.2 Comportement PWA**

-   L\'app doit être utilisable sans installation (navigateur mobile)

-   Un manifest.json permet l\'ajout à l\'écran d\'accueil

-   L\'écran ne doit pas se mettre en veille pendant une partie (Wake
    Lock API)

-   Design mobile-first : toutes les interactions pensées pour le pouce

-   Mode sombre recommandé (ambiance nuit)

**10. Règles Métier & Cas Limites**

**10.1 Composition des rôles**

-   Règle recommandée : 1 LG pour 3 joueurs (ex. 6 joueurs = 2 LG)

-   Le MJ peut configurer librement la composition

-   L\'application affiche un avertissement si la composition est
    déséquilibrée (ex. trop de LG)

-   La Petite Fille ne peut pas être ajoutée s\'il n\'y a pas de LG

-   Cupidon ne peut être ajouté que s\'il y a au moins 3 joueurs (2
    amoureux + 1 autre)

**10.2 Égalité de vote**

-   En cas d\'égalité, deux options configurables par le MJ avant la
    partie :

    -   Personne n\'est éliminé ce tour

    -   Re-vote uniquement entre les joueurs à égalité

**10.3 Chasseur**

-   Le Chasseur tire même s\'il est tué par la Sorcière (potion de mort)

-   Il tire même s\'il meurt d\'amour (mort en cascade après la mort de
    son amoureux)

-   Son tir est immédiat : l\'interface lui demande de désigner une
    cible avant la fin de la résolution

-   Le tir du Chasseur peut déclencher une nouvelle vérification de
    victoire

**10.4 Sorcière**

-   Elle peut sauver et tuer dans la même nuit (si elle a les 2 potions)

-   Elle peut se sauver elle-même

-   Elle ne peut pas sauver quelqu\'un déjà mort d\'une nuit précédente

-   Elle voit le nom de la victime LG avant de décider

**10.5 Petite Fille**

-   Elle ne sait pas si elle a été repérée tant que les résultats de la
    nuit ne sont pas annoncés

-   Les LG doivent voter à l\'unanimité pour la signaler (configurable
    en v2)

-   En v1 : si au moins un LG la signale, elle est éliminée en plus de
    la victime normale

**11. Évolutions Futures (V2)**

Ces fonctionnalités sont hors périmètre v1 mais doivent être anticipées
dans l\'architecture :

-   **Idiot du Village, Ancien, Corbeau, Salvateur, Joueur de
    Flûte\...** Nouveaux rôles

-   **Joueurs dans des lieux différents, tour par tour avec délais**
    Parties asynchrones

-   **Historique, statistiques, amis** Compte utilisateur

-   **Le MJ peut être automatisé par une IA (annonces vocales, gestion
    autonome)** IA Maître du Jeu

-   **Différents univers graphiques (médiéval, science-fiction,
    horreur\...)** Thèmes visuels

-   **Mode lecture seule pour les joueurs éliminés ou les observateurs**
    Spectateurs

-   **Résumé PDF de la partie avec chronologie des événements** Export
    de partie

*--- Fin du document de spécification v1.0 ---*
