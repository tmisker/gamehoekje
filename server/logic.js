// Boerenbridge-spellogica — autoritatief op de server.
// Puur (geen I/O); ook bruikbaar in Node-tests via module.exports.
'use strict';

const SUITS = ['♣', '♥', '♦', '♠', 'Sans'];
const SUIT_NAMES = ['Klaver', 'Harten', 'Ruiten', 'Schoppen', 'Sans'];
const SUIT_COLORS = ['#4caf50', '#e53935', '#ff9800', '#42a5f5', '#b0bec5'];

function buildRounds() {
  const cards = [];
  for (let c = 8; c >= 1; c--) cards.push(c);
  for (let c = 2; c <= 8; c++) cards.push(c);
  return cards.map((c, i) => ({ cards: c, suitIdx: i % 5 }));
}

// gelijk voorspeld → slagen + 5; te weinig → min het tekort; te veel → de slagen
function scoreRound(pred, act) {
  if (act === pred) return act + 5;
  if (act < pred) return -(pred - act);
  return act;
}

function dealerIdx(nPlayers, round) {
  return (nPlayers - 1 + round) % nPlayers;
}

function playerOrder(nPlayers, round) {
  const first = round % nPlayers;
  const order = [];
  for (let i = 0; i < nPlayers; i++) order.push((first + i) % nPlayers);
  return order;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function createGame(names) {
  if (!Array.isArray(names)) throw httpError(400, 'Spelers ontbreken');
  const players = names.map(n => String(n == null ? '' : n).trim()).filter(n => n);
  if (players.length !== names.length) throw httpError(400, 'Vul alle namen in');
  if (players.length < 3 || players.length > 6) throw httpError(400, 'Kies 3 tot 6 spelers');
  // Het klassement koppelt op naam (case-insensitief); dubbele namen in één
  // potje zouden daar dubbel tellen.
  if (new Set(players.map(n => n.toLowerCase())).size !== players.length) {
    throw httpError(400, 'Elke speler heeft een eigen naam nodig');
  }
  const now = new Date().toISOString();
  return {
    id: require('node:crypto').randomUUID(),
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    players,
    rounds: buildRounds(),
    predictions: [],
    actuals: [],
    roundScores: [],
    currentRound: 0,
    phase: 'predict', // predict | actual
    status: 'active', // active | finished | abandoned
    winnerIdxs: null,
  };
}

function checkValues(game, round, values, label) {
  if (game.status !== 'active') throw httpError(409, 'Dit spel is al afgelopen');
  if (round !== game.currentRound) throw httpError(409, 'Spel is elders bijgewerkt');
  const r = game.rounds[game.currentRound];
  if (!Array.isArray(values) || values.length !== game.players.length) {
    throw httpError(400, label + ' ontbreken');
  }
  for (const v of values) {
    if (!Number.isInteger(v) || v < 0 || v > r.cards) {
      throw httpError(400, 'Vul geldige aantallen in (0–' + r.cards + ')');
    }
  }
  return r;
}

function applyPredictions(game, round, preds) {
  if (game.phase !== 'predict') throw httpError(409, 'Spel is elders bijgewerkt');
  checkValues(game, round, preds, 'Voorspellingen');
  game.predictions[game.currentRound] = preds;
  game.phase = 'actual';
  game.updatedAt = new Date().toISOString();
}

function applyActuals(game, round, acts) {
  if (game.phase !== 'actual') throw httpError(409, 'Spel is elders bijgewerkt');
  const r = checkValues(game, round, acts, 'Slagen');
  const total = acts.reduce((a, b) => a + b, 0);
  if (total !== r.cards) {
    throw httpError(400, 'Totaal slagen (' + total + ') is niet gelijk aan kaarten (' + r.cards + ')');
  }
  const preds = game.predictions[game.currentRound];
  game.actuals[game.currentRound] = acts;
  game.roundScores[game.currentRound] = acts.map((act, i) => scoreRound(preds[i], act));
  game.currentRound++;
  game.updatedAt = new Date().toISOString();
  if (game.currentRound >= game.rounds.length) {
    game.status = 'finished';
    game.finishedAt = game.updatedAt;
    const totals = getTotals(game);
    const max = Math.max(...totals);
    game.winnerIdxs = totals.map((t, i) => [t, i]).filter(([t]) => t === max).map(([, i]) => i);
  } else {
    game.phase = 'predict';
  }
}

// Eén stap terug: actual-fase → voorspellingen wissen; predict-fase → vorige ronde heropenen.
function undo(game) {
  if (game.status === 'abandoned') throw httpError(409, 'Dit spel is afgebroken');
  if (game.status === 'finished') {
    game.status = 'active';
    game.finishedAt = null;
    game.winnerIdxs = null;
    game.phase = 'predict';
  }
  if (game.phase === 'actual') {
    game.predictions.length = game.currentRound;
    game.phase = 'predict';
  } else if (game.currentRound > 0) {
    game.currentRound--;
    game.actuals.length = game.currentRound;
    game.roundScores.length = game.currentRound;
    game.phase = 'actual';
  } else {
    throw httpError(409, 'Niets om ongedaan te maken');
  }
  game.updatedAt = new Date().toISOString();
}

function abandon(game) {
  if (game.status !== 'active') throw httpError(409, 'Dit spel is al afgelopen');
  game.status = 'abandoned';
  game.updatedAt = new Date().toISOString();
}

function getTotals(game) {
  const totals = game.players.map(() => 0);
  for (const row of game.roundScores) row.forEach((s, i) => { totals[i] += s; });
  return totals;
}

// Verrijkte view voor API/SSE: spel + afgeleide velden (niet persistent).
function enrich(game) {
  const n = game.players.length;
  const roundIdx = Math.min(game.currentRound, game.rounds.length - 1);
  const r = game.rounds[roundIdx];
  return Object.assign({}, game, {
    totals: getTotals(game),
    dealerIdx: dealerIdx(n, roundIdx),
    playerOrder: playerOrder(n, roundIdx),
    roundInfo: {
      cards: r.cards,
      suit: SUITS[r.suitIdx],
      suitName: SUIT_NAMES[r.suitIdx],
      suitColor: SUIT_COLORS[r.suitIdx],
    },
  });
}

function gameSummary(game) {
  return {
    id: game.id,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    players: game.players,
    currentRound: game.currentRound,
    totalRounds: game.rounds.length,
    phase: game.phase,
    status: game.status,
  };
}

// Leaderboard over afgeronde spellen; spelers gekoppeld op naam (case-insensitief).
function leaderboard(games) {
  const byKey = new Map();
  for (const game of games) {
    if (game.status !== 'finished') continue;
    const totals = getTotals(game);
    game.players.forEach((name, i) => {
      const key = name.trim().toLowerCase();
      let e = byKey.get(key);
      if (!e) {
        e = { name, gamesPlayed: 0, wins: 0, totalPoints: 0, bestScore: -Infinity };
        byKey.set(key, e);
      }
      e.name = name; // meest recente schrijfwijze wint
      e.gamesPlayed++;
      if (game.winnerIdxs && game.winnerIdxs.includes(i)) e.wins++;
      e.totalPoints += totals[i];
      if (totals[i] > e.bestScore) e.bestScore = totals[i];
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

module.exports = {
  SUITS, SUIT_NAMES, SUIT_COLORS,
  buildRounds, scoreRound, dealerIdx, playerOrder,
  createGame, applyPredictions, applyActuals, undo, abandon,
  getTotals, enrich, gameSummary, leaderboard, httpError,
};
