// End-to-end API-test voor het klaverjas-deel van de server. Run: node test/klaverjas.test.js
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
const API = '/api/klaverjas';
let PORT = 0;
let BASE = '';
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kj-test-'));

const TOTAL = 162;
const PIT = 100;
const N_ROUNDS = 16;

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

// Onafhankelijke herimplementatie van de klaverjas-telling (bewust NIET
// geïmporteerd uit klaverjas.js — dit vangt porteerfouten af).
function expectedScores({ playingTeam, points, roem, pit, nat }) {
  const p = playingTeam, o = 1 - p;
  const out = [0, 0];
  const allRoem = roem[0] + roem[1];
  if (nat) {                       // nat verklaard zonder te tellen
    out[o] = TOTAL + allRoem;
    return out;
  }
  const mine = points + roem[p];
  const theirs = TOTAL - points + roem[o];
  if (mine > theirs) {
    out[p] = mine + (pit ? PIT : 0);
    out[o] = theirs;
  } else {
    // nat: tegenpartij krijgt alle kaartpunten en alle roem
    out[o] = TOTAL + allRoem;
  }
  return out;
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

const randomRoem = () => 10 * Math.floor(Math.random() * 6); // 0..50, veelvoud van 10

// De telling van één ronde als request-body (nat óf punten, nooit allebei).
function scoreBody(round, input) {
  const body = { round, roem: input.roem, pit: !!input.pit };
  if (input.nat) body.nat = true; else body.points = input.points;
  return body;
}

// Speel een heel potje; `pick(roundIdx)` levert de invoer van één ronde.
// Elke ronde gaat in twee stappen: eerst troef kiezen, dan tellen.
async function playGame(names, pick) {
  const created = await api('POST', API + '/games', { players: names });
  assert.equal(created.status, 201, 'create: ' + JSON.stringify(created.body));
  let game = created.body;
  assert.equal(game.phase, 'choose', 'nieuw potje begint met de troefkeuze');
  for (let r = 0; r < N_ROUNDS; r++) {
    const input = pick(r);
    let resp = await api('POST', API + '/games/' + game.id + '/start',
      { round: r, playingTeam: input.playingTeam, trump: input.trump });
    assert.equal(resp.status, 200, 'start ronde ' + r + ': ' + JSON.stringify(resp.body));
    assert.equal(resp.body.phase, 'score', 'na de troefkeuze volgt de telling');
    assert.equal(resp.body.trumpInfo.symbol, resp.body.trumps[input.trump].symbol,
      'gekozen troef staat in de snapshot');
    resp = await api('POST', API + '/games/' + game.id + '/round', scoreBody(r, input));
    assert.equal(resp.status, 200, 'ronde ' + r + ': ' + JSON.stringify(resp.body));
    game = resp.body;
    assert.deepEqual(game.rounds[r].scores, expectedScores(input), 'scores ronde ' + r);
    assert.equal(game.rounds[r].trump, input.trump, 'troef bewaard bij de ronde');
  }
  return game;
}

async function main() {
  await startServer();

  // --- volledig potje met random geldige invoer; scores en totalen kloppen ---
  {
    const game = await playGame(['An', 'Bert', 'Carla', 'Daan'], () => ({
      playingTeam: Math.floor(Math.random() * 2),
      trump: Math.floor(Math.random() * 4),
      points: Math.floor(Math.random() * (TOTAL + 1)),
      roem: [randomRoem(), randomRoem()],
      pit: false,
    }));
    assert.equal(game.status, 'finished');
    assert.equal(game.rounds.length, N_ROUNDS);
    assert.equal(game.pending, null, 'geen halve ronde blijven hangen');
    assert.deepEqual(game.teams, [[0, 2], [1, 3]], 'maten zitten tegenover elkaar');
    assert.deepEqual(game.teamNames, ['An & Carla', 'Bert & Daan']);
    const totals = [0, 1].map(t => game.rounds.reduce((a, r) => a + r.scores[t], 0));
    assert.deepEqual(game.totals, totals, 'totalen');
    const max = Math.max(...totals);
    assert.deepEqual(game.winnerTeamIdxs,
      totals.map((t, i) => [t, i]).filter(([t]) => t === max).map(([, i]) => i));
    console.log('OK volledig potje + scores + winnaar');
  }

  // --- de telling zelf, met de hand nagerekend ---
  {
    const created = await api('POST', API + '/games', { players: ['P1', 'P2', 'P3', 'P4'] });
    const id = created.body.id;
    assert.equal(created.body.totalRounds, N_ROUNDS);
    assert.equal(created.body.dealerIdx, 0, 'ronde 1: speler 1 deelt');
    assert.equal(created.body.voorhandIdx, 1, 'links van de deler mag kiezen');
    assert.equal(created.body.trumpInfo, null, 'nog geen troef gekozen');

    const play = async (round, input) => {
      const s = await api('POST', API + '/games/' + id + '/start',
        { round, playingTeam: input.playingTeam, trump: input.trump });
      assert.equal(s.status, 200, 'start: ' + JSON.stringify(s.body));
      return api('POST', API + '/games/' + id + '/round', scoreBody(round, input));
    };

    // 1. gewoon gehaald: 100 om 62
    let r = await play(0, { playingTeam: 0, trump: 0, points: 100, roem: [0, 0] });
    assert.deepEqual(r.body.rounds[0].scores, [100, 62]);
    assert.equal(r.body.rounds[0].nat, false);
    assert.equal(r.body.dealerIdx, 1, 'deler schuift door');
    assert.equal(r.body.phase, 'choose', 'volgende ronde begint weer met de troefkeuze');

    // 2. precies gelijk (81-81) is nat — de tegenpartij pakt alles
    r = await play(1, { playingTeam: 0, trump: 1, points: 81, roem: [0, 0] });
    assert.deepEqual(r.body.rounds[1].scores, [0, 162]);
    assert.equal(r.body.rounds[1].nat, true);

    // 3. roem trekt een verliespartij alsnog binnen: 80+20 > 82
    r = await play(2, { playingTeam: 0, trump: 2, points: 80, roem: [20, 0] });
    assert.deepEqual(r.body.rounds[2].scores, [100, 82]);

    // 4. nat: álle roem gaat mee naar de tegenpartij, ook die van de speler
    r = await play(3, { playingTeam: 0, trump: 3, points: 70, roem: [20, 40] });
    assert.deepEqual(r.body.rounds[3].scores, [0, 162 + 60]);

    // 5. nat verklaren zonder te tellen geeft exact dezelfde uitkomst
    r = await play(4, { playingTeam: 0, trump: 0, nat: true, roem: [20, 40] });
    assert.deepEqual(r.body.rounds[4].scores, [0, 162 + 60]);
    assert.equal(r.body.rounds[4].nat, true);
    assert.equal(r.body.rounds[4].points, null, 'punten blijven leeg bij nat');

    // 6. pit voor de spelende partij: 162 + roem + 100
    r = await play(5, { playingTeam: 1, trump: 0, points: TOTAL, roem: [0, 20], pit: true });
    assert.deepEqual(r.body.rounds[5].scores, [0, 162 + 20 + 100]);
    assert.equal(r.body.rounds[5].nat, false);

    // team 0 pakte alleen ronde 1 en 3; team 1 de rest
    assert.deepEqual(r.body.totals, [100 + 100, 62 + 162 + 82 + 222 + 222 + 282]);
    console.log('OK telling: nat, roem, pit (met de hand nagerekend)');
  }

  // --- validatie & concurrency ---
  {
    const created = await api('POST', API + '/games', { players: ['V1', 'V2', 'V3', 'V4'] });
    const id = created.body.id;
    const start = (round, extra) => api('POST', API + '/games/' + id + '/start',
      Object.assign({ round, playingTeam: 0, trump: 0 }, extra));
    const score = (round, input) => api('POST', API + '/games/' + id + '/round',
      scoreBody(round, input));
    const ok = { points: 100, roem: [0, 0] };

    // spelersaantal
    assert.equal((await api('POST', API + '/games', { players: ['a', 'b', 'c'] })).status, 400);
    assert.equal((await api('POST', API + '/games', { players: ['a', 'b', 'c', 'd', 'e'] })).status, 400);
    assert.equal((await api('POST', API + '/games', { players: ['a', '', 'c', 'd'] })).status, 400);
    assert.equal((await api('POST', API + '/games', { players: ['An', 'an', 'C', 'D'] })).status, 400,
      'dubbele naam (andere schrijfwijze)');

    // tellen kan pas na de troefkeuze
    assert.equal((await score(0, ok)).status, 409, 'telling zonder troefkeuze');
    // troefkeuze valideren
    assert.equal((await start(0, { playingTeam: 2 })).status, 400, 'onbekend team');
    assert.equal((await start(0, { playingTeam: undefined })).status, 400, 'team ontbreekt');
    assert.equal((await start(0, { trump: 4 })).status, 400, 'onbekende troef');
    assert.equal((await start(0, { trump: undefined })).status, 400, 'troef ontbreekt');
    assert.equal((await start(5)).status, 409, 'ronde uit de toekomst');
    assert.equal((await start(0)).status, 200);
    assert.equal((await start(0)).status, 409, 'ronde al begonnen');

    // veldvalidatie van de telling
    assert.equal((await score(0, { ...ok, points: 163 })).status, 400, 'punten te hoog');
    assert.equal((await score(0, { ...ok, points: -1 })).status, 400, 'punten negatief');
    assert.equal((await score(0, { ...ok, points: 80.5 })).status, 400, 'punten niet heel');
    assert.equal((await score(0, { ...ok, points: undefined })).status, 400, 'punten ontbreken');
    assert.equal((await score(0, { ...ok, roem: [25, 0] })).status, 400, 'roem geen veelvoud van 10');
    assert.equal((await score(0, { ...ok, roem: [-10, 0] })).status, 400, 'roem negatief');
    assert.equal((await score(0, { ...ok, roem: [0] })).status, 400, 'roem incompleet');

    // pit is voorbehouden aan de spelende partij, met alle 162 punten
    assert.equal((await score(0, { points: 150, roem: [0, 0], pit: true })).status, 400,
      'pit zonder alle punten');
    assert.equal((await score(0, { points: 0, roem: [0, 0], pit: true })).status, 400,
      'tegenpit bestaat niet');
    assert.equal((await score(0, { points: TOTAL, roem: [0, 20], pit: true })).status, 400,
      'pit terwijl de tegenpartij roem maakte');
    assert.equal((await score(0, { nat: true, roem: [0, 0], pit: true })).status, 400,
      'nat en pit samen');

    // geldige telling, daarna dezelfde ronde nog eens → 409
    assert.equal((await score(0, ok)).status, 200);
    assert.equal((await score(0, ok)).status, 409, 'verouderde ronde');
    assert.equal((await api('GET', API + '/games/bestaat-niet')).status, 404);

    // undo: eerst de telling terug, dan de troefkeuze
    let r = await api('POST', API + '/games/' + id + '/undo', {});
    assert.equal(r.status, 200);
    assert.equal(r.body.phase, 'score', 'telling terug, troef blijft staan');
    assert.equal(r.body.rounds.length, 0);
    assert.deepEqual(r.body.totals, [0, 0]);
    r = await api('POST', API + '/games/' + id + '/undo', {});
    assert.equal(r.body.phase, 'choose', 'ook de troefkeuze terug');
    assert.equal(r.body.trumpInfo, null);
    assert.equal((await api('POST', API + '/games/' + id + '/undo', {})).status, 409,
      'niets om ongedaan te maken');

    // abandon: uit de actieve lijst en uit het klassement
    assert.equal((await api('POST', API + '/games/' + id + '/abandon', {})).status, 200);
    const list = await api('GET', API + '/games?status=active');
    assert.ok(!list.body.games.some(g => g.id === id), 'afgebroken potje niet in de lijst');
    const lb = await api('GET', API + '/leaderboard');
    assert.ok(!lb.body.leaderboard.some(e => e.name === 'V1'), 'afgebroken potje telt niet mee');
    console.log('OK validatie, 409-guards, undo, afbreken');
  }

  // --- undo op een afgerond potje zet het weer open ---
  {
    const pick = () => ({ playingTeam: 0, trump: 0, points: 100, roem: [0, 0] });
    const game = await playGame(['U1', 'U2', 'U3', 'U4'], pick);
    assert.equal(game.status, 'finished');
    const r = await api('POST', API + '/games/' + game.id + '/undo', {});
    assert.equal(r.body.status, 'active');
    assert.equal(r.body.winnerTeamIdxs, null);
    assert.equal(r.body.rounds.length, N_ROUNDS - 1);
    assert.equal(r.body.phase, 'score', 'ronde heropent met dezelfde troef');
    // opnieuw afsluiten met een andere uitslag → andere winnaar
    const done = await api('POST', API + '/games/' + game.id + '/round',
      { round: N_ROUNDS - 1, points: 0, roem: [0, 0], pit: false });
    assert.equal(done.body.status, 'finished');
    assert.deepEqual(done.body.totals, [15 * 100, 15 * 62 + 162]);
    assert.deepEqual(done.body.winnerTeamIdxs, [0]);
    console.log('OK undo heropent een afgerond potje');
  }

  // --- klassement: per speler, maar met de punten van zijn team ---
  {
    // Team 0 (Eva & Gijs) wint elke ronde met 100 om 62.
    const pick = () => ({ playingTeam: 0, trump: 0, points: 100, roem: [0, 0] });
    const g1 = await playGame(['Eva', 'Frank', 'Gijs', 'Hanna'], pick);
    const g2 = await playGame(['eva', 'Frank', 'Gijs', 'Hanna'], pick); // andere schrijfwijze
    assert.deepEqual(g1.winnerTeamIdxs, [0]);
    assert.deepEqual(g2.totals, [16 * 100, 16 * 62]);

    const lb = (await api('GET', API + '/leaderboard')).body.leaderboard;
    const eva = lb.find(e => e.name.toLowerCase() === 'eva');
    assert.equal(eva.gamesPlayed, 2, 'zelfde speler ondanks andere schrijfwijze');
    assert.equal(eva.wins, 2);
    assert.equal(eva.avgPoints, 16 * 100);
    assert.equal(eva.bestScore, 16 * 100);
    const gijs = lb.find(e => e.name === 'Gijs');
    assert.deepEqual([gijs.wins, gijs.avgPoints], [2, 16 * 100], 'maat krijgt dezelfde punten');
    const frank = lb.find(e => e.name === 'Frank');
    assert.equal(frank.wins, 0);
    assert.equal(frank.avgPoints, 16 * 62);
    assert.equal(lb[0].name.toLowerCase(), 'eva', 'meeste wins bovenaan');
    console.log('OK klassement per speler (teampunten, case-insensitieve namen)');
  }

  // --- klassement zonder bepaalde spelers ---
  {
    const pick = () => ({ playingTeam: 0, trump: 0, points: 100, roem: [0, 0] });
    await playGame(['Kind', 'Frank', 'Gijs', 'Hanna'], pick);

    const full = (await api('GET', API + '/leaderboard')).body;
    assert.ok(full.players.includes('Kind'), 'keuzelijst bevat alle spelers');
    assert.deepEqual(full.excluded, []);
    assert.equal(full.gamesCounted, full.gamesTotal);
    assert.equal(full.leaderboard.find(e => e.name === 'Gijs').gamesPlayed, 3);

    const filtered = (await api('GET', API + '/leaderboard?exclude=kind')).body;
    assert.deepEqual(filtered.excluded, ['Kind'], 'schrijfwijze uit de potjes');
    assert.ok(filtered.players.includes('Kind'), 'uitgesloten speler blijft kiesbaar');
    assert.ok(!filtered.leaderboard.some(e => e.name === 'Kind'));
    assert.equal(filtered.gamesCounted, full.gamesTotal - 1);
    assert.equal(filtered.leaderboard.find(e => e.name === 'Gijs').gamesPlayed, 2);

    const a = (await api('GET', API + '/leaderboard?exclude=Kind,Frank')).body;
    const b = (await api('GET', API + '/leaderboard?exclude=kind&exclude=FRANK')).body;
    assert.deepEqual(a.leaderboard, b.leaderboard, 'komma == herhaalde param');
    const noop = (await api('GET', API + '/leaderboard?exclude=,%20&exclude=Niemand')).body;
    assert.deepEqual(noop.leaderboard, full.leaderboard, 'lege/onbekende namen doen niets');
    console.log('OK klassement-filter (potjes zonder bepaalde spelers)');
  }

  // --- overzichtspagina: snapshot + SSE, met de troef erin ---
  {
    // Actief potje gaat voor op recent afgeronde potjes.
    const created = await api('POST', API + '/games', { players: ['S1', 'S2', 'S3', 'S4'] });
    const id = created.body.id;
    let cur = (await api('GET', API + '/current')).body;
    assert.equal(cur.game.id, id, 'actief potje in de snapshot');
    assert.equal(cur.game.phase, 'choose');
    assert.ok(Array.isArray(cur.leaderboard), 'klassement voor het idle-scherm');

    // SSE: de troefkeuze moet meteen op het scorebord landen.
    const chunks = [];
    const req = http.get(BASE + API + '/events', res => {
      assert.equal(res.statusCode, 200);
      assert.match(res.headers['content-type'], /text\/event-stream/);
      res.setEncoding('utf8');
      res.on('data', c => chunks.push(c));
    });
    await new Promise(r => setTimeout(r, 300));
    await api('POST', API + '/games/' + id + '/start', { round: 0, playingTeam: 1, trump: 2 });
    await new Promise(r => setTimeout(r, 300));
    req.destroy();
    const stream = chunks.join('');
    assert.ok(stream.includes('event: state'), 'state-events ontvangen');
    assert.ok(stream.includes(id), 'broadcast bevat het potje');
    assert.ok(stream.includes('Ruiten'), 'gekozen troef gaat live naar het scorebord');

    cur = (await api('GET', API + '/current')).body;
    assert.equal(cur.game.phase, 'score');
    assert.equal(cur.game.trumpInfo.name, 'Ruiten');
    assert.equal(cur.game.pending.playingTeam, 1);
    await api('POST', API + '/games/' + id + '/abandon', {});
    console.log('OK snapshot + SSE voor de overzichtspagina');
  }

  // --- de twee spellen delen niets: aparte opslag, kanalen en klassementen ---
  {
    const bb = await api('POST', '/api/boerenbridge/games', { players: ['X1', 'X2', 'X3'] });
    assert.equal(bb.status, 201);
    const kjList = (await api('GET', API + '/games')).body.games;
    assert.ok(!kjList.some(g => g.id === bb.body.id), 'boerenbridge-spel niet in klaverjas');
    assert.ok(fs.existsSync(path.join(DATA_DIR, 'klaverjas.json')), 'eigen databestand');
    assert.ok(fs.existsSync(path.join(DATA_DIR, 'boerenbridge.json')));
    const kjLb = (await api('GET', API + '/leaderboard')).body;
    assert.ok(!kjLb.players.includes('X1'), 'aparte klassementen');
    assert.ok(!kjLb.suggestions.includes('X1'), 'aparte naamsuggesties');
    assert.ok(kjLb.suggestions.includes('S1'), 'afgebroken potje telt mee als suggestie');
    const kjCur = (await api('GET', API + '/current')).body;
    assert.ok(!kjCur.game || kjCur.game.id !== bb.body.id, 'aparte snapshots');
    assert.equal((await fetch(BASE + '/games/klaverjas/')).status, 200, 'invoerpagina');
    assert.equal((await fetch(BASE + '/games/klaverjas/display/')).status, 200, 'overzichtspagina');
    assert.equal((await fetch(BASE + '/data/klaverjas.json')).status, 404, 'data geblokkeerd');
    await api('POST', '/api/boerenbridge/games/' + bb.body.id + '/abandon', {});
    console.log('OK gescheiden opslag naast boerenbridge');
  }

  // --- persistentie over een herstart, inclusief een halve ronde ---
  {
    const created = await api('POST', API + '/games', { players: ['H1', 'H2', 'H3', 'H4'] });
    await api('POST', API + '/games/' + created.body.id + '/start',
      { round: 0, playingTeam: 0, trump: 3 });
    const before = (await api('GET', API + '/games')).body.games.length;
    assert.ok(before > 0);
    await stopServer();
    await startServer();
    const after = (await api('GET', API + '/games')).body;
    assert.equal(after.games.length, before, 'potjes overleven herstart');
    assert.ok(after.games[0].teamNames.length === 2, 'samenvatting bevat de teams');
    const resumed = (await api('GET', API + '/games/' + created.body.id)).body;
    assert.equal(resumed.phase, 'score', 'lopende ronde overleeft de herstart');
    assert.equal(resumed.trumpInfo.name, 'Schoppen', 'gekozen troef blijft bewaard');
    console.log('OK persistentie over herstart');
  }

  console.log('\nAlle klaverjas-tests geslaagd ✔');
}

main()
  .then(() => stopServer())
  .catch(async err => {
    console.error(err);
    await stopServer();
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));
