// Définition des rôles du jeu Loup-Garou

const ROLES = {
  VILLAGEOIS: {
    id: 'villageois',
    name: 'Villageois',
    team: 'village',
    description: 'Simple villageois sans pouvoir spécial. Participez aux votes du jour.',
    nightAction: false,
    nightOrder: null
  },
  LOUP_GAROU: {
    id: 'loup',
    name: 'Loup-Garou',
    team: 'loups',
    description: 'Vous voyez les autres loups et votez chaque nuit pour éliminer un villageois.',
    nightAction: true,
    nightOrder: 3,
    sharedVision: true
  },
  VOYANTE: {
    id: 'voyante',
    name: 'Voyante',
    team: 'village',
    description: 'Chaque nuit, révèle secrètement le rôle d\'un joueur de votre choix.',
    nightAction: true,
    nightOrder: 2
  },
  SORCIERE: {
    id: 'sorciere',
    name: 'Sorcière',
    team: 'village',
    description: 'Possède une potion de Vie (sauve la victime des loups) et une potion de Mort (élimine n\'importe qui). Chacune utilisable une seule fois.',
    nightAction: true,
    nightOrder: 4,
    potions: { heal: true, kill: true }
  },
  CHASSEUR: {
    id: 'chasseur',
    name: 'Chasseur',
    team: 'village',
    description: 'À votre mort (nuit ou jour), vous tirez immédiatement et éliminez un joueur de votre choix.',
    nightAction: false,
    onDeath: true
  },
  CUPIDON: {
    id: 'cupidon',
    name: 'Cupidon',
    team: 'village',
    description: 'La première nuit, désignez deux joueurs comme amoureux. Si l\'un meurt, l\'autre meurt aussi.',
    nightAction: true,
    nightOrder: 1,
    firstNightOnly: true
  },
  PETITE_FILLE: {
    id: 'petite_fille',
    name: 'Petite Fille',
    team: 'village',
    description: 'Pendant la phase des loups, vous pouvez tenter d\'espionner. Si un loup vous signale, vous êtes éliminée.',
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
    6:  { loup: 2, villageois: 2, voyante: 1, sorciere: 1 },
    7:  { loup: 2, villageois: 3, voyante: 1, sorciere: 1 },
    8:  { loup: 2, villageois: 3, voyante: 1, sorciere: 1, chasseur: 1 },
    9:  { loup: 3, villageois: 3, voyante: 1, sorciere: 1, chasseur: 1 },
    10: { loup: 3, villageois: 3, voyante: 1, sorciere: 1, chasseur: 1, cupidon: 1 },
    12: { loup: 4, villageois: 4, voyante: 1, sorciere: 1, chasseur: 1, cupidon: 1 },
    15: { loup: 5, villageois: 6, voyante: 1, sorciere: 1, chasseur: 1, cupidon: 1 },
    20: { loup: 6, villageois: 9, voyante: 1, sorciere: 1, chasseur: 1, cupidon: 1, petite_fille: 1 }
  };

  // Chercher la composition exacte ou la plus proche supérieure
  if (compositions[playerCount]) return compositions[playerCount];

  const keys = Object.keys(compositions).map(Number).sort((a, b) => a - b);
  const upper = keys.find(k => k >= playerCount);
  if (upper) return compositions[upper];

  // Fallback pour plus de 20 joueurs : adapter dynamiquement
  const total = playerCount;
  const loups = Math.floor(total / 3);
  const villageois = total - loups - 3;
  return { loup: loups, villageois: Math.max(1, villageois), voyante: 1, sorciere: 1, chasseur: 1 };
}

module.exports = { ROLES, NIGHT_ORDER, getDefaultComposition };
