// Tafeltennis-toernooilogica (4T) — autoritatief op de server.
// Puur (geen I/O); ook bruikbaar in Node-tests via module.exports.
//
// Een toernooi bestaat uit vooraf aangemaakte wedstrijden. De poule wordt
// met de cirkelmethode ingedeeld (elke speler hooguit één wedstrijd per
// ronde); de eindronde is een knock-outschema met standaard seeding en
// vrije rondes (byes) als het aantal spelers geen macht van twee is.
// Uitslagen mogen in elke volgorde worden ingevoerd; undo loopt de
// invoervolgorde terug (LIFO).
'use strict';

const crypto = require('node:crypto');
const shared = require('./shared.js');
const { httpError } = shared;

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 16;
const MAX_NAME = 30;
const FORMATS = ['poule', 'poule-ko', 'ko'];
const BEST_OF = [1, 3, 5, 7];
const POINTS_PER_GAME = [11, 21];
const KO_SIZES = [2, 4, 8, 16];
const MAX_TABLES = 4;
const DETAILS = ['points', 'games'];
const MAX_POINTS = 99;   // bovengrens per game (bij lang deuce)
const NOBODY = -1;       // lege plek in het schema: vrije ronde (bye)

const FORMAT_INFO = {
  'poule': { name: 'Poule', desc: 'Iedereen tegen iedereen; de eindstand bepaalt de winnaar.' },
  'poule-ko': { name: 'Poule + eindronde', desc: 'Eerst iedereen tegen iedereen, daarna knock-out voor de besten.' },
  'ko': { name: 'Knock-out', desc: 'Afvalschema: wie verliest is klaar.' },
};

const OPTIONS = {
  minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, maxName: MAX_NAME,
  formats: FORMATS.map(f => Object.assign({ id: f }, FORMAT_INFO[f])),
  bestOf: BEST_OF, pointsPerGame: POINTS_PER_GAME, koSizes: KO_SIZES,
  maxTables: MAX_TABLES, details: DETAILS, maxPoints: MAX_POINTS,
};

const gamesToWin = settings => Math.ceil(settings.bestOf / 2);
const decided = m => m.winner !== null;
const playable = m => !decided(m) && m.players.every(p => p !== null && p !== NOBODY);
const loserOf = m => (decided(m) ? (m.winner === m.players[0] ? m.players[1] : m.players[0]) : null);

// ---------- aanmaken ----------

function normalizeSettings(input, n) {
  const s = input && typeof input === 'object' ? input : {};
  const format = s.format === undefined ? 'poule' : s.format;
  if (!FORMATS.includes(format)) throw httpError(400, 'Onbekende toernooivorm');
  const bestOf = s.bestOf === undefined ? 3 : s.bestOf;
  if (!BEST_OF.includes(bestOf)) throw httpError(400, 'Best-of moet 1, 3, 5 of 7 zijn');
  const pointsPerGame = s.pointsPerGame === undefined ? 11 : s.pointsPerGame;
  if (!POINTS_PER_GAME.includes(pointsPerGame)) throw httpError(400, 'Een game gaat tot 11 of 21 punten');
  const tables = s.tables === undefined ? 1 : s.tables;
  if (!Number.isInteger(tables) || tables < 1 || tables > MAX_TABLES) {
    throw httpError(400, 'Aantal tafels: 1–' + MAX_TABLES);
  }
  const detail = s.detail === undefined ? 'points' : s.detail;
  if (!DETAILS.includes(detail)) throw httpError(400, 'Onbekende invoervorm');

  let koSize = 0;
  if (format === 'poule-ko') {
    koSize = s.koSize === undefined ? (n >= 4 ? 4 : 2) : s.koSize;
    if (!KO_SIZES.includes(koSize)) throw httpError(400, 'Eindronde met 2, 4, 8 of 16 spelers');
    if (koSize > n) throw httpError(400, 'De eindronde kan niet groter zijn dan het aantal spelers');
  } else if (format === 'ko') {
    koSize = 2;
    while (koSize < n) koSize *= 2;
  }
  // Troostfinale (om plek 3) kan pas vanaf halve finales.
  const bronze = koSize >= 4 && (s.bronze === undefined ? true : s.bronze === true);
  return { format, bestOf, pointsPerGame, tables, detail, koSize, bronze };
}

function createGame(input) {
  if (!input || typeof input !== 'object') throw httpError(400, 'Toernooi ontbreekt');
  const names = input.players;
  if (!Array.isArray(names)) throw httpError(400, 'Spelers ontbreken');
  const players = names.map(n => String(n == null ? '' : n).trim()).filter(n => n);
  if (players.length !== names.length) throw httpError(400, 'Vul alle namen in');
  if (players.length < MIN_PLAYERS) throw httpError(400, 'Een toernooi heeft minstens ' + MIN_PLAYERS + ' spelers');
  if (players.length > MAX_PLAYERS) throw httpError(400, 'Maximaal ' + MAX_PLAYERS + ' spelers');
  if (players.some(n => n.length > MAX_NAME)) throw httpError(400, 'Naam te lang (max ' + MAX_NAME + ' tekens)');
  // Het klassement koppelt op naam (case-insensitief); dubbele namen zouden
  // daar dubbel tellen én in het schema niet uit elkaar te houden zijn.
  if (new Set(players.map(shared.nameKey)).size !== players.length) {
    throw httpError(400, 'Elke speler heeft een eigen naam nodig');
  }
  const settings = normalizeSettings(input.settings, players.length);
  const now = new Date().toISOString();
  const game = {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    players,
    settings,
    matches: [],         // alle wedstrijden, in speelvolgorde (poule, dan eindronde)
    history: [],         // match-id's in invoervolgorde; undo = LIFO
    draft: null,         // live tussenstand van een lopende wedstrijd: {matchId, games}
    status: 'active',    // active | finished | abandoned
    ranking: null,       // eindstand [{player, rank}] zodra het toernooi uit is
  };
  if (settings.format === 'ko') {
    game.matches = buildBracket(settings.koSize, players.map((_, i) => i), settings.bronze);
    propagate(game);
  } else {
    game.matches = buildPoule(players.length);
  }
  return game;
}

function newMatch(id, stage, round, players, extra) {
  return Object.assign({
    id, stage, round, label: '', players,
    from: null,          // eindronde: waar de spelers vandaan komen [{match, take}]
    bronze: false,
    games: null,         // [[11,7],[9,11],...] bij invoer per punt
    gamesWon: null,      // [a, b]
    winner: null,        // spelerindex, NOBODY bij een lege plek, null = nog niet gespeeld
    bye: false,          // automatisch beslist (vrije ronde)
    recordedAt: null,
  }, extra);
}

// ---------- poule: cirkelmethode ----------

// Rondes waarin elke speler hooguit één keer speelt. Bij een oneven aantal
// zit er een lege plek in de cirkel: wie daartegenover staat is die ronde vrij.
function pouleSchedule(n) {
  const ids = [...Array(n).keys()];
  if (n % 2) ids.push(NOBODY);
  const m = ids.length;
  const rounds = [];
  let arr = ids.slice();
  for (let r = 0; r < m - 1; r++) {
    const round = [];
    for (let i = 0; i < m / 2; i++) {
      const a = arr[i], b = arr[m - 1 - i];
      if (a === NOBODY || b === NOBODY) continue;
      round.push(r % 2 ? [b, a] : [a, b]); // wissel af wie links staat
    }
    rounds.push(round);
    arr = [arr[0], arr[m - 1], ...arr.slice(1, m - 1)]; // eerste blijft, rest draait
  }
  return rounds;
}

function buildPoule(n) {
  const matches = [];
  pouleSchedule(n).forEach((round, r) => round.forEach(pair => {
    matches.push(newMatch('p' + (matches.length + 1), 'poule', r, pair, { label: 'Ronde ' + (r + 1) }));
  }));
  return matches;
}

// ---------- eindronde: knock-outschema ----------

// Standaard seeding: 1 tegen de laagste, zodat 1 en 2 elkaar pas in de
// finale kunnen treffen (4: 1–4, 2–3; 8: 1–8, 4–5, 2–7, 3–6).
function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2 + 1;
    order = order.flatMap(s => [s, n - s]);
  }
  return order;
}

function roundName(roundsLeft) {
  return { 1: 'Finale', 2: 'Halve finale', 3: 'Kwartfinale', 4: 'Achtste finale' }[roundsLeft] || 'Ronde';
}

// `seeds` = spelerindexen op sterkte; plekken zonder speler worden vrije rondes.
function buildBracket(size, seeds, bronze) {
  const nRounds = Math.round(Math.log2(size));
  const order = seedOrder(size);
  const matches = [];
  let n = 0;
  const mk = (round, i, count, players, from, extra) => {
    const name = roundName(nRounds - round);
    const m = newMatch('k' + (++n), 'ko', round, players,
      Object.assign({ from, label: count > 1 ? name + ' ' + (i + 1) : name }, extra));
    matches.push(m);
    return m;
  };
  const slot = s => (s <= seeds.length ? seeds[s - 1] : NOBODY);
  let prev = [];
  for (let i = 0; i < size / 2; i++) {
    prev.push(mk(0, i, size / 2, [slot(order[2 * i]), slot(order[2 * i + 1])], null));
  }
  for (let r = 1; r < nRounds; r++) {
    const count = prev.length / 2;
    // De troostfinale staat vóór de finale in de speelvolgorde.
    if (r === nRounds - 1 && bronze) {
      mk(r, 0, 1, [null, null],
        [{ match: prev[0].id, take: 'loser' }, { match: prev[1].id, take: 'loser' }],
        { bronze: true, label: 'Troostfinale' });
    }
    const cur = [];
    for (let i = 0; i < count; i++) {
      cur.push(mk(r, i, count, [null, null],
        [{ match: prev[2 * i].id, take: 'winner' }, { match: prev[2 * i + 1].id, take: 'winner' }]));
    }
    prev = cur;
  }
  return matches;
}

// Vult de plekken in het schema vanuit de bronwedstrijden en beslist vrije
// rondes automatisch. Bronnen staan altijd eerder in de lijst, dus één pass
// volstaat. Ook na undo: een plek die weer onbekend wordt, maakt een eerder
// automatisch besliste vrije ronde ongedaan.
function propagate(game) {
  const byId = new Map(game.matches.map(m => [m.id, m]));
  for (const m of game.matches) {
    if (m.stage !== 'ko') continue;
    if (m.from) {
      m.players = m.from.map(f => {
        const src = byId.get(f.match);
        if (!src || !decided(src)) return null;
        return f.take === 'winner' ? src.winner : loserOf(src);
      });
    }
    const [a, b] = m.players;
    const known = a !== null && b !== null;
    if (m.bye && (!known || (a !== NOBODY && b !== NOBODY))) {
      m.bye = false;
      m.winner = null;
    }
    if (!decided(m) && known && (a === NOBODY || b === NOBODY)) {
      m.bye = true;
      m.winner = a === NOBODY ? b : a;
      m.games = null;
      m.gamesWon = null;
    }
  }
}

// ---------- stand ----------

function statsFor(idxs, matches) {
  const st = new Map(idxs.map(i => [i, { played: 0, won: 0, lost: 0, gf: 0, ga: 0, pf: 0, pa: 0 }]));
  for (const m of matches) {
    if (!decided(m) || m.bye) continue;
    const [a, b] = m.players;
    if (!st.has(a) || !st.has(b)) continue;
    const [wa, wb] = m.gamesWon;
    let pa = 0, pb = 0;
    if (m.games) for (const [x, y] of m.games) { pa += x; pb += y; }
    const A = st.get(a), B = st.get(b);
    A.played++; B.played++;
    if (m.winner === a) { A.won++; B.lost++; } else { B.won++; A.lost++; }
    A.gf += wa; A.ga += wb; B.gf += wb; B.ga += wa;
    A.pf += pa; A.pa += pb; B.pf += pb; B.pa += pa;
  }
  return st;
}

// Rangschikking: gewonnen wedstrijden; wie gelijk staat wordt onderling
// vergeleken (winst, dan game- en puntensaldo in de onderlinge duels), en
// wat dan nog gelijk is op game- en puntensaldo over de hele poule. Wat
// daarna nog gelijk staat, deelt de plek. Geeft groepen terug die één plek
// delen; binnen een groep op spelersvolgorde.
function rankPlayers(idxs, matches, overall) {
  const among = matches.filter(m => idxs.includes(m.players[0]) && idxs.includes(m.players[1]));
  const st = statsFor(idxs, among);
  const sorted = [...idxs].sort((a, b) => st.get(b).won - st.get(a).won || a - b);
  const out = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && st.get(sorted[j]).won === st.get(sorted[i]).won) j++;
    const group = sorted.slice(i, j);
    if (group.length === 1) out.push(group);
    else if (group.length < idxs.length) out.push(...rankPlayers(group, matches, overall));
    else out.push(...bySaldo(group, st, overall));
    i = j;
  }
  return out;
}

function bySaldo(group, st, overall) {
  const key = p => [
    st.get(p).gf - st.get(p).ga, st.get(p).pf - st.get(p).pa,
    overall.get(p).gf - overall.get(p).ga, overall.get(p).pf - overall.get(p).pa,
  ];
  const sorted = [...group].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let k = 0; k < ka.length; k++) if (ka[k] !== kb[k]) return kb[k] - ka[k];
    return a - b;
  });
  const groups = [];
  for (const p of sorted) {
    const last = groups[groups.length - 1];
    if (last && key(last[0]).every((v, k) => v === key(p)[k])) last.push(p);
    else groups.push([p]);
  }
  return groups;
}

// Poulestand als rijen, in rangorde. Bij een gedeelde plek staan spelers op
// spelersvolgorde (dat is ook de volgorde voor de seeding van de eindronde).
function standings(game) {
  const idxs = game.players.map((_, i) => i);
  const poule = game.matches.filter(m => m.stage === 'poule');
  const overall = statsFor(idxs, poule);
  const rows = [];
  let rank = 1;
  for (const group of rankPlayers(idxs, poule, overall)) {
    for (const p of group) {
      const s = overall.get(p);
      rows.push({
        player: p, name: game.players[p], rank, tied: group.length > 1,
        played: s.played, won: s.won, lost: s.lost,
        gamesWon: s.gf, gamesLost: s.ga, pointsFor: s.pf, pointsAgainst: s.pa,
      });
    }
    rank += group.length;
  }
  return rows;
}

// ---------- afronden ----------

function finalRanking(game) {
  const s = game.settings;
  if (s.format === 'poule') return standings(game).map(r => ({ player: r.player, rank: r.rank }));
  const ko = game.matches.filter(m => m.stage === 'ko');
  const nRounds = Math.round(Math.log2(s.koSize));
  const final = ko.find(m => m.round === nRounds - 1 && !m.bronze);
  const bronze = ko.find(m => m.bronze);
  // Volgorde binnen een gedeelde plek: poulestand, of seeding bij puur knock-out.
  const order = s.format === 'ko' ? game.players.map((_, i) => i) : standings(game).map(r => r.player);
  const pos = new Map(order.map((p, i) => [p, i]));
  const rows = [];
  const seen = new Set();
  const push = (players, rank) => {
    players.filter(p => p !== null && p !== NOBODY && !seen.has(p))
      .sort((a, b) => pos.get(a) - pos.get(b))
      .forEach(p => { rows.push({ player: p, rank }); seen.add(p); });
  };
  push([final.winner], 1);
  push([loserOf(final)], 2);
  if (bronze) { push([bronze.winner], 3); push([loserOf(bronze)], 4); }
  // Verliezers van eerdere rondes delen een plek: halve finale 3, kwartfinale 5, …
  for (let r = nRounds - 2; r >= 0; r--) {
    push(ko.filter(m => m.round === r && !m.bronze).map(loserOf), Math.pow(2, nRounds - r - 1) + 1);
  }
  if (s.format === 'poule-ko') {
    for (const row of standings(game)) {
      if (seen.has(row.player)) continue;
      rows.push({ player: row.player, rank: Math.max(row.rank, rows.length + 1) });
      seen.add(row.player);
    }
  }
  return rows;
}

// Na elke mutatie: schema bijwerken, eindronde opbouwen zodra de poule uit
// is, en het toernooi afsluiten (of heropenen na undo).
function settle(game) {
  propagate(game);
  const s = game.settings;
  const poule = game.matches.filter(m => m.stage === 'poule');
  const pouleDone = poule.length > 0 && poule.every(decided);
  if (s.format === 'poule-ko' && pouleDone && !game.matches.some(m => m.stage === 'ko')) {
    const seeds = standings(game).map(r => r.player).slice(0, s.koSize);
    game.matches.push(...buildBracket(s.koSize, seeds, s.bronze));
    propagate(game);
  }
  const ko = game.matches.filter(m => m.stage === 'ko');
  const done = s.format === 'poule' ? pouleDone : ko.length > 0 && ko.every(decided);
  if (done) {
    game.status = 'finished';
    game.finishedAt = game.updatedAt;
    game.ranking = finalRanking(game);
  } else if (game.status === 'finished') {
    game.status = 'active';
    game.finishedAt = null;
    game.ranking = null;
  }
}

// ---------- mutaties ----------

function parseGame(g, P) {
  if (!Array.isArray(g) || g.length !== 2
    || !g.every(v => Number.isInteger(v) && v >= 0 && v <= MAX_POINTS)) {
    throw httpError(400, 'Vul per game de punten van beide spelers in');
  }
  const [a, b] = g;
  if (a === b) throw httpError(400, 'Een game eindigt nooit gelijk');
  const w = Math.max(a, b), l = Math.min(a, b);
  if (w < P) throw httpError(400, 'Een game gaat tot ' + P + ' punten');
  if (w === P ? l > P - 2 : l !== w - 2) {
    throw httpError(400, 'Een game win je met twee punten verschil (bijv. ' + P + '–' + (P - 2) + ' of ' + (P + 1) + '–' + (P - 1) + ')');
  }
  return [a, b];
}

function findMatch(game, matchId) {
  const m = game.matches.find(x => x.id === matchId);
  if (!m) throw httpError(404, 'Wedstrijd niet gevonden');
  return m;
}

function checkOpen(game, m) {
  if (m.bye) throw httpError(409, 'Dit is een vrije ronde');
  if (decided(m)) throw httpError(409, 'Deze uitslag is al ingevoerd');
  if (!playable(m)) throw httpError(409, 'De spelers van deze wedstrijd zijn nog niet bekend');
}

// Uitslag invoeren. Bij `detail: 'points'` per game de punten
// (`games: [[11,7],[9,11],[11,8]]`), anders alleen gewonnen games
// (`gamesWon: [2,1]`). De server controleert de best-of en het deuce-verschil.
function applyResult(game, input) {
  if (game.status !== 'active') throw httpError(409, 'Dit toernooi is al afgelopen');
  if (!input || typeof input !== 'object') throw httpError(400, 'Uitslag ontbreekt');
  const m = findMatch(game, input.matchId);
  checkOpen(game, m);
  const s = game.settings;
  const toWin = gamesToWin(s);
  let games = null, gamesWon;
  if (s.detail === 'points') {
    if (!Array.isArray(input.games) || !input.games.length) throw httpError(400, 'Vul de games in');
    if (input.games.length > s.bestOf) throw httpError(400, 'Best-of-' + s.bestOf + ': hooguit ' + s.bestOf + ' games');
    games = input.games.map(g => parseGame(g, s.pointsPerGame));
    gamesWon = [0, 0];
    for (const [a, b] of games) {
      if (Math.max(...gamesWon) >= toWin) throw httpError(400, 'Na de beslissende game volgen geen games meer');
      gamesWon[a > b ? 0 : 1]++;
    }
    if (Math.max(...gamesWon) < toWin) {
      throw httpError(400, 'De wedstrijd is nog niet uit: iemand moet ' + toWin + ' games winnen');
    }
  } else {
    gamesWon = input.gamesWon;
    if (!Array.isArray(gamesWon) || gamesWon.length !== 2 || !gamesWon.every(Number.isInteger)) {
      throw httpError(400, 'Vul de gewonnen games in');
    }
    if (Math.max(...gamesWon) !== toWin || Math.min(...gamesWon) < 0 || Math.min(...gamesWon) >= toWin) {
      throw httpError(400, 'De winnaar heeft precies ' + toWin + ' games, de verliezer minder');
    }
  }
  const now = new Date().toISOString();
  m.games = games;
  m.gamesWon = [gamesWon[0], gamesWon[1]];
  m.winner = m.players[gamesWon[0] > gamesWon[1] ? 0 : 1];
  m.recordedAt = now;
  game.history.push(m.id);
  game.draft = null;
  game.updatedAt = now;
  settle(game);
}

// Live tussenstand van een lopende wedstrijd; niet-autoritatief, telt nergens
// in mee, maar komt in de SSE-snapshot zodat het scorebord kan meekijken.
// `games` mag gedeeltelijk zijn (null = nog niet ingevuld); leeg = wissen.
function applyDraft(game, matchId, games) {
  if (game.status !== 'active') throw httpError(409, 'Dit toernooi is al afgelopen');
  if (games == null || (Array.isArray(games) && !games.length)) {
    game.draft = null;
    game.updatedAt = new Date().toISOString();
    return;
  }
  const m = findMatch(game, matchId);
  checkOpen(game, m);
  if (!Array.isArray(games) || games.length > game.settings.bestOf) throw httpError(400, 'Ongeldige tussenstand');
  const clean = games.map(g => {
    if (!Array.isArray(g) || g.length !== 2) throw httpError(400, 'Ongeldige tussenstand');
    return g.map(v => {
      if (v === null || v === '') return null;
      if (!Number.isInteger(v) || v < 0 || v > MAX_POINTS) throw httpError(400, 'Ongeldige tussenstand');
      return v;
    });
  });
  game.draft = clean.some(g => g.some(v => v !== null)) ? { matchId, games: clean } : null;
  game.updatedAt = new Date().toISOString();
}

// Laatst ingevoerde uitslag terugnemen. `revision` (optioneel) is het aantal
// ingevoerde uitslagen dat de client zag: klopt dat niet, dan is het toernooi
// elders bijgewerkt en nemen we niets terug.
function undo(game, revision) {
  if (game.status === 'abandoned') throw httpError(409, 'Dit toernooi is afgebroken');
  if (revision !== undefined && revision !== game.history.length) {
    throw httpError(409, 'Toernooi is elders bijgewerkt');
  }
  const id = game.history.pop();
  if (!id) throw httpError(409, 'Niets om ongedaan te maken');
  const m = findMatch(game, id);
  m.games = null;
  m.gamesWon = null;
  m.winner = null;
  m.recordedAt = null;
  if (m.stage === 'poule' && game.settings.format === 'poule-ko') {
    // De poule gaat weer open, dus de seeding kan veranderen. De eindronde
    // is nog niet gespeeld (undo is LIFO), dus die mag helemaal weg.
    if (game.matches.some(x => x.stage === 'ko' && x.games)) {
      throw httpError(409, 'Neem eerst de eindronde terug');
    }
    game.matches = game.matches.filter(x => x.stage !== 'ko');
  }
  game.draft = null;
  game.updatedAt = new Date().toISOString();
  settle(game);
}

function abandon(game) {
  if (game.status !== 'active') throw httpError(409, 'Dit toernooi is al afgelopen');
  game.status = 'abandoned';
  game.draft = null;
  game.updatedAt = new Date().toISOString();
}

// ---------- views ----------

function phaseOf(game) {
  if (game.status === 'finished') return 'done';
  return game.matches.some(m => m.stage === 'ko') ? 'ko' : 'poule';
}

// Wie er nu aan tafel kan: de eerste speelbare wedstrijden in
// schema-volgorde waarvan geen speler al bezig is, één per tafel.
function upNow(game) {
  const busy = new Set();
  const now = [];
  for (const m of game.matches) {
    if (!playable(m) || m.players.some(p => busy.has(p))) continue;
    now.push(m.id);
    m.players.forEach(p => busy.add(p));
    if (now.length >= game.settings.tables) break;
  }
  return now;
}

function slotsOf(game, m, byId) {
  return m.players.map((p, i) => {
    if (p !== null && p !== NOBODY) return { player: p, name: game.players[p], pending: null };
    if (p === NOBODY) return { player: NOBODY, name: null, pending: 'vrije ronde' };
    const f = m.from && m.from[i];
    const src = f && byId.get(f.match);
    return { player: null, name: null, pending: src ? (f.take === 'winner' ? 'Winnaar ' : 'Verliezer ') + src.label : '?' };
  });
}

function matchView(game, m, byId) {
  return Object.assign({}, m, {
    slots: slotsOf(game, m, byId),
    playable: playable(m),
    decided: decided(m),
    winnerName: decided(m) && m.winner !== NOBODY ? game.players[m.winner] : null,
  });
}

function koRounds(game) {
  const ko = game.matches.filter(m => m.stage === 'ko');
  if (!ko.length) return null;
  const nRounds = Math.round(Math.log2(game.settings.koSize));
  const rounds = [];
  for (let r = 0; r < nRounds; r++) {
    rounds.push({ round: r, name: roundName(nRounds - r), matches: ko.filter(m => m.round === r).map(m => m.id) });
  }
  return rounds;
}

function progressOf(game) {
  const real = game.matches.filter(m => !m.bye);
  let total = real.length;
  const s = game.settings;
  if (s.format === 'poule-ko' && !game.matches.some(m => m.stage === 'ko')) {
    total += s.koSize - 1 + (s.bronze ? 1 : 0); // de eindronde die nog komt
  }
  return { done: real.filter(decided).length, total };
}

// Verrijkte view voor het API: toernooi + afgeleide velden (niet persistent).
function enrich(game) {
  const byId = new Map(game.matches.map(m => [m.id, m]));
  const now = game.status === 'active' ? upNow(game) : [];
  const nowSet = new Set(now);
  // "Hierna": open wedstrijden in volgorde, zonder wat straks toch een vrije ronde wordt.
  const next = game.status === 'active'
    ? game.matches.filter(m => !decided(m) && !nowSet.has(m.id) && !m.players.includes(NOBODY))
      .slice(0, 3).map(m => m.id)
    : [];
  return Object.assign({}, game, {
    matches: game.matches.map(m => matchView(game, m, byId)),
    revision: game.history.length,
    phase: phaseOf(game),
    gamesToWin: gamesToWin(game.settings),
    formatInfo: FORMAT_INFO[game.settings.format],
    standings: game.settings.format === 'ko' ? null : standings(game),
    koRounds: koRounds(game),
    upNow: now,
    upNext: next,
    progress: progressOf(game),
    ranking: game.ranking ? game.ranking.map(r => Object.assign({ name: game.players[r.player] }, r)) : null,
    options: OPTIONS,
  });
}

function gameSummary(game) {
  const winner = game.ranking ? game.ranking.filter(r => r.rank === 1).map(r => game.players[r.player]) : [];
  return {
    id: game.id,
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
    players: game.players,
    settings: game.settings,
    status: game.status,
    phase: phaseOf(game),
    progress: progressOf(game),
    winners: winner,
  };
}

// ---------- klassement over toernooien heen ----------

function buildRows(finished) {
  const byKey = new Map();
  for (const game of finished) {
    const rankOf = new Map((game.ranking || []).map(r => [r.player, r.rank]));
    game.players.forEach((name, i) => {
      const key = shared.nameKey(name);
      let e = byKey.get(key);
      if (!e) {
        e = { name, tournaments: 0, titles: 0, podiums: 0, matchesPlayed: 0, matchesWon: 0 };
        byKey.set(key, e);
      }
      e.name = name; // meest recente schrijfwijze wint
      e.tournaments++;
      const rank = rankOf.get(i);
      if (rank === 1) e.titles++;
      if (rank && rank <= 3) e.podiums++;
      for (const m of game.matches) {
        if (!decided(m) || m.bye || !m.players.includes(i)) continue;
        e.matchesPlayed++;
        if (m.winner === i) e.matchesWon++;
      }
    });
  }
  const rows = [...byKey.values()].map(e => Object.assign({}, e, {
    winPct: e.matchesPlayed ? Math.round((100 * e.matchesWon) / e.matchesPlayed) : 0,
  }));
  rows.sort((a, b) => b.titles - a.titles || b.podiums - a.podiums || b.winPct - a.winPct
    || b.matchesWon - a.matchesWon || a.name.localeCompare(b.name, 'nl'));
  return rows;
}

function leaderboard(games, exclude) {
  return buildRows(shared.finishedGames(games, exclude));
}

function leaderboardView(games, exclude) {
  return shared.leaderboardView(games, exclude, buildRows);
}

module.exports = {
  OPTIONS, FORMATS, BEST_OF, POINTS_PER_GAME, KO_SIZES, NOBODY,
  MIN_PLAYERS, MAX_PLAYERS, MAX_TABLES,
  createGame, applyResult, applyDraft, undo, abandon,
  pouleSchedule, seedOrder, buildBracket, standings, finalRanking, gamesToWin,
  enrich, gameSummary, leaderboard, leaderboardView,
  httpError,
};
