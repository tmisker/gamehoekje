// Gedeelde bouwstenen voor de spel-API's (boerenbridge, klaverjas).
// Puur; geen I/O. Alles wat hier staat is spel-onafhankelijk.
'use strict';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const nameKey = name => String(name == null ? '' : name).trim().toLowerCase();

// Namen normaliseren tot een set sleutels; lege waarden vallen weg.
function excludeSet(exclude) {
  return new Set((Array.isArray(exclude) ? exclude : []).map(nameKey).filter(Boolean));
}

// Afgeronde spellen, eventueel zonder de potjes waarin een uitgesloten speler
// meedeed. Uitsluiten geldt per potje, niet per speler: één kind aan tafel
// haalt het hele spel uit het klassement.
function finishedGames(games, exclude) {
  const skip = excludeSet(exclude);
  return games.filter(g =>
    g.status === 'finished' && !g.players.some(n => skip.has(nameKey(n))));
}

// Alle spelers die in een afgerond spel voorkomen — de keuzelijst van het
// filter (dus altijd ongefilterd, anders verdwijnt je eigen keuze).
function leaderboardPlayers(games) {
  const byKey = new Map();
  for (const game of games) {
    if (game.status !== 'finished') continue;
    for (const name of game.players) byKey.set(nameKey(name), name); // laatste schrijfwijze wint
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'nl'));
}

// Klassementsrijen per speler; `scoreOf(game)` geeft per spelerindex
// {points, won}. Spelers worden gekoppeld op naam (case-insensitief), zodat
// dezelfde persoon over potjes heen optelt.
function aggregate(games, scoreOf) {
  const byKey = new Map();
  for (const game of games) {
    const per = scoreOf(game);
    game.players.forEach((name, i) => {
      const key = nameKey(name);
      let e = byKey.get(key);
      if (!e) {
        e = { name, gamesPlayed: 0, wins: 0, totalPoints: 0, bestScore: -Infinity };
        byKey.set(key, e);
      }
      e.name = name; // meest recente schrijfwijze wint
      e.gamesPlayed++;
      if (per[i].won) e.wins++;
      e.totalPoints += per[i].points;
      if (per[i].points > e.bestScore) e.bestScore = per[i].points;
    });
  }
  const rows = [...byKey.values()].map(e => ({
    name: e.name,
    gamesPlayed: e.gamesPlayed,
    wins: e.wins,
    avgPoints: Math.round((e.totalPoints / e.gamesPlayed) * 10) / 10,
    bestScore: e.bestScore,
  }));
  rows.sort((a, b) => b.wins - a.wins || b.avgPoints - a.avgPoints);
  return rows;
}

// Payload voor /leaderboard: rijen + de keuzelijst + hoeveel potjes meetellen.
// `buildRows` krijgt de al gefilterde lijst afgeronde potjes.
function leaderboardView(games, exclude, buildRows) {
  const skip = excludeSet(exclude);
  const players = leaderboardPlayers(games);
  const counted = finishedGames(games, exclude);
  return {
    leaderboard: buildRows(counted),
    players,
    excluded: players.filter(n => skip.has(nameKey(n))),
    gamesCounted: counted.length,
    gamesTotal: finishedGames(games).length,
  };
}

module.exports = {
  httpError, nameKey, excludeSet,
  finishedGames, leaderboardPlayers, aggregate, leaderboardView,
};
