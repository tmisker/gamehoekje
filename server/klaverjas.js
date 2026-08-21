// Klaverjas-spellogica — autoritatief op de server.
// Puur (geen I/O); ook bruikbaar in Node-tests via module.exports.
'use strict';

const crypto = require('node:crypto');
const shared = require('./shared.js');
const { httpError } = shared;

const TRUMPS = [
  { symbol: '♣', name: 'Klaveren', color: '#4caf50' },
  { symbol: '♥', name: 'Harten', color: '#e53935' },
  { symbol: '♦', name: 'Ruiten', color: '#ff9800' },
  { symbol: '♠', name: 'Schoppen', color: '#42a5f5' },
];

const N_PLAYERS = 4;
const N_ROUNDS = 16;       // een "boompje": elke speler deelt vier keer
const TOTAL_POINTS = 162;  // 152 kaartpunten + 10 voor de laatste slag
const PIT_BONUS = 100;
const MAX_ROEM = 1000;     // ruime bovengrens; roem is altijd een veelvoud van 10

// Maten zitten tegenover elkaar: speler 0 & 2 vormen team 0, speler 1 & 3 team 1.
const TEAMS = [[0, 2], [1, 3]];
const teamOf = playerIdx => playerIdx % 2;

function createGame(names) {
  if (!Array.isArray(names)) throw httpError(400, 'Spelers ontbreken');
  const players = names.map(n => String(n == null ? '' : n).trim()).filter(n => n);
  if (players.length !== names.length) throw httpError(400, 'Vul alle namen in');
  if (players.length !== N_PLAYERS) throw httpError(400, 'Klaverjas speel je met 4 spelers');
  // Het klassement koppelt op naam (case-insensitief); dubbele namen in één
  // potje zouden daar dubbel tellen.
  if (new Set(players.map(n => n.toLowerCase())).size !== players.length) {
    throw httpError(400, 'Elke speler heeft een eigen naam nodig');
  }
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    players,
    rounds: [],           // afgeronde rondes, zie applyRound
    // Ronde die loopt: troef en spelende partij zijn gekozen, de telling
    // volgt na afloop. null = de ronde moet nog beginnen.
    pending: null,        // {playingTeam, trump}
    status: 'active',     // active | finished | abandoned
    winnerTeamIdxs: null,
  };
}

// Puntenverdeling van één ronde. `e` = {playingTeam, points, roem, pit}, waarbij
// `points` de kaartpunten van de spelende partij zijn en `roem` per team staat.
//
// - Haalt de spelende partij niet méér dan de tegenpartij, dan is ze **nat**:
//   alle kaartpunten én alle roem gaan naar de tegenpartij.
// - `points === null` betekent: nat verklaard zonder te tellen. Dat mag, want
//   bij nat maakt de precieze verdeling voor de score niets uit.
// - **Pit** (alle acht slagen) levert 100 bonus op. Huisregel: alleen de
//   spelende partij kan pit gaan — zie applyRound.
function scoreRound(e) {
  const p = e.playingTeam, o = 1 - p;
  const allRoem = e.roem[0] + e.roem[1];
  const scores = [0, 0];
  if (e.points === null) {
    scores[o] = TOTAL_POINTS + allRoem;
    return { scores, nat: true };
  }
  const playing = e.points + e.roem[p];
  const opponent = (TOTAL_POINTS - e.points) + e.roem[o];
  const nat = playing <= opponent;
  if (nat) {
    scores[o] = TOTAL_POINTS + allRoem;
  } else {
    scores[p] = playing + (e.pit ? PIT_BONUS : 0);
    scores[o] = opponent;
  }
  return { scores, nat };
}

function checkRoem(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_ROEM || value % 10 !== 0) {
    throw httpError(400, 'Roem moet een veelvoud van 10 zijn (0–' + MAX_ROEM + ')');
  }
}

function checkOpen(game, round) {
  if (game.status !== 'active') throw httpError(409, 'Dit potje is al afgelopen');
  if (round !== game.rounds.length) throw httpError(409, 'Potje is elders bijgewerkt');
}

// Fase 1 — aan het begin van de ronde: wie speelt er, en op welke troef?
// Zo weet het scorebord tijdens het spelen al wat troef is.
function startRound(game, round, input) {
  checkOpen(game, round);
  if (game.pending) throw httpError(409, 'Potje is elders bijgewerkt');
  if (!input || typeof input !== 'object') throw httpError(400, 'Ronde ontbreekt');

  const playingTeam = input.playingTeam;
  if (playingTeam !== 0 && playingTeam !== 1) throw httpError(400, 'Kies welk team speelt');

  const trump = input.trump;
  if (!Number.isInteger(trump) || trump < 0 || trump >= TRUMPS.length) {
    throw httpError(400, 'Kies een troefkleur');
  }

  game.pending = { playingTeam, trump };
  game.updatedAt = new Date().toISOString();
}

// Fase 2 — na afloop: de telling. Troef en spelende partij liggen al vast.
function applyRound(game, round, input) {
  checkOpen(game, round);
  if (!game.pending) throw httpError(409, 'Kies eerst wie speelt en wat troef is');
  if (!input || typeof input !== 'object') throw httpError(400, 'Ronde ontbreekt');
  const { playingTeam, trump } = game.pending;

  const roem = input.roem;
  if (!Array.isArray(roem) || roem.length !== 2) throw httpError(400, 'Roem ontbreekt');
  roem.forEach(checkRoem);

  // Nat verklaren mag zonder te tellen: de puntenverdeling doet er dan niet toe.
  const declaredNat = input.nat === true;
  let points = null;
  if (!declaredNat) {
    points = input.points;
    if (!Number.isInteger(points) || points < 0 || points > TOTAL_POINTS) {
      throw httpError(400, 'Vul de punten in (0–' + TOTAL_POINTS + ')');
    }
  }

  const pit = input.pit === true;
  if (pit) {
    // Huisregel: pit is voorbehouden aan de spelende partij. Die pakte dan alle
    // acht slagen, dus álle kaartpunten — en de tegenpartij kan geen roem
    // hebben gemaakt, want roem telt pas als je de slag binnenhaalt.
    if (declaredNat) throw httpError(400, 'Nat en pit gaan niet samen');
    if (points !== TOTAL_POINTS) {
      throw httpError(400, 'Bij pit zijn alle ' + TOTAL_POINTS + ' punten voor de spelende partij');
    }
    if (roem[1 - playingTeam] !== 0) {
      throw httpError(400, 'Bij pit kan de tegenpartij geen roem maken');
    }
  }

  const entry = { playingTeam, trump, points, roem: [roem[0], roem[1]], pit };
  Object.assign(entry, scoreRound(entry));
  game.rounds.push(entry);
  game.pending = null;
  game.updatedAt = new Date().toISOString();

  if (game.rounds.length >= N_ROUNDS) {
    game.status = 'finished';
    game.finishedAt = game.updatedAt;
    const totals = getTotals(game);
    const max = Math.max(...totals);
    game.winnerTeamIdxs = totals.map((t, i) => [t, i]).filter(([t]) => t === max).map(([, i]) => i);
  }
}

// Eén stap terug: eerst de telling van de laatste ronde, dan de troefkeuze.
// Een net afgerond potje gaat daarbij weer open.
function undo(game) {
  if (game.status === 'abandoned') throw httpError(409, 'Dit potje is afgebroken');
  if (game.status === 'finished') {
    game.status = 'active';
    game.finishedAt = null;
    game.winnerTeamIdxs = null;
  }
  if (game.pending) {
    game.pending = null;
  } else if (game.rounds.length) {
    // Ronde heropenen met dezelfde troef en spelende partij.
    const last = game.rounds.pop();
    game.pending = { playingTeam: last.playingTeam, trump: last.trump };
  } else {
    throw httpError(409, 'Niets om ongedaan te maken');
  }
  game.updatedAt = new Date().toISOString();
}

function abandon(game) {
  if (game.status !== 'active') throw httpError(409, 'Dit potje is al afgelopen');
  game.status = 'abandoned';
  game.updatedAt = new Date().toISOString();
}

function getTotals(game) {
  const totals = [0, 0];
  for (const r of game.rounds) {
    totals[0] += r.scores[0];
    totals[1] += r.scores[1];
  }
  return totals;
}

function teamNames(game) {
  return TEAMS.map(t => t.map(i => game.players[i]).join(' & '));
}

// Verrijkte view voor het API: potje + afgeleide velden (niet persistent).
function enrich(game) {
  const round = game.rounds.length;
  const dealerIdx = round % N_PLAYERS;
  return Object.assign({}, game, {
    teams: TEAMS,
    teamNames: teamNames(game),
    totals: getTotals(game),
    currentRound: round,
    totalRounds: N_ROUNDS,
    // choose = troef kiezen (begin van de ronde), score = tellen (na afloop)
    phase: game.pending ? 'score' : 'choose',
    trumpInfo: game.pending ? TRUMPS[game.pending.trump] : null,
    dealerIdx,
    // Links van de deler: die mag als eerste kiezen of hij speelt.
    voorhandIdx: (dealerIdx + 1) % N_PLAYERS,
    trumps: TRUMPS,
    totalPoints: TOTAL_POINTS,
    pitBonus: PIT_BONUS,
  });
}

function gameSummary(game) {
  return {
    id: game.id,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    players: game.players,
    teamNames: teamNames(game),
    totals: getTotals(game),
    currentRound: game.rounds.length,
    totalRounds: N_ROUNDS,
    phase: game.pending ? 'score' : 'choose',
    status: game.status,
  };
}

// Elke speler krijgt de punten van zijn team; winst geldt voor beide maten.
function buildRows(finished) {
  return shared.aggregate(finished, game => {
    const totals = getTotals(game);
    return game.players.map((_, i) => ({
      points: totals[teamOf(i)],
      won: !!game.winnerTeamIdxs && game.winnerTeamIdxs.includes(teamOf(i)),
    }));
  });
}

function leaderboard(games, exclude) {
  return buildRows(shared.finishedGames(games, exclude));
}

function leaderboardView(games, exclude) {
  return shared.leaderboardView(games, exclude, buildRows);
}

module.exports = {
  TRUMPS, TEAMS, N_PLAYERS, N_ROUNDS, TOTAL_POINTS, PIT_BONUS,
  teamOf, createGame, scoreRound, startRound, applyRound, undo, abandon,
  getTotals, enrich, gameSummary, leaderboard, leaderboardView,
  httpError,
};
