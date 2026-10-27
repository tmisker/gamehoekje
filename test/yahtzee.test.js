// End-to-end API-test voor het yahtzee-deel van de server. Run: node test/yahtzee.test.js
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
const API = '/api/yahtzee';
let PORT = 0;
let BASE = '';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-test-'));

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

// ---- onafhankelijke herimplementatie (bewust NIET uit yahtzee.js) ----

const UPPER = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
const LOWER = ['three', 'four', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance'];
const CATS = UPPER.concat(LOWER);

// Score van een worp in een vakje, met de officiële jokerregel: vijf gelijk
// terwijl het Yahtzee-vakje al vol is telt als full house en als straat.
// `yahtzeeBox` = wat er in het Yahtzee-vakje van dat rijtje staat (of null).
function expectScore(cat, dice, yahtzeeBox) {
  const n = v => dice.filter(d => d === v).length;
  const sum = dice.reduce((a, b) => a + b, 0);
  const five = [1, 2, 3, 4, 5, 6].some(v => n(v) === 5);
  const joker = five && yahtzeeBox !== null;
  const has = run => run.every(v => dice.includes(v));
  let value;
  const face = UPPER.indexOf(cat) + 1;
  if (face) value = n(face) * face;
  else if (cat === 'three') value = [1, 2, 3, 4, 5, 6].some(v => n(v) >= 3) ? sum : 0;
  else if (cat === 'four') value = [1, 2, 3, 4, 5, 6].some(v => n(v) >= 4) ? sum : 0;
  else if (cat === 'fullHouse') {
    const groups = [1, 2, 3, 4, 5, 6].map(n).filter(Boolean).sort().join();
    value = joker || groups === '2,3' ? 25 : 0;
  } else if (cat === 'smallStraight') value = joker || [[1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]].some(has) ? 30 : 0;
  else if (cat === 'largeStraight') value = joker || [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6]].some(has) ? 40 : 0;
  else if (cat === 'yahtzee') value = five ? 50 : 0;
  else value = sum;
  return { value, bonus: five && yahtzeeBox === 50 && cat !== 'yahtzee' };
}

function emptyModel(players, columns) {
  return Array.from({ length: players }, () => Array.from({ length: columns }, () => ({
    cells: Object.fromEntries(CATS.map(c => [c, null])), bonuses: 0,
  })));
}

function colTotal(col) {
  const upper = UPPER.reduce((a, c) => a + (col.cells[c] || 0), 0);
  const lower = LOWER.reduce((a, c) => a + (col.cells[c] || 0), 0);
  return upper + (upper >= 63 ? 35 : 0) + lower + 100 * col.bonuses;
}

const modelTotals = model => model.map(cols => cols.reduce((a, col) => a + colTotal(col), 0));

function expectedTurn(model) {
  const filled = model.map(cols => cols.reduce((a, col) => a + CATS.filter(c => col.cells[c] !== null).length, 0));
  return filled.indexOf(Math.min(...filled));
}

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const post = (id, action, body) => api('POST', API + '/games/' + id + '/' + action, body || {});

async function main() {
  await startServer();

  // --- opties + aanmaken ---
  {
    const o = (await api('GET', API + '/options')).body;
    assert.equal(o.minPlayers, 1);
    assert.equal(o.maxColumns, 6);
    for (const [body, why] of [
      [{}, 'geen spelers'],
      [{ players: [] }, 'lege lijst'],
      [{ players: ['A', ' '] }, 'lege naam'],
      [{ players: ['Piet', 'piet'] }, 'dubbele naam'],
      [{ players: ['A'], columns: 0 }, '0 rijtjes'],
      [{ players: ['A'], columns: 7 }, '7 rijtjes'],
      [{ players: ['A'], columns: 1.5 }, 'geen geheel getal'],
      [{ players: ['x'.repeat(31)] }, 'naam te lang'],
      [{ players: Array.from({ length: 9 }, (_, i) => 'P' + i) }, 'te veel spelers'],
    ]) {
      assert.equal((await api('POST', API + '/games', body)).status, 400, why);
    }
    const g = (await api('POST', API + '/games', { players: [' Solo '] })).body;
    assert.deepEqual(g.players, ['Solo'], 'namen getrimd');
    assert.equal(g.columns, 1, 'standaard één rijtje');
    assert.equal(g.moves, undefined, 'zetten blijven op de server');
    assert.deepEqual(g.turn, { player: 0, number: 1, of: 13 });
    assert.equal(g.categories.length, 13);
    await post(g.id, 'abandon');
    console.log('OK opties en aanmaken');
  }

  // --- scoretabel via de stenen-preview, tegen de herimplementatie ---
  {
    const g = (await api('POST', API + '/games', { players: ['A', 'B'] })).body;
    for (const dice of [[1, 2, 3, 4, 5], [2, 3, 4, 5, 5], [3, 3, 3, 5, 5], [6, 6, 6, 6, 2], [4, 4, 4, 4, 4],
      [1, 1, 2, 2, 3], [6, 5, 4, 3, 1], [2, 2, 2, 2, 2], [1, 3, 4, 5, 6], [5, 5, 5, 1, 1]]) {
      const r = await post(g.id, 'dice', { dice, source: 'camera', revision: 0 });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(r.body.dice.values, dice);
      assert.equal(r.body.dice.source, 'camera');
      for (const cat of CATS) {
        assert.equal(r.body.preview[0][0].values[cat], expectScore(cat, dice, null).value, dice + ' ' + cat);
      }
    }
    for (const bad of [[1, 2, 3, 4], [1, 2, 3, 4, 7], [0, 1, 2, 3, 4], 'abc', [1, 2, 3, 4, 5, 6]]) {
      assert.equal((await post(g.id, 'dice', { dice: bad })).status, 400, 'ongeldige stenen ' + bad);
    }
    assert.equal((await post(g.id, 'dice', { dice: [1, 1, 1, 1, 1], source: 'magie' })).status, 400, 'onbekende bron');
    assert.equal((await post(g.id, 'dice', { dice: [1, 1, 1, 1, 1], revision: 3 })).status, 409, 'verouderde revisie');
    const cleared = (await post(g.id, 'dice', { dice: null })).body;
    assert.equal(cleared.dice, null);
    assert.equal(cleared.version, 11, 'elke geslaagde wijziging telt op, ook stenen; fouten niet');
    assert.equal(cleared.preview, null, 'geen stenen = geen preview');
    await post(g.id, 'abandon');
    console.log('OK scoretabel (preview) tegen herimplementatie');
  }

  // --- invoer per waarde: wat mag er in welk vakje ---
  {
    const g = (await api('POST', API + '/games', { players: ['A'] })).body;
    const ok = [['fours', 12], ['fullHouse', 25], ['smallStraight', 0], ['chance', 30], ['three', 5]];
    const bad = [['fours', 7], ['fours', 24], ['fullHouse', 20], ['chance', 0], ['chance', 31],
      ['three', 4], ['largeStraight', 30], ['yahtzee', 100]];
    for (const [category, value] of bad) {
      assert.equal((await post(g.id, 'score', { player: 0, column: 0, category, value })).status, 400, category + '=' + value);
    }
    assert.equal((await post(g.id, 'score', { player: 1, column: 0, category: 'chance', value: 20 })).status, 400, 'onbekende speler');
    assert.equal((await post(g.id, 'score', { player: 0, column: 1, category: 'chance', value: 20 })).status, 400, 'onbekend rijtje');
    assert.equal((await post(g.id, 'score', { player: 0, column: 0, category: 'kaas', value: 20 })).status, 400, 'onbekend vakje');
    let rev = 0;
    for (const [category, value] of ok) {
      const r = await post(g.id, 'score', { player: 0, column: 0, category, value, revision: rev });
      assert.equal(r.status, 200, category + '=' + value + ': ' + JSON.stringify(r.body));
      rev = r.body.revision;
    }
    assert.equal(rev, ok.length);
    assert.equal((await post(g.id, 'score', { player: 0, column: 0, category: 'fours', value: 8 })).status, 409, 'vakje al vol');
    assert.equal((await post(g.id, 'score', { player: 0, column: 0, category: 'twos', value: 4, revision: 2 })).status, 409, 'oude revisie');
    assert.equal((await post(g.id, 'score', { player: 0, column: 0, category: 'twos', value: 4, bonus: true })).status, 400,
      'Yahtzee-bonus zonder 50 in het Yahtzee-vakje');
    const r = (await api('GET', API + '/games/' + g.id)).body;
    assert.equal(r.totals[0], 12 + 25 + 0 + 30 + 5);
    assert.deepEqual(r.lastMove && [r.lastMove.category, r.lastMove.value, r.lastMove.categoryName], ['three', 5, 'Drie gelijk']);
    await post(g.id, 'abandon');
    assert.equal((await post(g.id, 'score', { player: 0, column: 0, category: 'twos', value: 4 })).status, 409, 'afgebroken');
    console.log('OK invoer per waarde + 409-guards');
  }

  // --- bovenste deel: bonus, "nog", op schema ---
  {
    const g = (await api('POST', API + '/games', { players: ['A'], columns: 2 })).body;
    let cur = g;
    const put = async (column, category, value) => {
      const r = await post(g.id, 'score', { player: 0, column, category, value, revision: cur.revision });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      cur = r.body;
      return cur.sheets[0][column];
    };
    // Rijtje 1: precies 63, met vier zessen en twee vijven.
    let s = await put(0, 'sixes', 24);
    assert.equal(s.par, 6, 'vier zessen = 6 voor op schema');
    assert.equal(s.bonus, null);
    assert.equal(s.upperNeeded, 39);
    s = await put(0, 'fives', 10);
    assert.equal(s.par, 1, 'twee vijven = 5 achter');
    for (const [cat, v] of [['ones', 2], ['twos', 6], ['threes', 9], ['fours', 12]]) s = await put(0, cat, v);
    assert.equal(s.upper, 63);
    assert.equal(s.bonus, 35, 'bonus bij 63');
    assert.equal(s.par, 0);
    // Rijtje 2: zodra 63 onhaalbaar is, staat de bonus op 0.
    s = await put(1, 'fours', 4);
    assert.equal(s.bonus, null, 'nog haalbaar: 4 + 5+10+15+25+30 = 89');
    s = await put(1, 'sixes', 0);
    assert.equal(s.bonus, 0, 'onhaalbaar: 4 + 5+10+15+25 = 59');
    assert.equal(s.upperNeeded, 59);
    assert.equal(cur.totals[0], 63 + 35 + 4);
    await post(g.id, 'abandon');
    console.log('OK bovenste deel: bonus en op schema');
  }

  // --- Yahtzee-bonus en jokerregel ---
  {
    const g = (await api('POST', API + '/games', { players: ['A', 'B'], columns: 2 })).body;
    let cur = g;
    const go = async body => {
      const r = await post(g.id, 'score', Object.assign({ revision: cur.revision }, body));
      assert.equal(r.status, 200, JSON.stringify(r.body));
      cur = r.body;
      return cur;
    };
    // Vijf gelijk vóór het Yahtzee-vakje vol is: geen joker.
    await post(g.id, 'dice', { dice: [3, 3, 3, 3, 3] });
    cur = (await api('GET', API + '/games/' + g.id)).body;
    assert.equal(cur.preview[0][0].values.fullHouse, 0, 'geen joker zonder vol Yahtzee-vakje');
    assert.equal(cur.dice.yahtzee, true);
    await go({ player: 0, column: 0, category: 'yahtzee', dice: [3, 3, 3, 3, 3] });
    assert.equal(cur.dice, null, 'stenen weg na het invullen');
    assert.equal(cur.sheets[0][0].yahtzeeBonusOpen, true);
    assert.equal(cur.sheets[0][1].yahtzeeBonusOpen, false, 'per rijtje');
    await go({ player: 1, column: 0, category: 'yahtzee', value: 0 });
    // Tweede Yahtzee in hetzelfde rijtje: +100 en joker.
    await post(g.id, 'dice', { dice: [5, 5, 5, 5, 5] });
    cur = (await api('GET', API + '/games/' + g.id)).body;
    assert.deepEqual([cur.preview[0][0].values.largeStraight, cur.preview[0][0].bonus], [40, true], 'joker + bonus');
    assert.deepEqual([cur.preview[0][1].values.largeStraight, cur.preview[0][1].bonus], [0, false], 'ander rijtje: geen joker');
    assert.deepEqual([cur.preview[1][0].values.fullHouse, cur.preview[1][0].bonus], [25, false], 'Yahtzee-vakje met 0: wel joker, geen bonus');
    await go({ player: 0, column: 0, category: 'largeStraight', dice: [5, 5, 5, 5, 5] });
    assert.equal(cur.sheets[0][0].yahtzeeBonuses, 1);
    assert.equal(cur.totals[0], 50 + 40 + 100);
    assert.equal(cur.lastMove.bonus, true);
    // Met de hand: bonus aanvinken mag alleen in een rijtje met 50.
    await go({ player: 1, column: 1, category: 'chance', value: 20 });
    assert.equal((await post(g.id, 'score', { revision: cur.revision, player: 0, column: 1, category: 'sixes', value: 30, bonus: true })).status, 400);
    await go({ player: 0, column: 0, category: 'sixes', value: 30, bonus: true });
    assert.equal(cur.sheets[0][0].yahtzeeBonus, 200);
    assert.equal(cur.totals[0], 50 + 40 + 30 + 200);
    // Undo van een zet uit stenen legt die stenen terug op tafel.
    await go({ player: 1, column: 0, category: 'fullHouse', dice: [2, 2, 3, 3, 3] });
    const u = await post(g.id, 'undo', { revision: cur.revision });
    assert.equal(u.status, 200);
    assert.deepEqual(u.body.dice.values, [2, 2, 3, 3, 3], 'stenen terug na undo');
    assert.equal(u.body.sheets[1][0].cells.fullHouse, null);
    assert.equal((await post(g.id, 'undo', { revision: 99 })).status, 409, 'undo met oude revisie');
    const u2 = await post(g.id, 'undo', { revision: u.body.revision });
    assert.equal(u2.body.dice, null, 'undo van een handmatige zet: geen stenen');
    assert.equal(u2.body.sheets[0][0].yahtzeeBonuses, 1, 'bonus gaat mee terug');
    await post(g.id, 'abandon');
    console.log('OK Yahtzee-bonus, jokerregel en undo');
  }

  // --- een heel potje met willekeurige worpen, tegen het model ---
  let fullGameId = null;
  {
    const rand = rng(42);
    const P = 3, C = 2;
    let cur = (await api('POST', API + '/games', { players: ['Anna', 'Bram', 'Cor'], columns: C })).body;
    fullGameId = cur.id;
    const model = emptyModel(P, C);
    let viaDice = 0, viaValue = 0;
    for (let move = 0; move < P * C * 13; move++) {
      const p = expectedTurn(model);
      assert.equal(cur.turn.player, p, 'beurt bij zet ' + move);
      assert.equal(cur.status, 'active');
      // Soms een Yahtzee, om bonus en joker te raken.
      const dice = rand() < 0.15
        ? Array(5).fill(1 + Math.floor(rand() * 6))
        : Array.from({ length: 5 }, () => 1 + Math.floor(rand() * 6));
      const open = [];
      for (let c = 0; c < C; c++) for (const cat of CATS) if (model[p][c].cells[cat] === null) open.push([c, cat]);
      const [c, cat] = open[Math.floor(rand() * open.length)];
      const exp = expectScore(cat, dice, model[p][c].cells.yahtzee);
      const body = { revision: cur.revision, player: p, column: c, category: cat };
      if (rand() < 0.5) { body.dice = dice; viaDice++; }
      else { body.value = exp.value; body.bonus = exp.bonus; viaValue++; }
      const r = await post(cur.id, 'score', body);
      assert.equal(r.status, 200, 'zet ' + move + ': ' + JSON.stringify(r.body));
      cur = r.body;
      model[p][c].cells[cat] = exp.value;
      if (exp.bonus) model[p][c].bonuses++;
      assert.deepEqual(cur.totals, modelTotals(model), 'stand na zet ' + move);
      for (let pp = 0; pp < P; pp++) for (let cc = 0; cc < C; cc++) {
        assert.equal(cur.sheets[pp][cc].total, colTotal(model[pp][cc]));
      }
    }
    assert.ok(viaDice > 20 && viaValue > 20, 'beide invoerwegen gebruikt');
    assert.equal(cur.status, 'finished', 'vol blok = afgelopen');
    assert.equal(cur.turn, null);
    const totals = modelTotals(model);
    const max = Math.max(...totals);
    assert.deepEqual(cur.winners, totals.map((t, i) => [t, i]).filter(([t]) => t === max).map(([, i]) => i));
    assert.deepEqual(cur.positions, totals.map(t => 1 + totals.filter(o => o > t).length));
    assert.ok(Array.isArray(cur.records) && cur.records.length === P * C, 'eerste potje: alle rijtjes in de highscores');
    assert.equal((await post(cur.id, 'score', { player: 0, column: 0, category: 'chance', value: 20 })).status, 409, 'na afloop');
    // Undo heropent, opnieuw invullen sluit weer af.
    const last = cur.lastMove;
    const u = (await post(cur.id, 'undo', { revision: cur.revision })).body;
    assert.equal(u.status, 'active');
    assert.equal(u.winners, null);
    assert.equal(u.records, null);
    const again = await post(cur.id, 'score', { revision: u.revision, player: last.player, column: last.column,
      category: last.category, value: last.value, bonus: last.bonus });
    assert.equal(again.body.status, 'finished');
    console.log('OK heel potje (' + P + ' spelers × ' + C + ' rijtjes) tegen het model');

    // --- klassement + highscores ---
    const lb = (await api('GET', API + '/leaderboard')).body;
    const allCols = [];
    model.forEach((cols, i) => cols.forEach(col => allCols.push({ name: ['Anna', 'Bram', 'Cor'][i], score: colTotal(col) })));
    allCols.sort((a, b) => b.score - a.score);
    assert.deepEqual(lb.highscores.map(h => h.score), allCols.map(h => h.score), 'highscores = beste rijtjes');
    assert.equal(lb.leaderboard.length, 3);
    const winnerName = ['Anna', 'Bram', 'Cor'][cur.winners[0]];
    assert.equal(lb.leaderboard.find(r => r.name === winnerName).wins, 1);
    for (const row of lb.leaderboard) {
      const i = ['Anna', 'Bram', 'Cor'].indexOf(row.name);
      assert.equal(row.columnsPlayed, C);
      assert.equal(row.bestColumn, Math.max(...model[i].map(colTotal)));
      assert.equal(row.avgColumn, Math.round(model[i].map(colTotal).reduce((a, b) => a + b, 0) / C * 10) / 10);
      const yz = model[i].reduce((a, col) => a + (col.cells.yahtzee === 50 ? 1 : 0) + col.bonuses, 0);
      assert.equal(row.yahtzees, yz, 'Yahtzees van ' + row.name);
    }
    console.log('OK klassement + highscores');
  }

  // --- solo telt niet als winst; afgebroken telt niet; exclude-filter ---
  {
    const solo = (await api('POST', API + '/games', { players: ['Anna'] })).body;
    let cur = solo;
    for (const cat of CATS) {
      const value = cat === 'chance' ? 30 : 0;
      cur = (await post(solo.id, 'score', { revision: cur.revision, player: 0, column: 0, category: cat, value })).body;
    }
    assert.equal(cur.status, 'finished');
    assert.deepEqual(cur.winners, [0]);
    const lb = (await api('GET', API + '/leaderboard')).body;
    const anna = lb.leaderboard.find(r => r.name === 'Anna');
    assert.equal(anna.gamesPlayed, 2);
    assert.equal(anna.columnsPlayed, 3);
    assert.ok(anna.wins <= 1, 'solo-potje is geen winst');
    assert.ok(lb.highscores.some(h => h.score === 30 && h.name === 'Anna') || lb.highscores.length === 10);
    const ab = (await api('POST', API + '/games', { players: ['Spook'] })).body;
    await post(ab.id, 'abandon');
    const lb2 = (await api('GET', API + '/leaderboard?exclude=bram')).body;
    assert.ok(!lb2.players.includes('Spook'), 'afgebroken potje telt niet');
    assert.deepEqual(lb2.excluded, ['Bram']);
    assert.equal(lb2.gamesCounted, 1, 'alleen het solo-potje blijft over');
    assert.ok(lb2.highscores.every(h => h.name === 'Anna'));
    assert.ok(lb2.suggestions.includes('Cor'), 'suggesties ongefilterd');
    console.log('OK solo, afgebroken en exclude-filter');
  }

  // --- snapshot + SSE ---
  {
    const c = await api('POST', API + '/games', { players: ['S1', 'S2'] });
    const id = c.body.id;
    const cur = (await api('GET', API + '/current')).body;
    assert.equal(cur.game.id, id, 'actief potje in de snapshot');
    assert.ok(Array.isArray(cur.leaderboard));
    const chunks = [];
    const req = http.get(BASE + API + '/events', res => {
      assert.equal(res.statusCode, 200);
      assert.match(res.headers['content-type'], /text\/event-stream/);
      res.setEncoding('utf8');
      res.on('data', ch => chunks.push(ch));
    });
    await new Promise(r => setTimeout(r, 300));
    await post(id, 'dice', { dice: [6, 6, 6, 2, 2], source: 'camera' });
    await new Promise(r => setTimeout(r, 300));
    await post(id, 'score', { player: 0, column: 0, category: 'fullHouse', dice: [6, 6, 6, 2, 2] });
    await new Promise(r => setTimeout(r, 300));
    req.destroy();
    const states = chunks.join('').split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)));
    assert.ok(states.some(s => s.game && s.game.dice && s.game.dice.source === 'camera'), 'worp gaat live naar de andere toestellen');
    const lastState = states[states.length - 1];
    assert.equal(lastState.game.revision, 1, 'zet gaat live naar de andere toestellen');
    assert.equal(lastState.game.sheets[0][0].cells.fullHouse, 25);
    assert.equal(lastState.game.moves, undefined, 'snapshot zonder zettenlijst');
    const list = (await api('GET', API + '/games?status=active')).body.games;
    const item = list.find(g => g.id === id);
    assert.deepEqual(item.progress, { done: 1, total: 26 });
    assert.equal(item.turn.player, 1);
    await post(id, 'abandon');
    console.log('OK snapshot + SSE');
  }

  // --- naast de andere spellen ---
  {
    assert.equal((await fetch(BASE + '/games/yahtzee/')).status, 200, 'invoerpagina');
    assert.equal((await fetch(BASE + '/data/yahtzee.json')).status, 404, 'data geblokkeerd');
    assert.ok(fs.existsSync(path.join(DATA_DIR, 'yahtzee.json')), 'eigen databestand');
    assert.equal((await api('GET', API + '/games/bestaat-niet')).status, 404);
    assert.equal((await post(fullGameId, 'kaas')).status, 404, 'onbekende actie');
    assert.ok(!(await api('GET', '/api/klaverjas/leaderboard')).body.players.includes('Anna'), 'apart klassement');
    console.log('OK gescheiden opslag naast de andere spellen');
  }

  // --- persistentie over een herstart ---
  {
    const before = (await api('GET', API + '/games/' + fullGameId)).body;
    await stopServer();
    await startServer();
    const after = (await api('GET', API + '/games/' + fullGameId)).body;
    assert.deepEqual(after.totals, before.totals, 'stand overleeft herstart');
    assert.equal(after.revision, before.revision);
    assert.equal(after.status, 'finished');
    console.log('OK persistentie over herstart');
  }

  console.log('\nAlle yahtzee-tests geslaagd ✔');
}

main()
  .then(() => stopServer())
  .catch(async err => {
    console.error(err);
    await stopServer();
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));
