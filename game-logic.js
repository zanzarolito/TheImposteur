// Logique métier du jeu Loup-Garou

const { ROLES, NIGHT_ORDER } = require('./roles');

function distributeRoles(players, composition) {
  const rolePool = [];
  
  for (const [roleId, count] of Object.entries(composition)) {
    for (let i = 0; i < count; i++) {
      rolePool.push(roleId);
    }
  }
  
  // Mélanger les rôles
  for (let i = rolePool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rolePool[i], rolePool[j]] = [rolePool[j], rolePool[i]];
  }
  
  return players.map((player, index) => ({
    ...player,
    role: rolePool[index],
    isAlive: true,
    loverPartnerId: null
  }));
}

function checkVictory(players) {
  const alivePlayers = players.filter(p => p.isAlive);
  const aliveLoups = alivePlayers.filter(p => p.role === 'loup');
  const aliveVillage = alivePlayers.filter(p => p.role !== 'loup');
  
  // Vérifier les amoureux
  const lovers = alivePlayers.filter(p => p.loverPartnerId);
  if (lovers.length === 2 && alivePlayers.length === 2) {
    const lover1 = lovers[0];
    const lover2 = lovers[1];
    if ((lover1.role === 'loup' && lover2.role !== 'loup') || 
        (lover1.role !== 'loup' && lover2.role === 'loup')) {
      return { winner: 'lovers', players: lovers };
    }
  }
  
  // Loups gagnent
  if (aliveLoups.length >= aliveVillage.length && aliveLoups.length > 0) {
    return { winner: 'loups', players: aliveLoups };
  }
  
  // Village gagne
  if (aliveLoups.length === 0) {
    return { winner: 'village', players: aliveVillage };
  }
  
  return null;
}

function getNextNightStep(currentStep, turn, players) {
  const currentIndex = NIGHT_ORDER.findIndex(s => s.step === currentStep);
  
  for (let i = currentIndex + 1; i < NIGHT_ORDER.length; i++) {
    const step = NIGHT_ORDER[i];
    
    if (step.firstNightOnly && turn > 1) continue;
    
    const hasActivePlayer = step.roles.some(roleId => 
      players.some(p => p.role === roleId && p.isAlive)
    );
    
    if (hasActivePlayer) {
      return step.step;
    }
  }
  
  return 'end';
}

function resolveNightKills(victims, players) {
  const deaths = [];
  
  victims.forEach(victimId => {
    const victim = players.find(p => p.playerId === victimId);
    if (victim && victim.isAlive) {
      victim.isAlive = false;
      deaths.push(victim);
      
      // Mort en cascade des amoureux
      if (victim.loverPartnerId) {
        const lover = players.find(p => p.playerId === victim.loverPartnerId);
        if (lover && lover.isAlive) {
          lover.isAlive = false;
          deaths.push(lover);
        }
      }
    }
  });
  
  return deaths;
}

function resolveDayVote(votes, players) {
  const voteCounts = {};
  
  votes.forEach(vote => {
    voteCounts[vote.targetId] = (voteCounts[vote.targetId] || 0) + 1;
  });
  
  let maxVotes = 0;
  let eliminated = [];
  
  for (const [targetId, count] of Object.entries(voteCounts)) {
    if (count > maxVotes) {
      maxVotes = count;
      eliminated = [targetId];
    } else if (count === maxVotes) {
      eliminated.push(targetId);
    }
  }
  
  // En cas d'égalité, personne n'est éliminé
  if (eliminated.length > 1) {
    return null;
  }
  
  return eliminated[0];
}

module.exports = {
  distributeRoles,
  checkVictory,
  getNextNightStep,
  resolveNightKills,
  resolveDayVote
};
