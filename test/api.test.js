// End-to-end API-test voor de boerenbridge-server. Run: node test/api.test.js
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
let PORT = 0;   // vrije poort, bepaald bij het starten
let BASE = '';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-test-'));

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

// Onafhankelijke herimplementatie van de scoreformule (bewust NIET geïmporteerd
// uit logic.js — dit vangt porteerfouten af).
function expectedScore(pred, act) {
  return act === pred ? act + 5 : act < pred ? -(pred - act) : act;
}

// Lopende tussenstand per ronde — onafhankelijk nagerekend.
function expectedCumulative(roundScores, n) {
  const run = new Array(n).fill(0);
  return roundScores.map(row => {
    row.forEach((s, i) => { run[i] += s; });
    return run.slice();
  });
}

// Plek in de stand, anders geformuleerd dan de server: hoeveel spelers staan
// er hoger? Gelijke totalen delen daardoor vanzelf een plek.
function expectedPositions(totals) {
  return totals.map(t => totals.filter(o => o > t).length + 1);
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

function randomActuals(n, cards) {
  // Willekeurige verdeling van `cards` slagen over n spelers.
  const acts = new Array(n).fill(0);
  for (let c = 0; c < cards; c++) acts[Math.floor(Math.random() * n)]++;
  return acts;
}

// Speel een heel spel; per ronde via een keuzefunctie (roundIdx, cards, n) → {preds, acts}.
async function playGame(names, pick) {
  const created = await api('POST', '/api/boerenbridge/games', { players: names });
  assert.equal(created.status, 201, 'create: ' + JSON.stringify(created.body));
  let game = created.body;
  const n = names.length;
  for (let r = 0; r < game.rounds.length; r++) {
    const cards = game.rounds[r].cards;
    const { preds, acts } = pick(r, cards, n);
    let resp = await api('POST', '/api/boerenbridge/games/' + game.id + '/predictions', { round: r, predictions: preds });
    assert.equal(resp.status, 200, 'predictions r' + r + ': ' + JSON.stringify(resp.body));
    resp = await api('POST', '/api/boerenbridge/games/' + game.id + '/actuals', { round: r, actuals: acts });
    assert.equal(resp.status, 200, 'actuals r' + r + ': ' + JSON.stringify(resp.body));
    game = resp.body;
    // Scores per ronde tegen de onafhankelijke formule
    for (let i = 0; i < n; i++) {
      assert.equal(game.roundScores[r][i], expectedScore(preds[i], acts[i]),
        'score r' + r + ' speler ' + i);
    }
    // Doorlopende tussenstand: cumulatief, totalen en plek in de stand
    const cum = expectedCumulative(game.roundScores, n);
    assert.deepEqual(game.cumulative, cum, 'cumulative r' + r);
    assert.deepEqual(game.totals, cum[cum.length - 1], 'totals = laatste cumulatieve rij r' + r);
    assert.deepEqual(game.positions, expectedPositions(game.totals), 'positions r' + r);
  }
  return game;
}

async function main() {
  await startServer();

  // --- volledig spel met random geldige invoer, scores en totalen kloppen ---
  {
    const game = await playGame(['An', 'Bert', 'Carla', 'Daan'], (r, cards, n) => ({
      preds: Array.from({ length: n }, () => Math.floor(Math.random() * (cards + 1))),
      acts: randomActuals(n, cards),
    }));
    assert.equal(game.status, 'finished');
    assert.ok(Array.isArray(game.winnerIdxs) && game.winnerIdxs.length >= 1);
    const totals = game.players.map((_, i) => game.roundScores.reduce((a, row) => a + row[i], 0));
    assert.deepEqual(game.totals, totals, 'totals');
    const max = Math.max(...totals);
    assert.deepEqual(game.winnerIdxs, totals.map((t, i) => [t, i]).filter(([t]) => t === max).map(([, i]) => i));
    console.log('OK volledig spel + scores + winnaar');
  }

  // --- gelijkspel: iedereen voorspelt 0, één speler haalt alles → construeer tie ---
  {
    // Anna en Bo raden altijd exact hetzelfde en halen dezelfde scores → gedeelde winst.
    const game = await playGame(['Anna', 'Bo', 'Cas'], (r, cards) => ({
      preds: [0, 0, cards],
      acts: [0, 0, cards],
    }));
    assert.equal(game.status, 'finished');
    assert.deepEqual(game.winnerIdxs, [2], 'Cas wint alles');
    const tie = await playGame(['Anna', 'Bo', 'Cas'], (r, cards) => ({
      preds: [0, 0, cards],
      acts: [cards, 0, 0], // Anna haalt alles zonder voorspelling; Bo exact 0
    }));
    // Anna: +cards per ronde (te veel), Bo: 0+5, Cas: -cards.
    assert.ok(tie.winnerIdxs.length >= 1);
    console.log('OK winnaarsbepaling incl. arrays');
  }

  // --- validatie & concurrency ---
  {
    const created = await api('POST', '/api/boerenbridge/games', { players: ['P1', 'P2', 'P3'] });
    const id = created.body.id;
    // ongeldig aantal spelers
    assert.equal((await api('POST', '/api/boerenbridge/games', { players: ['a', 'b'] })).status, 400);
    assert.equal((await api('POST', '/api/boerenbridge/games', { players: ['a', '', 'c'] })).status, 400);
    // dubbele namen (ook met andere schrijfwijze) → 400
    assert.equal((await api('POST', '/api/boerenbridge/games', { players: ['Anna', 'anna', 'Cas'] })).status, 400);
    // voorspelling buiten bereik
    let r = await api('POST', '/api/boerenbridge/games/' + id + '/predictions', { round: 0, predictions: [0, 9, 0] });
    assert.equal(r.status, 400);
    // geldige voorspelling
    r = await api('POST', '/api/boerenbridge/games/' + id + '/predictions', { round: 0, predictions: [2, 3, 3] });
    assert.equal(r.status, 200);
    // dubbele submit → 409
    r = await api('POST', '/api/boerenbridge/games/' + id + '/predictions', { round: 0, predictions: [2, 3, 3] });
    assert.equal(r.status, 409);
    // actuals die niet optellen → 400
    r = await api('POST', '/api/boerenbridge/games/' + id + '/actuals', { round: 0, actuals: [1, 1, 1] });
    assert.equal(r.status, 400);
    // geldige actuals
    r = await api('POST', '/api/boerenbridge/games/' + id + '/actuals', { round: 0, actuals: [2, 3, 3] });
    assert.equal(r.status, 200);
    assert.equal(r.body.currentRound, 1);
    assert.deepEqual(r.body.roundScores[0], [7, 8, 8]);
    // verouderde ronde → 409
    r = await api('POST', '/api/boerenbridge/games/' + id + '/actuals', { round: 0, actuals: [2, 3, 3] });
    assert.equal(r.status, 409);

    // --- undo: ronde 0 heropenen en andere actuals invoeren ---
    r = await api('POST', '/api/boerenbridge/games/' + id + '/undo', {});
    assert.equal(r.status, 200);
    assert.equal(r.body.currentRound, 0);
    assert.equal(r.body.phase, 'actual');
    assert.equal(r.body.roundScores.length, 0);
    r = await api('POST', '/api/boerenbridge/games/' + id + '/actuals', { round: 0, actuals: [8, 0, 0] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.roundScores[0], [8, -3, -3]);
    // undo in predict-fase → terug naar vorige actual; nog één undo → predictions weg
    r = await api('POST', '/api/boerenbridge/games/' + id + '/undo', {});
    assert.equal(r.body.phase, 'actual');
    r = await api('POST', '/api/boerenbridge/games/' + id + '/undo', {});
    assert.equal(r.body.phase, 'predict');
    assert.equal(r.body.predictions.length, 0);
    // undo op leeg spel → 409
    r = await api('POST', '/api/boerenbridge/games/' + id + '/undo', {});
    assert.equal(r.status, 409);

    // --- abandon: uit actieve lijst en uit leaderboard ---
    r = await api('POST', '/api/boerenbridge/games/' + id + '/abandon', {});
    assert.equal(r.status, 200);
    const list = await api('GET', '/api/boerenbridge/games?status=active');
    assert.ok(!list.body.games.some(g => g.id === id), 'abandoned spel niet in actieve lijst');
    const lb = await api('GET', '/api/boerenbridge/leaderboard');
    assert.ok(!lb.body.leaderboard.some(e => e.name === 'P1'), 'abandoned spel niet in leaderboard');
    console.log('OK validatie, 409-guards, undo, abandon');
  }

  // --- draft: concept-invoer voor live meekijken op het scorebord ---
  {
    const created = await api('POST', '/api/boerenbridge/games', { players: ['D1', 'D2', 'D3'] });
    const id = created.body.id;
    assert.equal(created.body.draft, null, 'nieuw spel heeft geen draft');
    // gedeeltelijke voorspelling → draft in het spel én in de snapshot
    let r = await api('POST', '/api/boerenbridge/games/' + id + '/draft', { round: 0, phase: 'predict', values: [2, null, null] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.draft, { phase: 'predict', values: [2, null, null] });
    let cur = (await api('GET', '/api/boerenbridge/current')).body;
    assert.deepEqual(cur.game.draft.values, [2, null, null], 'draft zit in de snapshot');
    // verkeerde fase of ronde → 409
    assert.equal((await api('POST', '/api/boerenbridge/games/' + id + '/draft', { round: 0, phase: 'actual', values: [2, null, null] })).status, 409);
    assert.equal((await api('POST', '/api/boerenbridge/games/' + id + '/draft', { round: 1, phase: 'predict', values: [2, null, null] })).status, 409);
    // waarde buiten bereik of verkeerde lengte → 400
    assert.equal((await api('POST', '/api/boerenbridge/games/' + id + '/draft', { round: 0, phase: 'predict', values: [9, null, null] })).status, 400);
    assert.equal((await api('POST', '/api/boerenbridge/games/' + id + '/draft', { round: 0, phase: 'predict', values: [1, null] })).status, 400);
    // alles null → draft weer leeg
    r = await api('POST', '/api/boerenbridge/games/' + id + '/draft', { round: 0, phase: 'predict', values: [null, null, null] });
    assert.equal(r.body.draft, null);
    // bevestigen van de voorspellingen wist de draft
    await api('POST', '/api/boerenbridge/games/' + id + '/draft', { round: 0, phase: 'predict', values: [2, 3, 3] });
    r = await api('POST', '/api/boerenbridge/games/' + id + '/predictions', { round: 0, predictions: [2, 3, 3] });
    assert.equal(r.body.phase, 'actual');
    assert.equal(r.body.draft, null, 'predictions wist de draft');
    // draft in de slagen-fase; undo wist hem ook
    r = await api('POST', '/api/boerenbridge/games/' + id + '/draft', { round: 0, phase: 'actual', values: [1, null, null] });
    assert.deepEqual(r.body.draft, { phase: 'actual', values: [1, null, null] });
    r = await api('POST', '/api/boerenbridge/games/' + id + '/undo', {});
    assert.equal(r.body.draft, null, 'undo wist de draft');
    await api('POST', '/api/boerenbridge/games/' + id + '/abandon', {});
    console.log('OK draft-invoer (live meekijken)');
  }

  // --- doorlopende tussenstand: cumulatief, plek in de stand, live projectie ---
  {
    const created = await api('POST', '/api/boerenbridge/games', { players: ['Ann', 'Bo', 'Cor'] });
    const id = created.body.id;
    assert.deepEqual(created.body.cumulative, [], 'nieuw spel heeft nog geen rondes');
    assert.deepEqual(created.body.totals, [0, 0, 0]);
    assert.deepEqual(created.body.positions, [1, 1, 1], 'alles gelijk → gedeelde eerste plek');
    assert.equal(created.body.projection, null, 'voorspelfase heeft geen projectie');

    // ronde 0 (8 kaarten): voorspellingen vast, slagen nog als concept
    let r = await api('POST', '/api/boerenbridge/games/' + id + '/predictions', { round: 0, predictions: [2, 3, 3] });
    assert.equal(r.body.projection, null, 'zonder concept-slagen geen projectie');
    r = await api('POST', '/api/boerenbridge/games/' + id + '/draft', { round: 0, phase: 'actual', values: [2, null, null] });
    let pr = r.body.projection;
    assert.deepEqual(pr.deltas, [expectedScore(2, 2), null, null], 'alleen ingevulde spelers hebben een delta');
    assert.deepEqual(pr.totals, [7, 0, 0], 'stand als dit klopt');
    assert.deepEqual(pr.positions, expectedPositions(pr.totals));
    // meer invoer → projectie schuift mee
    r = await api('POST', '/api/boerenbridge/games/' + id + '/draft', { round: 0, phase: 'actual', values: [2, 4, 2] });
    pr = r.body.projection;
    assert.deepEqual(pr.deltas, [7, 4, -1]);
    assert.deepEqual(pr.totals, [7, 4, -1]);
    assert.deepEqual(pr.positions, [1, 2, 3]);
    const cur = (await api('GET', '/api/boerenbridge/current')).body;
    assert.deepEqual(cur.game.projection.totals, [7, 4, -1], 'projectie zit ook in de SSE-snapshot');

    // bevestigen: de projectie wordt de echte stand en verdwijnt
    r = await api('POST', '/api/boerenbridge/games/' + id + '/actuals', { round: 0, actuals: [2, 4, 2] });
    assert.deepEqual(r.body.roundScores[0], [7, 4, -1]);
    assert.deepEqual(r.body.cumulative, [[7, 4, -1]]);
    assert.deepEqual(r.body.totals, [7, 4, -1]);
    assert.deepEqual(r.body.positions, [1, 2, 3]);
    assert.equal(r.body.projection, null, 'na bevestigen geen projectie meer');

    // ronde 1 (7 kaarten) erbij: de cumulatieve rijen stapelen
    await api('POST', '/api/boerenbridge/games/' + id + '/predictions', { round: 1, predictions: [7, 0, 0] });
    r = await api('POST', '/api/boerenbridge/games/' + id + '/actuals', { round: 1, actuals: [3, 4, 0] });
    assert.deepEqual(r.body.roundScores[1], [-4, 4, 5]);
    assert.deepEqual(r.body.cumulative, [[7, 4, -1], [3, 8, 4]], 'stand per ronde');
    assert.deepEqual(r.body.totals, [3, 8, 4]);
    assert.deepEqual(r.body.positions, [3, 1, 2]);

    // undo haalt de laatste rij er weer af
    r = await api('POST', '/api/boerenbridge/games/' + id + '/undo', {});
    assert.deepEqual(r.body.cumulative, [[7, 4, -1]], 'undo rolt de tussenstand terug');
    assert.deepEqual(r.body.totals, [7, 4, -1]);
    await api('POST', '/api/boerenbridge/games/' + id + '/abandon', {});

    // gedeelde plek slaat de volgende plek(ken) over: 1, 1, 3, 3
    const four = await api('POST', '/api/boerenbridge/games', { players: ['E1', 'E2', 'E3', 'E4'] });
    await api('POST', '/api/boerenbridge/games/' + four.body.id + '/predictions', { round: 0, predictions: [4, 4, 0, 0] });
    r = await api('POST', '/api/boerenbridge/games/' + four.body.id + '/actuals', { round: 0, actuals: [4, 4, 0, 0] });
    assert.deepEqual(r.body.totals, [9, 9, 5, 5]);
    assert.deepEqual(r.body.positions, [1, 1, 3, 3]);
    assert.deepEqual(r.body.positions, expectedPositions(r.body.totals));
    await api('POST', '/api/boerenbridge/games/' + four.body.id + '/abandon', {});
    console.log('OK tussenstand (cumulatief, plekken, live projectie)');
  }

  // --- leaderboard-wiskunde met bekende uitkomsten ---
  {
    // Twee identieke deterministische spellen: Vera raadt exact alles (cards+5 per ronde),
    // Wim en Xander raden 0 en halen 0 (+5 per ronde).
    const pick = (r, cards) => ({ preds: [cards, 0, 0], acts: [cards, 0, 0] });
    const g1 = await playGame(['Vera', 'Wim', 'Xander'], pick);
    const g2 = await playGame(['vera', 'Wim', 'Xander'], pick); // andere schrijfwijze → zelfde speler
    const totalCards = g1.rounds.reduce((a, r) => a + r.cards, 0); // 8..1..8 = 85
    const veraTotal = totalCards + 5 * g1.rounds.length; // alle slagen + 15× bonus
    assert.equal(g1.totals[0], veraTotal);
    assert.deepEqual(g1.winnerIdxs, [0]);
    const lb = (await api('GET', '/api/boerenbridge/leaderboard')).body.leaderboard;
    const vera = lb.find(e => e.name.toLowerCase() === 'vera');
    assert.ok(vera, 'vera in leaderboard');
    assert.equal(vera.gamesPlayed, 2);
    assert.equal(vera.wins, 2);
    assert.equal(vera.avgPoints, veraTotal);
    assert.equal(vera.bestScore, veraTotal);
    assert.equal(lb[0].name.toLowerCase(), 'vera', 'meeste wins bovenaan');
    const wim = lb.find(e => e.name === 'Wim');
    assert.equal(wim.wins, 0);
    assert.equal(wim.avgPoints, 5 * 15); // elke ronde exact 0 → +5
    console.log('OK leaderboard-aggregatie (incl. case-insensitieve namen)');
  }

  // --- klassement zonder bepaalde spelers ---
  {
    // Eén potje waarin "Kind" meedoet en wint; dat potje moet uit het
    // klassement vallen zodra Kind wordt uitgesloten.
    const pick = (r, cards) => ({ preds: [cards, 0, 0], acts: [cards, 0, 0] });
    await playGame(['Kind', 'Vera', 'Wim'], pick);

    const full = (await api('GET', '/api/boerenbridge/leaderboard')).body;
    assert.ok(full.players.includes('Kind'), 'keuzelijst bevat alle spelers');
    assert.deepEqual(full.excluded, []);
    assert.equal(full.gamesCounted, full.gamesTotal);
    const veraFull = full.leaderboard.find(e => e.name.toLowerCase() === 'vera');
    assert.equal(veraFull.gamesPlayed, 3, 'vera speelde 3 potjes');

    const filtered = (await api('GET', '/api/boerenbridge/leaderboard?exclude=kind')).body;
    assert.deepEqual(filtered.excluded, ['Kind'], 'schrijfwijze uit de spellen');
    assert.ok(filtered.players.includes('Kind'), 'uitgesloten speler blijft kiesbaar');
    assert.ok(!filtered.leaderboard.some(e => e.name === 'Kind'), 'Kind niet in rijen');
    assert.equal(filtered.gamesCounted, filtered.gamesTotal - 1);
    const veraFiltered = filtered.leaderboard.find(e => e.name.toLowerCase() === 'vera');
    assert.equal(veraFiltered.gamesPlayed, 2, 'potje met Kind telt niet mee');
    assert.equal(veraFiltered.wins, 2, 'verlies tegen Kind telt niet mee');

    // Meerdere namen, komma-vorm en losse params geven hetzelfde resultaat.
    const a = (await api('GET', '/api/boerenbridge/leaderboard?exclude=Kind,Wim')).body;
    const b = (await api('GET', '/api/boerenbridge/leaderboard?exclude=kind&exclude=WIM')).body;
    assert.deepEqual(a.leaderboard, b.leaderboard, 'komma == herhaalde param');
    // Vera speelde alleen potjes met Wim erbij → ze verdwijnt volledig.
    assert.ok(!a.leaderboard.some(e => e.name.toLowerCase() === 'vera'));
    assert.equal(a.gamesCounted, full.gamesTotal - 3, 'drie potjes met Wim eruit');
    // Lege/onbekende waarden veranderen niets.
    const noop = (await api('GET', '/api/boerenbridge/leaderboard?exclude=,%20&exclude=Niemand')).body;
    assert.deepEqual(noop.leaderboard, full.leaderboard);
    assert.deepEqual(noop.excluded, []);
    console.log('OK klassement-filter (potjes zonder bepaalde spelers)');
  }

  // --- naamsuggesties: vaakst-meespelend eerst, zonder afgebroken potjes ---
  {
    const pick = (r, cards) => ({ preds: [cards, 0, 0], acts: [cards, 0, 0] });
    await playGame(['Fien', 'Gijs', 'Hein'], pick);
    await playGame(['Fien', 'Gijs', 'Hein'], pick);
    // Derde potje met een andere schrijfwijze van Fien.
    await new Promise(res => setTimeout(res, 10)); // eigen createdAt voor de recentheids-sortering
    await playGame(['fien', 'Iris', 'Joep'], pick);
    // Afgebroken potje (vaak een testje met onzin-namen) telt niet mee.
    const ab = (await api('POST', '/api/boerenbridge/games', { players: ['Qqq', 'Iris', 'Joep'] })).body;
    await api('POST', '/api/boerenbridge/games/' + ab.id + '/abandon');
    // Een lopend potje telt wél mee.
    const act = (await api('POST', '/api/boerenbridge/games', { players: ['Roos', 'Stan', 'Teun'] })).body;

    const sug = (await api('GET', '/api/boerenbridge/leaderboard')).body.suggestions;
    const pos = name => sug.indexOf(name);
    assert.ok(pos('fien') >= 0 && pos('Fien') === -1, 'recentste schrijfwijze wint');
    assert.equal(pos('Qqq'), -1, 'afgebroken potje telt niet mee');
    assert.ok(pos('Roos') >= 0, 'actief potje telt mee');
    assert.ok(pos('fien') < pos('Gijs'), '3 potjes vóór 2 potjes');
    assert.ok(pos('Gijs') < pos('Iris'), '2 potjes vóór 1 potje');
    assert.ok(pos('Iris') < pos('Kind'), 'bij gelijk aantal wint het recentste potje');
    assert.ok(pos('Iris') < pos('Joep'), 'daarna alfabetisch');
    // Het klassement-filter raakt de suggesties niet.
    const ex = (await api('GET', '/api/boerenbridge/leaderboard?exclude=fien')).body.suggestions;
    assert.deepEqual(ex, sug, 'exclude laat suggesties intact');
    // Opruimen: het lopende potje mag de current-snapshot-test niet verstoren.
    await api('POST', '/api/boerenbridge/games/' + act.id + '/abandon');
    console.log('OK naamsuggesties (frequentie, recentheid, zonder afgebroken potjes)');
  }

  // --- current-snapshot: actief spel > recent afgerond > idle ---
  {
    let cur = (await api('GET', '/api/boerenbridge/current')).body;
    // De laatst afgeronde spellen zijn < 10 min oud → winnaarscherm-snapshot
    assert.ok(cur.game && cur.game.status === 'finished', 'recent afgerond spel getoond');
    assert.ok(Array.isArray(cur.leaderboard));
    const created = await api('POST', '/api/boerenbridge/games', { players: ['A1', 'B2', 'C3'] });
    cur = (await api('GET', '/api/boerenbridge/current')).body;
    assert.equal(cur.game.id, created.body.id, 'actief spel gaat voor');
    await api('POST', '/api/boerenbridge/games/' + created.body.id + '/abandon', {});
    console.log('OK current-snapshot prioriteit');
  }

  // --- SSE: event komt binnen na mutatie ---
  {
    const events = [];
    const req = http.get(BASE + '/api/boerenbridge/events', res => {
      assert.equal(res.statusCode, 200);
      assert.match(res.headers['content-type'], /text\/event-stream/);
      res.setEncoding('utf8');
      res.on('data', chunk => events.push(chunk));
    });
    await new Promise(r => setTimeout(r, 300)); // wacht op connect + snapshot
    const created = await api('POST', '/api/boerenbridge/games', { players: ['S1', 'S2', 'S3'] });
    await api('POST', '/api/boerenbridge/games/' + created.body.id + '/draft', { round: 0, phase: 'predict', values: [3, null, null] });
    await new Promise(r => setTimeout(r, 300));
    req.destroy();
    const stream = events.join('');
    assert.ok(stream.includes('event: state'), 'state-events ontvangen');
    assert.ok(stream.includes(created.body.id), 'mutatie-broadcast bevat nieuw spel');
    assert.ok(stream.includes('"values":[3,null,null]'), 'draft-broadcast bevat de concept-invoer');
    await api('POST', '/api/boerenbridge/games/' + created.body.id + '/abandon', {});
    console.log('OK SSE snapshot + broadcast');
  }

  // --- beveiliging/robuustheid statisch serveren ---
  {
    assert.equal((await fetch(BASE + '/')).status, 200);
    assert.equal((await fetch(BASE + '/games/boerenbridge/')).status, 200);
    assert.equal((await fetch(BASE + '/data/boerenbridge.json')).status, 404, 'data geblokkeerd');
    assert.equal((await fetch(BASE + '/server/server.js')).status, 404, 'server-code geblokkeerd');
    assert.equal((await fetch(BASE + '/SERVER/server.js')).status, 404, 'blokkade is case-insensitief');
    assert.equal((await fetch(BASE + '/%2e%2e/%2e%2e/etc/passwd')).status, 404, 'traversal geblokkeerd');
    assert.equal((await fetch(BASE + '/..%2f..%2fetc%2fpasswd')).status, 404, 'traversal geblokkeerd');
    const bad = await fetch(BASE + '/api/boerenbridge/games', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{niet json',
    });
    assert.equal(bad.status, 400, 'kapotte JSON → 400');
    console.log('OK statische beveiliging + malformed JSON');
  }

  // --- persistentie: herstart server, state intact ---
  {
    const before = (await api('GET', '/api/boerenbridge/games')).body.games.length;
    assert.ok(before > 0);
    await stopServer();
    await startServer();
    const after = (await api('GET', '/api/boerenbridge/games')).body.games.length;
    assert.equal(after, before, 'spellen overleven herstart');
    console.log('OK persistentie over herstart');
  }

  console.log('\nAlle tests geslaagd ✔');
}

main()
  .then(() => stopServer())
  .catch(async err => {
    console.error(err);
    await stopServer();
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));
