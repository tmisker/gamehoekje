// Boerenbridge-spellogica — autoritatief op de server.
// Puur (geen I/O); ook bruikbaar in Node-tests via module.exports.
'use strict';

const shared = require('./shared.js');
const { httpError } = shared;

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
    draft: null, // concept-invoer voor live meekijken: {phase, values} of null
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
  game.draft = null;
  game.updatedAt = new Date().toISOString();
}

// Concept-invoer: wat de invoerder al heeft aangetikt (null = nog niet gekozen).
// Niet-autoritatief — telt nergens in mee, maar gaat wel mee in de SSE-snapshot
// zodat het scorebord live kan tonen wie hoeveel vraagt/haalt.
function applyDraft(game, round, phase, values) {
  if (game.status !== 'active') throw httpError(409, 'Dit spel is al afgelopen');
  if (round !== game.currentRound || phase !== game.phase) {
    throw httpError(409, 'Spel is elders bijgewerkt');
  }
  const r = game.rounds[game.currentRound];
  if (!Array.isArray(values) || values.length !== game.players.length) {
    throw httpError(400, 'Invoer ontbreekt');
  }
  for (const v of values) {
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > r.cards)) {
      throw httpError(400, 'Vul geldige aantallen in (0–' + r.cards + ')');
    }
  }
  game.draft = values.some(v => v !== null) ? { phase, values } : null;
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
  game.draft = null;
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
  game.draft = null;
  game.updatedAt = new Date().toISOString();
}

function abandon(game) {
  if (game.status !== 'active') throw httpError(409, 'Dit spel is al afgelopen');
  game.status = 'abandoned';
  game.draft = null;
  game.updatedAt = new Date().toISOString();
}

// Lopende tussenstand: cumulative[r][i] = het totaal van speler i t/m ronde r.
// Eén bron voor elke stand in dit bestand — getTotals pakt de laatste rij.
function cumulativeTotals(game) {
  const running = game.players.map(() => 0);
  return game.roundScores.map(row => {
    row.forEach((s, i) => { running[i] += s; });
    return running.slice();
  });
}

function getTotals(game) {
  const cum = cumulativeTotals(game);
  return cum.length ? cum[cum.length - 1].slice() : game.players.map(() => 0);
}

// Plek in de stand (1 = hoogste). Gelijke totalen delen een plek en de plek(ken)
// daarna slaan over: 1, 2, 2, 4.
function positions(totals) {
  const sorted = totals.slice().sort((a, b) => b - a);
  return totals.map(t => sorted.indexOf(t) + 1);
}

// Live tussenstand tijdens het spelen: de stand zoals die wordt als de
// concept-invoer van de slagen zo blijft staan. Niet-autoritatief (de draft
// telt nergens in mee), maar wél hier berekend — de scoreformule is een
// spelregel en hoort niet in de clients.
function projection(game, totals) {
  if (game.status !== 'active' || game.phase !== 'actual') return null;
  const preds = game.predictions[game.currentRound];
  const draft = game.draft && game.draft.phase === 'actual' ? game.draft.values : null;
  if (!preds || !draft) return null;
  const deltas = preds.map((p, i) => (draft[i] == null ? null : scoreRound(p, draft[i])));
  const projected = totals.map((t, i) => t + (deltas[i] || 0));
  return { deltas, totals: projected, positions: positions(projected) };
}

// Verrijkte view voor API/SSE: spel + afgeleide velden (niet persistent).
function enrich(game) {
  const n = game.players.length;
  const roundIdx = Math.min(game.currentRound, game.rounds.length - 1);
  const r = game.rounds[roundIdx];
  const cumulative = cumulativeTotals(game);
  const totals = cumulative.length ? cumulative[cumulative.length - 1].slice() : game.players.map(() => 0);
  return Object.assign({}, game, {
    totals,
    cumulative,
    positions: positions(totals),
    projection: projection(game, totals),
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
function leaderboard(games, exclude) {
  return buildRows(shared.finishedGames(games, exclude));
}

function buildRows(finished) {
  return shared.aggregate(finished, game => {
    const totals = getTotals(game);
    return game.players.map((_, i) => ({
      points: totals[i],
      won: !!game.winnerIdxs && game.winnerIdxs.includes(i),
    }));
  });
}

// Payload voor /leaderboard: rijen + de keuzelijst + hoeveel potjes meetellen.
function leaderboardView(games, exclude) {
  return shared.leaderboardView(games, exclude, buildRows);
}

module.exports = {
  SUITS, SUIT_NAMES, SUIT_COLORS,
  buildRounds, scoreRound, dealerIdx, playerOrder,
  createGame, applyPredictions, applyDraft, applyActuals, undo, abandon,
  getTotals, cumulativeTotals, positions, projection, enrich, gameSummary,
  leaderboard, leaderboardView,
  finishedGames: shared.finishedGames,
  leaderboardPlayers: shared.leaderboardPlayers,
  httpError,
};
