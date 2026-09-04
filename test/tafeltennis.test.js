// End-to-end API-test voor het tafeltennis-deel van de server. Run: node test/tafeltennis.test.js
// Geen dependencies: spawnt de echte server op een vrije poort met een temp DATA_DIR.
'use strict';

const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');

const SERVER = path.join(__dirname, '..', 'server', 'server.js');
const API = '/api/tafeltennis';
let PORT = 0;
let BASE = '';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-test-'));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

let serverProc = null;

async function startServer() {
  if (!PORT) {
    PORT = await freePort();
    BASE = 'http://localhost:' + PORT;
  }
  return new Promise((resolve, reject) => {
    serverProc = spawn(process.execPath, [SERVER], {
      env: { ...process.env, PORT: String(PORT), DATA_DIR },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    serverProc.stdout.on('data', d => {
      if (String(d).includes('draait op')) resolve();
    });
    serverProc.on('exit', code => reject(new Error('server stopte met code ' + code)));
    setTimeout(() => reject(new Error('server startte niet binnen 5s')), 5000).unref();
  });
}

function stopServer() {
  return new Promise(resolve => {
    if (!serverProc || serverProc.exitCode !== null) return resolve();
    serverProc.removeAllListeners('exit');
    serverProc.on('exit', resolve);
    serverProc.kill();
  });
}

async function api(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

// ---- onafhankelijke herimplementatie (bewust NIET uit tafeltennis.js) ----

// Geldige game tot P punten: winnaar minstens P, twee punten verschil, en
// boven P precies twee verschil.
function validGame([a, b], P) {
  if (a === b) return false;
  const w = Math.max(a, b), l = Math.min(a, b);
  if (w < P) return false;
  return w === P ? l <= P - 2 : l === w - 2;
}

// Willekeurige geldige wedstrijd: `winner` (0/1) wint met toWin games.
function randomMatch(toWin, P, winner) {
  const games = [];
  const won = [0, 0];
  while (won[winner] < toWin) {
    const loserGames = won[1 - winner];
    // de verliezer mag nog games pakken zolang hij er minder dan toWin heeft
    const gWinner = loserGames < toWin - 1 && Math.random() < 0.35 ? 1 - winner : winner;
    let g;
    if (Math.random() < 0.3) { const l = P - 1 + Math.floor(Math.random() * 4); g = [l + 2, l]; } // deuce
    else g = [P, Math.floor(Math.random() * (P - 1))];
    if (gWinner === 1) g = [g[1], g[0]];
    games.push(g);
    won[gWinner]++;
  }
  return games;
}

// Stand volgens de regels uit de README: wedstrijdwinst, dan onderling
// (winst, game-, puntensaldo), dan game- en puntensaldo over de hele poule.
function expectedStandings(n, results) {
  const stats = (idxs, only) => {
    const st = new Map(idxs.map(i => [i, { w: 0, gd: 0, pd: 0 }]));
    for (const r of results) {
      const [a, b] = r.players;
      if (!st.has(a) || !st.has(b) || (only && !(only.includes(a) && only.includes(b)))) continue;
      const ga = r.games.filter(g => g[0] > g[1]).length, gb = r.games.length - ga;
      const pa = r.games.reduce((s, g) => s + g[0], 0), pb = r.games.reduce((s, g) => s + g[1], 0);
      if (ga > gb) st.get(a).w++; else st.get(b).w++;
      st.get(a).gd += ga - gb; st.get(b).gd += gb - ga;
      st.get(a).pd += pa - pb; st.get(b).pd += pb - pa;
    }
    return st;
  };
  const all = stats([...Array(n).keys()]);
  const rank = idxs => {
    const st = stats(idxs, idxs);
    const sorted = [...idxs].sort((a, b) => st.get(b).w - st.get(a).w || a - b);
    const out = [];
    for (let i = 0; i < sorted.length;) {
      let j = i;
      while (j < sorted.length && st.get(sorted[j]).w === st.get(sorted[i]).w) j++;
      const grp = sorted.slice(i, j);
      if (grp.length === 1) out.push(grp);
      else if (grp.length < idxs.length) out.push(...rank(grp));
      else {
        const key = p => [st.get(p).gd, st.get(p).pd, all.get(p).gd, all.get(p).pd];
        const s2 = [...grp].sort((a, b) => {
          const ka = key(a), kb = key(b);
          for (let k = 0; k < 4; k++) if (ka[k] !== kb[k]) return kb[k] - ka[k];
          return a - b;
        });
        let cur = [];
        for (const p of s2) {
          if (cur.length && key(cur[0]).join() === key(p).join()) cur.push(p);
          else { if (cur.length) out.push(cur); cur = [p]; }
        }
        out.push(cur);
      }
      i = j;
    }
    return out;
  };
  const rows = [];
  let r = 1;
  for (const grp of rank([...Array(n).keys()])) {
    for (const p of grp) rows.push({ player: p, rank: r, tied: grp.length > 1 });
    r += grp.length;
  }
  return rows;
}

const result = (id, matchId, games) => api('POST', API + '/games/' + id + '/result', { matchId, games });

// Speel alle speelbare wedstrijden (optioneel alleen van één fase) tot er
// niets meer open staat; `pick(match)` geeft de winnaarskant (0/1).
// Uitslagen in willekeurige volgorde, zoals in het echt.
async function playOut(game, pick, P, toWin, stage) {
  const played = [];
  for (let guard = 0; guard < 500; guard++) {
    const open = game.matches.filter(m => m.playable && (!stage || m.stage === stage));
    if (!open.length) break;
    const m = open[Math.floor(Math.random() * open.length)];
    const games = randomMatch(toWin, P, pick(m));
    const r = await result(game.id, m.id, games);
    assert.equal(r.status, 200, m.label + ': ' + JSON.stringify(r.body));
    game = r.body;
    played.push({ players: m.players, games });
  }
  return { game, played };
}

async function main() {
  await startServer();

  // --- opties voor het startscherm ---
  {
    const o = (await api('GET', API + '/options')).body;
    assert.deepEqual(o.formats.map(f => f.id), ['poule', 'poule-ko', 'ko']);
    assert.deepEqual(o.bestOf, [1, 3, 5, 7]);
    assert.equal(o.minPlayers, 3);
    console.log('OK opties');
  }

  // --- poule: schema, uitslagen, stand tegen onafhankelijke herimplementatie ---
  for (const n of [3, 4, 5, 6, 7]) {
    const names = Array.from({ length: n }, (_, i) => 'P' + n + '-' + i);
    const created = await api('POST', API + '/games', {
      players: names, settings: { format: 'poule', bestOf: 5, pointsPerGame: 11, tables: 2 },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    let game = created.body;
    assert.equal(game.phase, 'poule');
    assert.equal(game.revision, 0);
    assert.equal(game.gamesToWin, 3);
    const poule = game.matches.filter(m => m.stage === 'poule');
    assert.equal(poule.length, n * (n - 1) / 2, 'iedereen tegen iedereen');
    assert.equal(game.matches.length, poule.length, 'geen eindronde bij een poule');
    // cirkelmethode: per ronde speelt iedereen hooguit één keer
    const byRound = new Map();
    for (const m of poule) {
      const set = byRound.get(m.round) || new Set();
      for (const p of m.players) { assert.ok(!set.has(p), 'dubbel in ronde ' + m.round); set.add(p); }
      byRound.set(m.round, set);
    }
    assert.equal(byRound.size, n % 2 ? n : n - 1, 'aantal rondes');
    // nu aan tafel: twee tafels, geen speler op beide tegelijk
    assert.equal(game.upNow.length, Math.min(2, Math.floor(n / 2)));
    const busy = game.upNow.flatMap(id => game.matches.find(m => m.id === id).players);
    assert.equal(new Set(busy).size, busy.length, 'speler niet op twee tafels');
    assert.deepEqual(game.standings.map(r => r.rank), Array(n).fill(1), 'begin: iedereen gedeeld eerste');

    const out = await playOut(game, () => Math.floor(Math.random() * 2), 11, 3);
    game = out.game;
    assert.equal(game.status, 'finished', 'poule uit → toernooi uit');
    assert.equal(game.phase, 'done');
    assert.equal(game.revision, poule.length);
    assert.deepEqual(game.upNow, []);
    const exp = expectedStandings(n, out.played);
    assert.deepEqual(game.standings.map(r => [r.player, r.rank, r.tied]), exp.map(r => [r.player, r.rank, r.tied]),
      'stand n=' + n);
    assert.deepEqual(game.ranking.map(r => [r.player, r.rank]), exp.map(r => [r.player, r.rank]), 'eindstand');
    // statistieken kloppen met de gespeelde games
    for (const row of game.standings) {
      const mine = out.played.filter(p => p.players.includes(row.player));
      assert.equal(row.played, mine.length);
      const gw = mine.reduce((s, p) => s + p.games.filter(g => (g[0] > g[1]) === (p.players[0] === row.player)).length, 0);
      assert.equal(row.gamesWon, gw, 'gewonnen games');
    }
  }
  console.log('OK poule 3–7 spelers: schema, stand, eindstand (onafhankelijk nagerekend)');

  // --- tiebreak met de hand: onderling resultaat gaat vóór game-saldo ---
  {
    // A wint van B (3-0), B wint van C (3-2), C wint van A (3-2): iedereen 1 winst.
    // Onderling: allen 1-1, game-saldo A +3-1=+2... wacht: A: +3 (vs B) -1 (vs C) = +2,
    // B: -3 +1 = -2, C: -1 +1 = 0 → A, C, B.
    const c = await api('POST', API + '/games', { players: ['A', 'B', 'C'], settings: { bestOf: 5 } });
    const g = c.body;
    const find = (a, b) => g.matches.find(m => m.players.includes(a) && m.players.includes(b));
    const play = async (a, b, gamesForA) => {
      const m = find(a, b);
      const games = m.players[0] === a ? gamesForA : gamesForA.map(x => [x[1], x[0]]);
      const r = await result(g.id, m.id, games);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body;
    };
    await play(0, 1, [[11, 5], [11, 5], [11, 5]]);
    await play(1, 2, [[11, 5], [11, 5], [5, 11], [5, 11], [11, 5]]);
    const done = await play(2, 0, [[11, 5], [11, 5], [5, 11], [5, 11], [11, 5]]);
    assert.equal(done.status, 'finished');
    assert.deepEqual(done.standings.map(r => [r.name, r.rank]), [['A', 1], ['C', 2], ['B', 3]]);
    assert.ok(done.standings.every(r => !r.tied));
    console.log('OK tiebreak op game-saldo bij gelijke winst');
  }

  // --- validatie van games en uitslagen ---
  {
    const c = await api('POST', API + '/games', { players: ['V1', 'V2', 'V3'], settings: { bestOf: 3, pointsPerGame: 11 } });
    const id = c.body.id;
    const m = c.body.matches[0];
    const bad = async (games, why) => {
      const r = await result(id, m.id, games);
      assert.equal(r.status, 400, why + ': ' + JSON.stringify(r.body));
    };
    await bad([[11, 10], [11, 3]], '11-10 is geen game');
    await bad([[12, 9], [11, 3]], 'boven de 11 precies twee verschil');
    await bad([[10, 8], [11, 3]], 'game tot 11');
    await bad([[11, 11], [11, 3]], 'gelijk');
    await bad([[11, 3]], 'nog niet uit (best of 3)');
    await bad([[11, 3], [11, 3], [11, 3]], 'game na de beslissende game');
    await bad([[11, 3], [3, 11], [11, 3], [3, 11]], 'meer games dan best-of');
    await bad([[11, -1], [11, 3]], 'negatief');
    await bad([[11, 3], [11]], 'halve game');
    await bad([], 'leeg');
    await bad(undefined, 'ontbreekt');
    // deuce mag wel, lang deuce ook
    let r = await result(id, m.id, [[11, 9], [8, 11], [23, 21]]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.matches[0].gamesWon, [2, 1]);
    assert.equal(r.body.matches[0].winner, m.players[0]);
    assert.equal(r.body.revision, 1);
    // dezelfde wedstrijd nog eens → 409 (concurrency-guard)
    r = await result(id, m.id, [[11, 9], [11, 9]]);
    assert.equal(r.status, 409, 'al ingevoerd');
    assert.equal((await result(id, 'bestaat-niet', [[11, 9], [11, 9]])).status, 404);
    assert.equal((await api('GET', API + '/games/bestaat-niet')).status, 404);
    // undo met verkeerde revisie → 409, met de juiste → terug
    assert.equal((await api('POST', API + '/games/' + id + '/undo', { revision: 0 })).status, 409, 'oude revisie');
    r = await api('POST', API + '/games/' + id + '/undo', { revision: 1 });
    assert.equal(r.status, 200);
    assert.equal(r.body.revision, 0);
    assert.equal(r.body.matches[0].winner, null);
    assert.equal((await api('POST', API + '/games/' + id + '/undo', {})).status, 409, 'niets om terug te nemen');
    // 21 punten
    const c21 = await api('POST', API + '/games', { players: ['W1', 'W2', 'W3'], settings: { bestOf: 1, pointsPerGame: 21 } });
    assert.equal((await result(c21.body.id, c21.body.matches[0].id, [[11, 3]])).status, 400, 'tot 21');
    assert.equal((await result(c21.body.id, c21.body.matches[0].id, [[21, 19]])).status, 200);
    assert.equal((await result(c21.body.id, c21.body.matches[1].id, [[22, 20]])).status, 200);
    await api('POST', API + '/games/' + c21.body.id + '/abandon', {});
    await api('POST', API + '/games/' + id + '/abandon', {});
    console.log('OK validatie van games (deuce, best-of), 409-guards, undo met revisie');
  }

  // --- aanmaken: spelers en instellingen ---
  {
    const mk = (players, settings) => api('POST', API + '/games', { players, settings });
    assert.equal((await mk(['a', 'b'])).status, 400, 'te weinig spelers');
    assert.equal((await mk(['a', '', 'c'])).status, 400, 'lege naam');
    assert.equal((await mk(['An', 'an', 'C'])).status, 400, 'dubbele naam');
    assert.equal((await mk(Array.from({ length: 17 }, (_, i) => 'S' + i))).status, 400, 'te veel spelers');
    assert.equal((await mk(['a', 'b', 'c'], { format: 'dubbel' })).status, 400, 'onbekende vorm');
    assert.equal((await mk(['a', 'b', 'c'], { bestOf: 4 })).status, 400, 'best of 4');
    assert.equal((await mk(['a', 'b', 'c'], { pointsPerGame: 15 })).status, 400, 'tot 15');
    assert.equal((await mk(['a', 'b', 'c'], { tables: 0 })).status, 400, 'nul tafels');
    assert.equal((await mk(['a', 'b', 'c'], { detail: 'sets' })).status, 400, 'onbekende invoer');
    assert.equal((await mk(['a', 'b', 'c'], { format: 'poule-ko', koSize: 4 })).status, 400, 'eindronde groter dan de poule');
    assert.equal((await mk(['a', 'b', 'c'], { format: 'poule-ko', koSize: 3 })).status, 400, 'eindronde met 3');
    const ok = await mk(['a', 'b', 'c'], {});
    assert.equal(ok.status, 201);
    assert.deepEqual(ok.body.settings, { format: 'poule', bestOf: 3, pointsPerGame: 11, tables: 1, detail: 'points', koSize: 0, bronze: false }, 'defaults');
    await api('POST', API + '/games/' + ok.body.id + '/abandon', {});
    const defKo = await mk(['a', 'b', 'c', 'd', 'e'], { format: 'poule-ko' });
    assert.equal(defKo.body.settings.koSize, 4, 'standaard eindronde met 4');
    assert.equal(defKo.body.settings.bronze, true, 'standaard met troostfinale');
    await api('POST', API + '/games/' + defKo.body.id + '/abandon', {});
    console.log('OK validatie bij aanmaken');
  }

  // --- poule + eindronde: seeding, schema, eindstand, undo over de fasegrens ---
  {
    const c = await api('POST', API + '/games', {
      players: ['A', 'B', 'C', 'D', 'E', 'F'],
      settings: { format: 'poule-ko', koSize: 4, bronze: true, bestOf: 3, tables: 3 },
    });
    let game = c.body;
    assert.equal(game.progress.total, 15 + 4, 'poule + eindronde meegeteld');
    // Lagere index wint altijd: stand A, B, C, D, E, F.
    const out = await playOut(game, m => (m.players[0] < m.players[1] ? 0 : 1), 11, 2, 'poule');
    game = out.game;
    assert.equal(game.status, 'active', 'na de poule gaat het door');
    assert.equal(game.phase, 'ko');
    assert.deepEqual(game.standings.map(r => r.name), ['A', 'B', 'C', 'D', 'E', 'F']);
    const ko = game.matches.filter(m => m.stage === 'ko');
    assert.deepEqual(ko.map(m => m.label), ['Halve finale 1', 'Halve finale 2', 'Troostfinale', 'Finale']);
    assert.deepEqual(ko[0].slots.map(s => s.name), ['A', 'D'], 'seeding 1–4');
    assert.deepEqual(ko[1].slots.map(s => s.name), ['B', 'C'], 'seeding 2–3');
    assert.deepEqual(ko[3].slots.map(s => s.pending), ['Winnaar Halve finale 1', 'Winnaar Halve finale 2']);
    assert.deepEqual(ko[2].slots.map(s => s.pending), ['Verliezer Halve finale 1', 'Verliezer Halve finale 2']);
    assert.deepEqual(game.upNow, [ko[0].id, ko[1].id], 'beide halve finales tegelijk (3 tafels)');
    assert.equal(game.koRounds.length, 2);
    assert.equal((await result(game.id, ko[3].id, [[11, 1], [11, 1]])).status, 409, 'finale nog niet speelbaar');

    // Halve finales: D verslaat A (verrassing), B verslaat C.
    game = (await result(game.id, ko[0].id, [[1, 11], [1, 11]])).body;
    game = (await result(game.id, ko[1].id, [[11, 1], [11, 1]])).body;
    const fin = game.matches.find(m => m.id === ko[3].id);
    assert.deepEqual(fin.slots.map(s => s.name), ['D', 'B'], 'finale gevuld');
    assert.deepEqual(game.matches.find(m => m.id === ko[2].id).slots.map(s => s.name), ['A', 'C'], 'troostfinale gevuld');
    assert.deepEqual(game.upNow, [ko[2].id, ko[3].id], 'troostfinale vóór de finale in de volgorde');
    game = (await result(game.id, ko[2].id, [[11, 1], [11, 1]])).body;   // A wint brons
    game = (await result(game.id, ko[3].id, [[11, 1], [1, 11], [11, 9]])).body; // D wint
    assert.equal(game.status, 'finished');
    assert.deepEqual(game.ranking.map(r => [r.name, r.rank]),
      [['D', 1], ['B', 2], ['A', 3], ['C', 4], ['E', 5], ['F', 6]]);

    // undo: finale terug → weer actief; vier keer terug → eindronde leeg;
    // nog een keer → poule weer open en de eindronde is weg.
    let r = await api('POST', API + '/games/' + game.id + '/undo', { revision: game.revision });
    assert.equal(r.body.status, 'active');
    assert.equal(r.body.ranking, null);
    assert.equal(r.body.matches.find(m => m.id === ko[3].id).winner, null);
    for (let i = 0; i < 3; i++) r = await api('POST', API + '/games/' + game.id + '/undo', {});
    assert.equal(r.body.phase, 'ko');
    assert.ok(r.body.matches.filter(m => m.stage === 'ko').every(m => m.winner === null));
    assert.deepEqual(r.body.matches.find(m => m.id === ko[3].id).slots.map(s => s.name), [null, null], 'finale weer leeg');
    r = await api('POST', API + '/games/' + game.id + '/undo', {});
    assert.equal(r.body.phase, 'poule', 'poule weer open');
    assert.ok(!r.body.matches.some(m => m.stage === 'ko'), 'eindronde verwijderd');
    assert.equal(r.body.matches.filter(m => m.playable).length, 1);
    // laatste poulewedstrijd opnieuw, nu wint de ander → mogelijk andere seeding, maar altijd 4 nieuwe KO-wedstrijden
    const open = r.body.matches.find(m => m.playable);
    r = await result(game.id, open.id, [[1, 11], [1, 11]]);
    assert.equal(r.body.phase, 'ko');
    assert.equal(r.body.matches.filter(m => m.stage === 'ko').length, 4);
    await api('POST', API + '/games/' + game.id + '/abandon', {});
    console.log('OK poule + eindronde: seeding, doorschuiven, eindstand, undo over de fasegrens');
  }

  // --- eindronde met 2 (alleen finale) en zonder troostfinale ---
  {
    const c = await api('POST', API + '/games', {
      players: ['A', 'B', 'C', 'D'], settings: { format: 'poule-ko', koSize: 4, bronze: false, bestOf: 1 },
    });
    let game = (await playOut(c.body, m => (m.players[0] < m.players[1] ? 0 : 1), 11, 1, 'poule')).game;
    const ko = game.matches.filter(m => m.stage === 'ko');
    assert.deepEqual(ko.map(m => m.label), ['Halve finale 1', 'Halve finale 2', 'Finale']);
    game = (await playOut(game, m => 0, 11, 1)).game;
    assert.equal(game.status, 'finished');
    assert.deepEqual(game.ranking.map(r => [r.name, r.rank]), [['A', 1], ['B', 2], ['C', 3], ['D', 3]], 'verliezers halve finale delen 3');
    const c2 = await api('POST', API + '/games', {
      players: ['A', 'B', 'C'], settings: { format: 'poule-ko', koSize: 2, bestOf: 1 },
    });
    let g2 = (await playOut(c2.body, m => (m.players[0] < m.players[1] ? 0 : 1), 11, 1, 'poule')).game;
    assert.deepEqual(g2.matches.filter(m => m.stage === 'ko').map(m => m.label), ['Finale']);
    assert.equal(g2.settings.bronze, false, 'geen troostfinale bij een finale alleen');
    g2 = (await playOut(g2, m => 1, 11, 1)).game;
    assert.deepEqual(g2.ranking.map(r => [r.name, r.rank]), [['B', 1], ['A', 2], ['C', 3]]);
    console.log('OK eindronde met 2 en zonder troostfinale');
  }

  // --- puur knock-out met vrije rondes (5 spelers → schema van 8) ---
  {
    const c = await api('POST', API + '/games', {
      players: ['S1', 'S2', 'S3', 'S4', 'S5'], settings: { format: 'ko', bestOf: 1 },
    });
    let game = c.body;
    assert.equal(game.phase, 'ko');
    assert.equal(game.settings.koSize, 8);
    assert.equal(game.standings, null, 'geen poulestand');
    const qf = game.matches.filter(m => m.round === 0);
    assert.deepEqual(qf.map(m => m.slots.map(s => s.name)), [['S1', null], ['S4', 'S5'], ['S2', null], ['S3', null]], 'seeding 1-8, 4-5, 2-7, 3-6');
    assert.deepEqual(qf.map(m => m.bye), [true, false, true, true], 'vrije rondes');
    assert.equal(qf[0].winnerName, 'S1', 'vrije ronde is beslist');
    assert.deepEqual(game.upNow, [qf[1].id], 'alleen de echte kwartfinale is speelbaar');
    assert.equal(game.progress.total, 5, 'byes tellen niet mee');
    const sf2 = game.matches.find(m => m.label === 'Halve finale 2');
    assert.deepEqual(sf2.slots.map(s => s.name), ['S2', 'S3'], 'halve finale al gevuld door byes');
    assert.equal((await result(game.id, qf[0].id, [[11, 0]])).status, 409, 'vrije ronde niet invoerbaar');
    game = (await playOut(game, m => 1, 11, 1)).game; // steeds de tweede kant wint
    assert.equal(game.status, 'finished');
    // QF2: S5 wint; SF1: S1–S5 → S5; SF2: S2–S3 → S3; brons: S1–S2 → S2; finale: S5–S3 → S3
    assert.deepEqual(game.ranking.map(r => [r.name, r.rank]), [['S3', 1], ['S5', 2], ['S2', 3], ['S1', 4], ['S4', 5]]);
    // undo van de finale zet de vrije rondes niet terug
    const r = await api('POST', API + '/games/' + game.id + '/undo', {});
    assert.equal(r.body.status, 'active');
    assert.equal(r.body.matches.filter(m => m.bye).length, 3);
    await api('POST', API + '/games/' + game.id + '/abandon', {});

    // 3 spelers: halve finale met bye, dus ook de troostfinale is een vrije ronde
    const c3 = await api('POST', API + '/games', { players: ['X', 'Y', 'Z'], settings: { format: 'ko', bestOf: 1 } });
    let g3 = c3.body;
    assert.equal(g3.matches.filter(m => m.playable).length, 1);
    g3 = (await playOut(g3, m => 0, 11, 1)).game;
    assert.equal(g3.status, 'finished');
    assert.ok(g3.matches.find(m => m.bronze).bye, 'troostfinale automatisch');
    assert.deepEqual(g3.ranking.map(r => [r.name, r.rank]), [['X', 1], ['Y', 2], ['Z', 3]]);
    console.log('OK knock-out met vrije rondes en automatische troostfinale');
  }

  // --- invoer met alleen games (zonder punten) ---
  {
    const c = await api('POST', API + '/games', { players: ['G1', 'G2', 'G3'], settings: { detail: 'games', bestOf: 5 } });
    const id = c.body.id, m = c.body.matches[0];
    const post = body => api('POST', API + '/games/' + id + '/result', Object.assign({ matchId: m.id }, body));
    assert.equal((await post({ games: [[11, 1], [11, 1], [11, 1]] })).status, 400, 'punten niet verwacht');
    assert.equal((await post({ gamesWon: [3, 3] })).status, 400);
    assert.equal((await post({ gamesWon: [2, 1] })).status, 400, 'nog niet uit');
    assert.equal((await post({ gamesWon: [3, -1] })).status, 400);
    const r = await post({ gamesWon: [1, 3] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.matches[0].games, null);
    assert.equal(r.body.matches[0].winner, m.players[1]);
    assert.equal(r.body.standings.find(x => x.player === m.players[1]).gamesWon, 3);
    await api('POST', API + '/games/' + id + '/abandon', {});
    console.log('OK invoer met alleen games');
  }

  // --- draft: live tussenstand op het scorebord ---
  {
    const c = await api('POST', API + '/games', { players: ['D1', 'D2', 'D3'], settings: { bestOf: 3 } });
    const id = c.body.id, m = c.body.matches[0];
    const draft = body => api('POST', API + '/games/' + id + '/draft', body);
    let r = await draft({ matchId: m.id, games: [[11, 7], [5, null]] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.draft, { matchId: m.id, games: [[11, 7], [5, null]] });
    const cur = (await api('GET', API + '/current')).body;
    assert.deepEqual(cur.game.draft.games, [[11, 7], [5, null]], 'draft zit in de snapshot');
    assert.equal(cur.game.matches[0].winner, null, 'draft telt nergens in mee');
    assert.equal((await draft({ matchId: m.id, games: [[11, 7], [5, null], [1, 1], [2, 2]] })).status, 400, 'meer dan best-of');
    assert.equal((await draft({ matchId: m.id, games: [[11, 'x']] })).status, 400);
    assert.equal((await draft({ matchId: 'nope', games: [[1, 1]] })).status, 404);
    r = await draft({ matchId: null, games: [] });
    assert.equal(r.body.draft, null, 'leeg = wissen');
    await draft({ matchId: m.id, games: [[3, 2]] });
    r = await result(id, m.id, [[11, 7], [11, 8]]);
    assert.equal(r.body.draft, null, 'uitslag wist de draft');
    assert.equal((await draft({ matchId: m.id, games: [[3, 2]] })).status, 409, 'geen draft op een gespeelde wedstrijd');
    await api('POST', API + '/games/' + id + '/abandon', {});
    console.log('OK draft (live tussenstand)');
  }

  // --- klassement over toernooien heen + filter ---
  {
    const winnerIs = name => m => (m.slots[0].name === name ? 0 : m.slots[1].name === name ? 1 : 0);
    let g = (await api('POST', API + '/games', { players: ['Eva', 'Frank', 'Gijs', 'Hanna'], settings: { bestOf: 1 } })).body;
    await playOut(g, winnerIs('Eva'), 11, 1);
    g = (await api('POST', API + '/games', { players: ['eva', 'Frank', 'Kind'], settings: { bestOf: 1 } })).body;
    await playOut(g, winnerIs('eva'), 11, 1);
    const lb = (await api('GET', API + '/leaderboard')).body;
    const eva = lb.leaderboard.find(e => e.name.toLowerCase() === 'eva');
    assert.equal(eva.tournaments, 2, 'zelfde speler ondanks andere schrijfwijze');
    assert.equal(eva.titles, 2);
    assert.equal(eva.podiums, 2);
    assert.equal(eva.matchesPlayed, 5);
    assert.equal(eva.winPct, 100);
    for (let i = 1; i < lb.leaderboard.length; i++) {
      const a = lb.leaderboard[i - 1], b = lb.leaderboard[i];
      assert.ok(a.titles > b.titles || (a.titles === b.titles && a.podiums >= b.podiums), 'gesorteerd op titels, dan podium');
    }
    const frank = lb.leaderboard.find(e => e.name === 'Frank');
    assert.equal(frank.titles, 0);
    assert.ok(lb.players.includes('Kind'));
    assert.ok(lb.suggestions.includes('Frank'), 'naamsuggesties');
    const filtered = (await api('GET', API + '/leaderboard?exclude=kind')).body;
    assert.deepEqual(filtered.excluded, ['Kind']);
    assert.equal(filtered.gamesCounted, filtered.gamesTotal - 1);
    assert.equal(filtered.leaderboard.find(e => e.name.toLowerCase() === 'eva').tournaments, 1);
    // afgebroken toernooi telt niet mee
    const ab = (await api('POST', API + '/games', { players: ['Q1', 'Q2', 'Q3'] })).body;
    await api('POST', API + '/games/' + ab.id + '/abandon', {});
    assert.ok(!(await api('GET', API + '/leaderboard')).body.players.includes('Q1'));
    console.log('OK klassement over toernooien (titels, podium, winst%), filter');
  }

  // --- snapshot + SSE ---
  {
    const c = await api('POST', API + '/games', { players: ['S1', 'S2', 'S3'], settings: { bestOf: 1 } });
    const id = c.body.id;
    let cur = (await api('GET', API + '/current')).body;
    assert.equal(cur.game.id, id, 'actief toernooi in de snapshot');
    assert.ok(Array.isArray(cur.leaderboard));
    const chunks = [];
    const req = http.get(BASE + API + '/events', res => {
      assert.equal(res.statusCode, 200);
      assert.match(res.headers['content-type'], /text\/event-stream/);
      res.setEncoding('utf8');
      res.on('data', ch => chunks.push(ch));
    });
    await new Promise(r => setTimeout(r, 300));
    await result(id, c.body.matches[0].id, [[11, 4]]);
    await new Promise(r => setTimeout(r, 300));
    req.destroy();
    const stream = chunks.join('');
    assert.ok(stream.includes('event: state'), 'state-events ontvangen');
    assert.ok(stream.includes('"revision":1'), 'uitslag gaat live naar het scorebord');
    const list = (await api('GET', API + '/games?status=active')).body.games;
    assert.ok(list.some(g => g.id === id));
    assert.deepEqual(list.find(g => g.id === id).progress, { done: 1, total: 3 });
    await api('POST', API + '/games/' + id + '/abandon', {});
    console.log('OK snapshot + SSE');
  }

  // --- gescheiden van de andere spellen ---
  {
    const kj = await api('POST', '/api/klaverjas/games', { players: ['K1', 'K2', 'K3', 'K4'] });
    assert.equal(kj.status, 201);
    const ttList = (await api('GET', API + '/games')).body.games;
    assert.ok(!ttList.some(g => g.id === kj.body.id), 'klaverjaspotje niet bij tafeltennis');
    assert.ok(fs.existsSync(path.join(DATA_DIR, 'tafeltennis.json')), 'eigen databestand');
    assert.ok(!(await api('GET', API + '/leaderboard')).body.players.includes('K1'), 'apart klassement');
    assert.equal((await fetch(BASE + '/games/tafeltennis/')).status, 200, 'invoerpagina');
    assert.equal((await fetch(BASE + '/games/tafeltennis/display/')).status, 200, 'scorebord');
    assert.equal((await fetch(BASE + '/data/tafeltennis.json')).status, 404, 'data geblokkeerd');
    await api('POST', '/api/klaverjas/games/' + kj.body.id + '/abandon', {});
    console.log('OK gescheiden opslag naast de kaartspellen');
  }

  // --- persistentie over een herstart, inclusief de eindronde ---
  {
    const c = await api('POST', API + '/games', {
      players: ['H1', 'H2', 'H3', 'H4'], settings: { format: 'poule-ko', koSize: 2, bestOf: 1 },
    });
    let game = (await playOut(c.body, m => (m.players[0] < m.players[1] ? 0 : 1), 11, 1, 'poule')).game;
    assert.equal(game.phase, 'ko');
    const before = (await api('GET', API + '/games')).body.games.length;
    await stopServer();
    await startServer();
    const after = (await api('GET', API + '/games')).body;
    assert.equal(after.games.length, before, 'toernooien overleven herstart');
    const resumed = (await api('GET', API + '/games/' + game.id)).body;
    assert.equal(resumed.phase, 'ko', 'eindronde overleeft de herstart');
    assert.equal(resumed.revision, 6);
    assert.deepEqual(resumed.matches.find(m => m.stage === 'ko').slots.map(s => s.name), ['H1', 'H2']);
    console.log('OK persistentie over herstart');
  }

  console.log('\nAlle tafeltennis-tests geslaagd ✔');
}

main()
  .then(() => stopServer())
  .catch(async err => {
    console.error(err);
    await stopServer();
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));
