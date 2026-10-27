// Yahtzee-scorelogica — autoritatief op de server.
// Puur (geen I/O); ook bruikbaar in Node-tests via module.exports.
//
// Een potje is een lijst zetten (`game.moves`, in invoervolgorde): elke zet
// vult één vakje van één rijtje van één speler. Het scoreblok wordt daar in
// `buildSheets` uit afgeleid, dus undo = de laatste zet eraf (LIFO). Je mag
// met meerdere rijtjes tegelijk spelen: elke beurt kies je zelf in welk
// rijtje de worp komt, en elk rijtje heeft zijn eigen bonussen.
'use strict';

const crypto = require('node:crypto');
const shared = require('./shared.js');
const { httpError } = shared;

const MIN_PLAYERS = 1;
const MAX_PLAYERS = 8;
const MAX_COLUMNS = 6;
const MAX_NAME = 30;
const N_DICE = 5;
const UPPER_BONUS_AT = 63;   // drie van elk = precies 63
const UPPER_BONUS = 35;
const YAHTZEE_BONUS = 100;
const HIGHSCORE_LIMIT = 10;
const DICE_SOURCES = ['hand', 'camera'];

const OPTIONS = {
  minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, maxColumns: MAX_COLUMNS, maxName: MAX_NAME,
};

// ---------- vakjes ----------

const total = dice => dice.reduce((a, b) => a + b, 0);
function countsOf(dice) {
  const c = [0, 0, 0, 0, 0, 0, 0]; // index = ogen
  for (const d of dice) c[d]++;
  return c;
}
const isYahtzee = dice => countsOf(dice).includes(N_DICE);
function hasRun(dice, length) {
  const c = countsOf(dice);
  let run = 0;
  for (let v = 1; v <= 6; v++) {
    run = c[v] ? run + 1 : 0;
    if (run >= length) return true;
  }
  return false;
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const SUMS = range(5, 30); // alle ogen van vijf stenen

function upper(id, name, face) {
  return {
    id, name, face, section: 'upper',
    hint: 'Tel alleen de ' + name.toLowerCase(),
    options: range(0, N_DICE).map(n => n * face),
    score: dice => countsOf(dice)[face] * face,
  };
}

// `score(dice, joker)` — joker: de stenen vormen een Yahtzee terwijl het
// Yahtzee-vakje van dit rijtje al vol is. Dan tellen full house en de straten
// volledig mee (de officiële jokerregel).
const CATEGORIES = [
  upper('ones', 'Enen', 1),
  upper('twos', 'Tweeën', 2),
  upper('threes', 'Drieën', 3),
  upper('fours', 'Vieren', 4),
  upper('fives', 'Vijven', 5),
  upper('sixes', 'Zessen', 6),
  {
    id: 'three', name: 'Drie gelijk', section: 'lower', hint: 'Alle ogen tellen',
    options: [0].concat(SUMS),
    score: dice => (countsOf(dice).some(n => n >= 3) ? total(dice) : 0),
  },
  {
    id: 'four', name: 'Vier gelijk', section: 'lower', hint: 'Alle ogen tellen',
    options: [0].concat(SUMS),
    score: dice => (countsOf(dice).some(n => n >= 4) ? total(dice) : 0),
  },
  {
    id: 'fullHouse', name: 'Full house', section: 'lower', hint: 'Drie gelijk + twee gelijk',
    options: [0, 25],
    score: (dice, joker) => {
      const c = countsOf(dice).filter(Boolean).sort();
      return joker || (c.length === 2 && c[0] === 2) ? 25 : 0;
    },
  },
  {
    id: 'smallStraight', name: 'Kleine straat', section: 'lower', hint: 'Vier op een rij',
    options: [0, 30],
    score: (dice, joker) => (joker || hasRun(dice, 4) ? 30 : 0),
  },
  {
    id: 'largeStraight', name: 'Grote straat', section: 'lower', hint: 'Vijf op een rij',
    options: [0, 40],
    score: (dice, joker) => (joker || hasRun(dice, 5) ? 40 : 0),
  },
  {
    id: 'yahtzee', name: 'Yahtzee', section: 'lower', hint: 'Vijf gelijk',
    options: [0, 50],
    score: dice => (isYahtzee(dice) ? 50 : 0),
  },
  {
    id: 'chance', name: 'Kans', section: 'lower', hint: 'Alle ogen tellen',
    options: SUMS,
    score: dice => total(dice),
  },
];
const CAT_BY_ID = new Map(CATEGORIES.map(c => [c.id, c]));
const UPPER = CATEGORIES.filter(c => c.section === 'upper');
const LOWER = CATEGORIES.filter(c => c.section === 'lower');

// Wat de pagina's van een vakje mogen weten (zonder de scorefunctie).
const CATEGORY_VIEW = CATEGORIES.map(c => ({
  id: c.id, name: c.name, section: c.section, hint: c.hint, face: c.face || null, options: c.options,
}));

// ---------- aanmaken ----------

function createGame(input) {
  if (!input || typeof input !== 'object') throw httpError(400, 'Potje ontbreekt');
  const names = input.players;
  if (!Array.isArray(names)) throw httpError(400, 'Spelers ontbreken');
  const players = names.map(n => String(n == null ? '' : n).trim()).filter(n => n);
  if (players.length !== names.length) throw httpError(400, 'Vul alle namen in');
  if (players.length < MIN_PLAYERS) throw httpError(400, 'Vul minstens één naam in');
  if (players.length > MAX_PLAYERS) throw httpError(400, 'Maximaal ' + MAX_PLAYERS + ' spelers');
  if (players.some(n => n.length > MAX_NAME)) throw httpError(400, 'Naam te lang (max ' + MAX_NAME + ' tekens)');
  // Het klassement koppelt op naam (case-insensitief); dubbele namen zouden
  // daar dubbel tellen.
  if (new Set(players.map(shared.nameKey)).size !== players.length) {
    throw httpError(400, 'Elke speler heeft een eigen naam nodig');
  }
  const columns = input.columns === undefined ? 1 : input.columns;
  if (!Number.isInteger(columns) || columns < 1 || columns > MAX_COLUMNS) {
    throw httpError(400, 'Aantal rijtjes: 1–' + MAX_COLUMNS);
  }
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    // Telt bij elke wijziging op (ook stenen en undo). Een pagina die op
    // meerdere manieren hoort wat er gebeurt (eigen antwoord, SSE, refetch)
    // neemt zo nooit een oudere stand over een nieuwere heen.
    version: 0,
    players,
    columns,
    moves: [],           // {player, column, category, value, bonus, dice, at}; undo = LIFO
    // De worp die nu op tafel ligt (camera of ingetikt); niet-autoritatief,
    // telt nergens in mee, maar zo zien alle schermen dezelfde stenen.
    dice: null,          // {values, source, at}
    status: 'active',    // active | finished | abandoned
    winners: null,       // spelerindexen met de hoogste totaalscore
  };
}

// ---------- het scoreblok ----------

// sheets[speler][rijtje] = {cells: {vakje: waarde|null}, yahtzeeBonuses}
function buildSheets(game) {
  const sheets = game.players.map(() => Array.from({ length: game.columns }, () => {
    const cells = {};
    for (const c of CATEGORIES) cells[c.id] = null;
    return { cells, yahtzeeBonuses: 0 };
  }));
  for (const m of game.moves) {
    const col = sheets[m.player][m.column];
    col.cells[m.category] = m.value;
    if (m.bonus) col.yahtzeeBonuses++;
  }
  return sheets;
}

const filledIn = col => CATEGORIES.filter(c => col.cells[c.id] !== null).length;
const cellsPerPlayer = game => game.columns * CATEGORIES.length;

// Extra Yahtzee: +100, maar alleen als het Yahtzee-vakje van dít rijtje 50 heeft.
const bonusAllowed = (cat, col) => cat.id !== 'yahtzee' && col.cells.yahtzee === 50;

function scoreDice(dice, cat, col) {
  const yahtzee = isYahtzee(dice);
  const joker = yahtzee && col.cells.yahtzee !== null;
  return { value: cat.score(dice, joker), bonus: yahtzee && bonusAllowed(cat, col) };
}

// Afgeleide cijfers van één rijtje.
function columnView(col) {
  const c = col.cells;
  const upperFilled = UPPER.filter(x => c[x.id] !== null);
  const upperSum = upperFilled.reduce((a, x) => a + c[x.id], 0);
  // Wat er hooguit nog bij kan: vijf van elk leeg vakje.
  const upperMax = upperSum + UPPER.filter(x => c[x.id] === null).reduce((a, x) => a + N_DICE * x.face, 0);
  // null = nog niet beslist
  const bonus = upperSum >= UPPER_BONUS_AT ? UPPER_BONUS : (upperMax < UPPER_BONUS_AT ? 0 : null);
  const lowerSum = LOWER.reduce((a, x) => a + (c[x.id] || 0), 0);
  const yahtzeeBonus = col.yahtzeeBonuses * YAHTZEE_BONUS;
  return {
    cells: c,
    upper: upperSum,
    upperNeeded: Math.max(0, UPPER_BONUS_AT - upperSum),
    // Op schema voor de bonus: drie van elk ingevuld vakje. +4 = voor, −3 = achter.
    par: upperSum - upperFilled.reduce((a, x) => a + 3 * x.face, 0),
    bonus,
    lower: lowerSum,
    // Mag een extra Yahtzee hier +100 opleveren? (zie bonusAllowed)
    yahtzeeBonusOpen: c.yahtzee === 50,
    yahtzeeBonuses: col.yahtzeeBonuses,
    yahtzeeBonus,
    total: upperSum + (bonus || 0) + lowerSum + yahtzeeBonus,
    filled: filledIn(col),
  };
}

function totalsOf(sheets) {
  return sheets.map(cols => cols.reduce((a, col) => a + columnView(col).total, 0));
}

// Plek in de stand; gelijke totalen delen een plek, de volgende slaat over.
function positionsOf(totals) {
  return totals.map(t => 1 + totals.filter(o => o > t).length);
}

// Wie er aan de beurt is: wie de minste vakjes heeft ingevuld, bij gelijk
// aantal de eerste in de zitvolgorde. Zo loopt het vanzelf rond, en klopt
// het ook nog als iemand eens buiten de beurt is ingevuld.
function turnOf(game, sheets) {
  if (game.status !== 'active') return null;
  const filled = sheets.map(cols => cols.reduce((a, col) => a + filledIn(col), 0));
  const min = Math.min(...filled);
  return { player: filled.indexOf(min), number: min + 1, of: cellsPerPlayer(game) };
}

// ---------- invoer ----------

function checkActive(game) {
  if (game.status !== 'active') throw httpError(409, 'Dit potje is al afgelopen');
}

// `revision` (optioneel) is het aantal zetten dat de client zag: klopt dat
// niet, dan is het potje elders bijgewerkt.
function checkRevision(game, revision) {
  if (revision !== undefined && revision !== game.moves.length) {
    throw httpError(409, 'Potje is elders bijgewerkt');
  }
}

function checkDice(dice) {
  if (!Array.isArray(dice) || dice.length !== N_DICE
    || !dice.every(d => Number.isInteger(d) && d >= 1 && d <= 6)) {
    throw httpError(400, 'Vijf stenen van 1 tot en met 6');
  }
  return dice.slice();
}

function checkIndex(value, length, message) {
  if (!Number.isInteger(value) || value < 0 || value >= length) throw httpError(400, message);
  return value;
}

// Eén vakje invullen. Met `dice` rekent de server de score uit (en de
// Yahtzee-bonus en jokerregel); anders telt `value`, die bij het vakje moet
// passen, met `bonus: true` voor een extra Yahtzee.
function applyScore(game, input) {
  checkActive(game);
  if (!input || typeof input !== 'object') throw httpError(400, 'Score ontbreekt');
  checkRevision(game, input.revision);
  const player = checkIndex(input.player, game.players.length, 'Onbekende speler');
  const column = checkIndex(input.column, game.columns, 'Onbekend rijtje');
  const cat = CAT_BY_ID.get(input.category);
  if (!cat) throw httpError(400, 'Onbekend vakje');
  const col = buildSheets(game)[player][column];
  if (col.cells[cat.id] !== null) throw httpError(409, 'Dit vakje is al ingevuld');

  let value, bonus, dice = null;
  if (input.dice != null) {
    dice = checkDice(input.dice);
    ({ value, bonus } = scoreDice(dice, cat, col));
  } else {
    value = input.value;
    if (!cat.options.includes(value)) throw httpError(400, value + ' kan niet bij ' + cat.name);
    bonus = input.bonus === true;
    if (bonus && !bonusAllowed(cat, col)) {
      throw httpError(400, 'Yahtzee-bonus kan pas als het Yahtzee-vakje van dit rijtje 50 heeft');
    }
  }

  const now = new Date().toISOString();
  game.moves.push({ player, column, category: cat.id, value, bonus, dice, at: now });
  game.dice = null;
  game.updatedAt = now;
  game.version++;
  if (game.moves.length === game.players.length * cellsPerPlayer(game)) {
    game.status = 'finished';
    game.finishedAt = now;
    const totals = totalsOf(buildSheets(game));
    const max = Math.max(...totals);
    game.winners = totals.map((t, i) => [t, i]).filter(([t]) => t === max).map(([, i]) => i);
  }
}

// De worp die op tafel ligt; `dice: null` wist hem.
function applyDice(game, input) {
  checkActive(game);
  if (!input || typeof input !== 'object') throw httpError(400, 'Stenen ontbreken');
  checkRevision(game, input.revision);
  if (input.dice == null) {
    game.dice = null;
  } else {
    const source = input.source === undefined ? 'hand' : input.source;
    if (!DICE_SOURCES.includes(source)) throw httpError(400, 'Onbekende bron');
    game.dice = { values: checkDice(input.dice), source, at: new Date().toISOString() };
  }
  game.updatedAt = new Date().toISOString();
  game.version++;
}

// Laatste zet terugnemen. Een net afgerond potje gaat weer open, en kwam de
// zet uit een worp, dan liggen die stenen weer op tafel — dan tik je zo het
// goede vakje aan.
function undo(game, revision) {
  if (game.status === 'abandoned') throw httpError(409, 'Dit potje is afgebroken');
  checkRevision(game, revision);
  const move = game.moves.pop();
  if (!move) throw httpError(409, 'Niets om ongedaan te maken');
  if (game.status === 'finished') {
    game.status = 'active';
    game.finishedAt = null;
    game.winners = null;
  }
  const now = new Date().toISOString();
  game.dice = move.dice ? { values: move.dice, source: 'hand', at: now } : null;
  game.updatedAt = now;
  game.version++;
}

function abandon(game) {
  checkActive(game);
  game.status = 'abandoned';
  game.dice = null;
  game.updatedAt = new Date().toISOString();
  game.version++;
}

// ---------- views ----------

// Wat de stenen op tafel in elk leeg vakje zouden opleveren:
// preview[speler][rijtje] = {values: {vakje: score}, bonus}
function previewOf(game, sheets) {
  if (!game.dice || game.status !== 'active') return null;
  const dice = game.dice.values;
  return sheets.map(cols => cols.map(col => {
    const values = {};
    let bonus = false;
    for (const cat of CATEGORIES) {
      if (col.cells[cat.id] !== null) continue;
      const s = scoreDice(dice, cat, col);
      values[cat.id] = s.value;
      bonus = bonus || s.bonus;
    }
    return { values, bonus };
  }));
}

// Alle rijtjes uit afgeronde, meetellende potjes.
function allColumns(finished) {
  const out = [];
  for (const game of finished) {
    buildSheets(game).forEach((cols, p) => cols.forEach((col, c) => {
      out.push({ name: game.players[p], score: columnView(col).total, at: game.finishedAt,
        gameId: game.id, player: p, column: c });
    }));
  }
  return out;
}

const byScore = (a, b) => b.score - a.score || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

function highscores(finished) {
  return allColumns(finished).sort(byScore).slice(0, HIGHSCORE_LIMIT)
    .map(({ name, score, at, gameId }) => ({ name, score, at, gameId }));
}

// Rijtjes van dit (afgeronde) potje die de highscorelijst halen. Gelijke
// scores delen een plek.
function recordsOf(game, games) {
  if (game.status !== 'finished') return null;
  const all = allColumns(shared.finishedGames(games));
  const mine = all.filter(r => r.gameId === game.id);
  return mine.map(r => ({ player: r.player, column: r.column, score: r.score,
    rank: 1 + all.filter(o => o.score > r.score).length }))
    .filter(r => r.rank <= HIGHSCORE_LIMIT)
    .sort((a, b) => a.rank - b.rank);
}

// Verrijkte view voor het API: potje + afgeleide velden (niet persistent).
// De zetten zelf blijven op de server; de pagina's hebben genoeg aan het
// scoreblok en de laatste zet, en de snapshot gaat bij elke mutatie over de lijn.
function enrich(game, games) {
  const sheets = buildSheets(game);
  const totals = totalsOf(sheets);
  const last = game.moves[game.moves.length - 1] || null;
  const view = Object.assign({}, game, {
    sheets: sheets.map(cols => cols.map(columnView)),
    totals,
    positions: positionsOf(totals),
    turn: turnOf(game, sheets),
    revision: game.moves.length,
    progress: { done: game.moves.length, total: game.players.length * cellsPerPlayer(game) },
    lastMove: last && Object.assign({ categoryName: CAT_BY_ID.get(last.category).name }, last),
    dice: game.dice && Object.assign({ yahtzee: isYahtzee(game.dice.values) }, game.dice),
    preview: previewOf(game, sheets),
    records: recordsOf(game, games || [game]),
    categories: CATEGORY_VIEW,
    rules: { upperBonusAt: UPPER_BONUS_AT, upperBonus: UPPER_BONUS, yahtzeeBonus: YAHTZEE_BONUS },
    options: OPTIONS,
  });
  delete view.moves;
  return view;
}

function gameSummary(game) {
  const sheets = buildSheets(game);
  return {
    id: game.id,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    players: game.players,
    columns: game.columns,
    status: game.status,
    totals: totalsOf(sheets),
    turn: turnOf(game, sheets),
    progress: { done: game.moves.length, total: game.players.length * cellsPerPlayer(game) },
  };
}

// ---------- klassement + highscores ----------

// Winst telt alleen met tegenstanders: wie alleen speelt wint altijd.
function buildRows(finished) {
  const byKey = new Map();
  for (const game of finished) {
    const sheets = buildSheets(game);
    const solo = game.players.length < 2;
    game.players.forEach((name, p) => {
      const key = shared.nameKey(name);
      let e = byKey.get(key);
      if (!e) {
        e = { name, gamesPlayed: 0, wins: 0, columns: 0, points: 0, best: 0, yahtzees: 0, bonuses: 0 };
        byKey.set(key, e);
      }
      e.name = name; // meest recente schrijfwijze wint
      e.gamesPlayed++;
      if (!solo && game.winners && game.winners.includes(p)) e.wins++;
      for (const col of sheets[p]) {
        const v = columnView(col);
        e.columns++;
        e.points += v.total;
        e.best = Math.max(e.best, v.total);
        e.yahtzees += (v.cells.yahtzee === 50 ? 1 : 0) + v.yahtzeeBonuses;
        if (v.bonus) e.bonuses++;
      }
    });
  }
  const rows = [...byKey.values()].map(e => ({
    name: e.name,
    gamesPlayed: e.gamesPlayed,
    wins: e.wins,
    columnsPlayed: e.columns,
    avgColumn: Math.round((e.points / e.columns) * 10) / 10,
    bestColumn: e.best,
    yahtzees: e.yahtzees,
    bonusPct: Math.round((100 * e.bonuses) / e.columns),
  }));
  rows.sort((a, b) => b.wins - a.wins || b.avgColumn - a.avgColumn || a.name.localeCompare(b.name, 'nl'));
  return rows;
}

function leaderboard(games, exclude) {
  return buildRows(shared.finishedGames(games, exclude));
}

function leaderboardView(games, exclude) {
  const view = shared.leaderboardView(games, exclude, buildRows);
  view.highscores = highscores(shared.finishedGames(games, exclude));
  return view;
}

module.exports = {
  OPTIONS, CATEGORIES, MAX_PLAYERS, MAX_COLUMNS, UPPER_BONUS_AT, UPPER_BONUS, YAHTZEE_BONUS,
  createGame, applyScore, applyDice, undo, abandon,
  buildSheets, columnView, scoreDice, isYahtzee,
  enrich, gameSummary, leaderboard, leaderboardView, highscores,
  httpError,
};
