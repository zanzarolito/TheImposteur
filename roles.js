// Définition des rôles du jeu Loup-Garou

const ROLES = {
  VILLAGEOIS: {
    id: 'villageois',
    name: 'Villageois',
    team: 'village',
    description: 'Simple villageois sans pouvoir spécial',
    nightAction: false,
    nightOrder: null
  },
  LOUP_GAROU: {
    id: 'loup',
    name: 'Loup-Garou',
    team: 'loups',
    description: 'Élimine un villageois chaque nuit',
    nightAction: true,
    nightOrder: 3,
    sharedVision: true
  },
  VOYANTE: {
    id: 'voyante',
    name: 'Voyante',
    team: 'village',
    description: 'Peut voir le rôle d\'un joueur chaque nuit',
    nightAction: true,
    nightOrder: 2
  },
  SORCIERE: {
    id: 'sorciere',
    name: 'Sorcière',
    team: 'village',
    description: 'Possède une potion de vie et une potion de mort',
    nightAction: true,
    nightOrder: 4,
    potions: { heal: true, kill: true }
  },
  CHASSEUR: {
    id: 'chasseur',
    name: 'Chasseur',
    team: 'village',
    description: 'Élimine un joueur en mourant',
    nightAction: false,
    onDeath: true
  },
  CUPIDON: {
    id: 'cupidon',
    name: 'Cupidon',
    team: 'village',
    description: 'Désigne deux amoureux la première nuit',
    nightAction: true,
    nightOrder: 1,
    firstNightOnly: true
  },
  PETITE_FILLE: {
    id: 'petite_fille',
    name: 'Petite Fille',
    team: 'village',
    description: 'Peut espionner les loups-garous',
    nightAction: true,
    nightOrder: 5,
    optional: true
  }
};

const NIGHT_ORDER = [
  { step: 'cupidon', roles: ['cupidon'], firstNightOnly: true },
  { step: 'voyante', roles: ['voyante'] },
  { step: 'loups', roles: ['loup'] },
  { step: 'sorciere', roles: ['sorciere'] },
  { step: 'petite_fille', roles: ['petite_fille'], optional: true }
];

function getDefaultComposition(playerCount) {
  const compositions = {
    6: { loup: 2, villageois: 2, voyante: 1, sorciere: 1 },
    7: { loup: 2, villageois: 2, voyante: 1, sorciere: 1, chasseur: 1 },
    8: { loup: 2, villageois: 3, voyante: 1, sorciere: 1, chasseur: 1 },
    9: { loup: 3, villageois: 3, voyante: 1, sorciere: 1, chasseur: 1 },
    10: { loup: 3, villageois: 3, voyante: 1, sorciere: 1, chasseur: 1, cupidon: 1 },
    12: { loup: 4, villageois: 4, voyante: 1, sorciere: 1, chasseur: 1, cupidon: 1 },
    15: { loup: 5, villageois: 5, voyante: 1, sorciere: 1, chasseur: 1, cupidon: 1, petite_fille: 1 },
    20: { loup: 6, villageois: 8, voyante: 1, sorciere: 1, chasseur: 1, cupidon: 1, petite_fille: 1, villageois: 1 }
  };
  
  return compositions[playerCount] || compositions[Math.min(...Object.keys(compositions).map(Number).filter(n => n >= playerCount))];
}

module.exports = { ROLES, NIGHT_ORDER, getDefaultComposition };
