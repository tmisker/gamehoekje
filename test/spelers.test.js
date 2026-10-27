// Test voor spelers die een voornaam delen (server/spelers.js): eerst de pure
// functies, dan end-to-end via de echte server — kiezen bij de start, de
// voornaam aan tafel, de suggesties en het toewijzen van oude potjes.
// Geen dependencies. Run: node test/spelers.test.js
'use strict';

const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const spelers = require('../server/spelers.js');
const logic = require('../server/logic.js');

const SERVER = path.join(__dirname, '..', 'server', 'server.js');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'spelers-test-'));
let PORT = 0;
let BASE = '';
let serverProc = null;

const ILSES = ['Ilse B.', 'Ilse de V.'];
const GROUPS = [{ first: 'Ilse', names: ILSES }];

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

// Boerenbridge uitspelen; de eerste speler vraagt en pakt alles.
async function playBoerenbridge(names) {
  const created = await api('POST', '/api/boerenbridge/games', { players: names });
  assert.equal(created.status, 201, 'create: ' + JSON.stringify(created.body));
  let game = created.body;
  for (let r = 0; r < game.rounds.length; r++) {
    const cards = game.rounds[r].cards;
    const vals = names.map((_, i) => (i === 0 ? cards : 0));
    let resp = await api('POST', '/api/boerenbridge/games/' + game.id + '/predictions', { round: r, predictions: vals });
    assert.equal(resp.status, 200, 'predictions r' + r);
    resp = await api('POST', '/api/boerenbridge/games/' + game.id + '/actuals', { round: r, actuals: vals });
    assert.equal(resp.status, 200, 'actuals r' + r);
    game = resp.body;
  }
  assert.equal(game.status, 'finished');
  return game;
}

function pureTests() {
  // --- groepen beheren ---
  {
    const groups = spelers.setGroup([], { first: ' Ilse ', names: [' Ilse B. ', 'Ilse de V.', ''] });
    assert.deepEqual(groups, GROUPS, 'spaties en lege velden vallen weg');
    const bad = (input, re) => assert.throws(() => spelers.setGroup(groups, input), re);
    bad({ first: '', names: ILSES }, /voornaam/);
    bad({ first: 'Ilse', names: ['Ilse B.'] }, /twee namen/);
    bad({ first: 'Ilse', names: ['Ilse B.', 'ilse b.'] }, /eigen naam/);
    bad({ first: 'Ilse', names: ['Ilse B.', 'Els'] }, /begint niet met Ilse/);
    bad({ first: 'Ilse', names: ['Ilse B.', 'Ilse'] }, /begint niet met Ilse/);
    bad({ first: 'Ilse B.', names: ['Ilse B. x', 'Ilse B. y'] }, /staat al bij Ilse/);
    assert.deepEqual(spelers.setGroup(groups, { first: 'ilse', names: [] }), [], 'zonder namen weg');
    const two = spelers.setGroup(groups, { first: 'Jan', names: ['Jan K.', 'Jan Willem'] });
    assert.deepEqual(two.map(g => g.first), ['Ilse', 'Jan'], 'op voornaam gesorteerd');
    assert.deepEqual(spelers.setGroup(two, { first: 'Ilse', names: ['Ilse B.', 'Ilse X.'] })[0].names,
      ['Ilse B.', 'Ilse X.'], 'zelfde voornaam = wijzigen');
    assert.deepEqual(groups, GROUPS, 'origineel ongemoeid');
    assert.throws(() => spelers.parseGroups({}), /onverwachte vorm/);
    assert.deepEqual(spelers.parseGroups(GROUPS), GROUPS);
    console.log('OK groepen: toevoegen, wijzigen, weghalen, validatie');
  }

  // --- kale voornaam bij de start ---
  {
    assert.doesNotThrow(() => spelers.check(['Tim', 'Ilse B.'], GROUPS));
    assert.doesNotThrow(() => spelers.check(undefined, GROUPS));
    let err = null;
    try { spelers.check(['Tim', ' ilse '], GROUPS); } catch (e) { err = e; }
    assert.equal(err.status, 400);
    assert.equal(err.message, 'Welke Ilse? Kies Ilse B. of Ilse de V.');
    assert.deepEqual(err.ask, { index: 1, name: 'ilse', first: 'Ilse', choices: ILSES });
    console.log('OK kale voornaam → vraag welke');
  }

  // --- suggesties ---
  {
    assert.deepEqual(spelers.withGroups(['Tim', 'Ilse', 'Sara'], GROUPS), ['Tim', ...ILSES, 'Sara'],
      'kale Ilse wordt beide volledige namen');
    assert.deepEqual(spelers.withGroups(['Ilse de V.', 'Tim', 'Ilse B.'], GROUPS), [...ILSES, 'Tim'],
      'wie een voornaam deelt staat naast elkaar');
    assert.deepEqual(spelers.withGroups(['Tim'], GROUPS), ['Tim'], 'nooit meegespeeld → niet in de suggesties');
    console.log('OK suggesties');
  }

  // --- voornaam aan tafel ---
  {
    assert.deepEqual(spelers.tableLabels(['Tim', 'Ilse B.'], GROUPS), [['Ilse B.', 'Ilse']]);
    assert.deepEqual(spelers.tableLabels(['Tim', 'ilse de v.'], GROUPS), [['ilse de v.', 'Ilse']]);
    assert.deepEqual(spelers.tableLabels(ILSES, GROUPS), [], 'allebei aan tafel → voluit');
    assert.deepEqual(spelers.tableLabels(['Ilse B.', 'Ilse'], GROUPS), [], 'naast een kale Ilse → voluit');
    assert.deepEqual(spelers.tableLabels(['Ilse', 'Tim'], GROUPS), [], 'kale Ilse blijft wat ze is');
    const game = { players: ['Ilse B.', 'Tim'], swaps: [{ seat: 1, round: 2, from: 'Ilse de V.', to: 'Tim' }] };
    assert.deepEqual(spelers.tableLabels(spelers.seated(game), GROUPS), [], 'wie eerder op een stoel zat telt mee');

    const view = {
      players: ['Ilse B.', 'Tim'],
      fact: { icon: '🎯', text: 'Ilse B. vraagt nul; ILSE B. haalde dat vaker. Ilse B.s ronde.' },
      teamNames: ['Ilse B. & Tim'],
      totals: [3, 4],
      nested: [{ name: 'Ilse B.', other: null }],
    };
    const out = spelers.relabel(view, [['Ilse B.', 'Ilse']]);
    assert.deepEqual(out.players, ['Ilse', 'Tim']);
    assert.equal(out.fact.text, 'Ilse vraagt nul; Ilse haalde dat vaker. Ilse B.s ronde.',
      'in teksten, hoofdletterongevoelig, alleen hele namen');
    assert.deepEqual(out.teamNames, ['Ilse & Tim']);
    assert.deepEqual(out.totals, [3, 4]);
    assert.deepEqual(out.nested, [{ name: 'Ilse', other: null }]);
    assert.equal(view.players[0], 'Ilse B.', 'het origineel blijft ongemoeid');
    assert.equal(spelers.relabel(view, []), view, 'niets in te korten → zelfde object');
    console.log('OK voornaam aan tafel (labels + relabel)');
  }

  // --- toewijzen ---
  {
    // Ilse nam in ronde 4 de stoel van Sara over.
    const game = {
      status: 'finished',
      players: ['Tim', 'Ilse'],
      swaps: [{ seat: 1, round: 3, from: 'Sara', to: 'Ilse' }],
    };
    spelers.assign(game, 'ilse', 'ilse de v.', GROUPS);
    assert.deepEqual(game.players, ['Tim', 'Ilse de V.'], 'schrijfwijze uit de groep');
    assert.deepEqual([game.swaps[0].from, game.swaps[0].to], ['Sara', 'Ilse de V.'], 'ook in de wissels');
    spelers.assign(game, 'Ilse de V.', 'Ilse B.', GROUPS);
    assert.deepEqual(game.players, ['Tim', 'Ilse B.'], 'vergissing rechtzetten');
    assert.throws(() => spelers.assign(game, 'Ilse', 'Ilse de V.', GROUPS), e => e.status === 409);
    assert.throws(() => spelers.assign(game, 'Ilse B.', 'Ilse B.', GROUPS), e => e.status === 409);
    assert.throws(() => spelers.assign(game, 'Tim', 'Ilse de V.', GROUPS), /hoort niet bij Ilse/);
    assert.throws(() => spelers.assign(game, 'Ilse B.', 'Piet', GROUPS), /Onbekende naam/);

    const games = [
      { status: 'finished', players: ['Tim', 'Ilse'] },
      { status: 'abandoned', players: ['Chris', 'Ilse'] },
      { status: 'active', players: ['Sara'], swaps: [{ seat: 0, round: 1, from: 'Ilse', to: 'Sara' }] },
      { status: 'finished', players: ['Ilse B.'] },
    ];
    assert.deepEqual(spelers.unassigned(games, GROUPS).map(u => games.indexOf(u.game)), [0, 2],
      'afgebroken potjes blijven weg, wissels tellen mee');
    console.log('OK toewijzen');
  }

  // --- de weetjes-historie vergeet een hernoemde speler niet vanzelf ---
  {
    const g = logic.createGame(['Tim', 'Ilse']);
    for (let r = 0; r < g.rounds.length; r++) {
      const c = g.rounds[r].cards;
      logic.applyPredictions(g, r, [c, 0]);
      logic.applyActuals(g, r, [c, 0]);
    }
    const before = logic.historyOf([g]);
    assert.ok(before.players.has('ilse'));
    spelers.assign(g, 'Ilse', 'Ilse B.', GROUPS);
    assert.equal(logic.historyOf([g]), before, 'zelfde sleutel → nog de oude historie');
    logic.forgetHistory();
    const after = logic.historyOf([g]);
    assert.ok(after.players.has('ilse b.') && !after.players.has('ilse'), 'na forgetHistory wel bij');
    console.log('OK historie-cache na toewijzen');
  }
}

async function serverTests() {
  await startServer();

  let r = await api('GET', '/api/spelers');
  assert.deepEqual(r.body, { groups: [], open: [] });

  // Oude potjes van vóór de groep: een kale "Ilse".
  const old = await playBoerenbridge(['Tim', 'Ilse', 'Assunta', 'Enrico']);
  const kj = await api('POST', '/api/klaverjas/games', { players: ['Ilse', 'Tim', 'An', 'Bo'] });
  assert.equal(kj.status, 201);
  const ytOld = await api('POST', '/api/yahtzee/games', { players: ['Ilse', 'Tim'], columns: 1 });
  assert.equal(ytOld.status, 201);

  r = await api('POST', '/api/spelers/groups', { first: 'Ilse', names: ['Ilse B.'] });
  assert.equal(r.status, 400);
  r = await api('POST', '/api/spelers/groups', { first: 'Ilse', names: ILSES });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.groups, GROUPS);
  assert.deepEqual(r.body.open.map(o => [o.game, o.id, o.first]), [
    ['boerenbridge', old.id, 'Ilse'], ['klaverjas', kj.body.id, 'Ilse'], ['yahtzee', ytOld.body.id, 'Ilse'],
  ], 'oude potjes, oudste eerst');
  assert.deepEqual(r.body.open[0].players, ['Tim', 'Ilse', 'Assunta', 'Enrico']);
  console.log('OK groep aanmaken + oude potjes in beeld');

  // --- kiezen bij de start ---
  for (const [spel, body] of [
    ['boerenbridge', { players: ['Tim', 'Ilse'] }],
    ['klaverjas', { players: ['Tim', 'Ilse', 'An', 'Bo'] }],
    ['tafeltennis', { players: ['Tim', 'Ilse'], settings: {} }],
    ['yahtzee', { players: ['Tim', 'Ilse'], columns: 1 }],
  ]) {
    r = await api('POST', '/api/' + spel + '/games', body);
    assert.equal(r.status, 400, spel);
    assert.deepEqual(r.body.ask, { index: 1, name: 'Ilse', first: 'Ilse', choices: ILSES }, spel);
  }
  r = await api('GET', '/api/boerenbridge/leaderboard');
  const sug = r.body.suggestions;
  assert.ok(!sug.includes('Ilse'), 'geen kale Ilse in de suggesties');
  assert.equal(sug.indexOf('Ilse de V.'), sug.indexOf('Ilse B.') + 1, 'naast elkaar');
  r = await api('GET', '/api/tafeltennis/leaderboard');
  assert.deepEqual(r.body.suggestions, [], 'nog nooit getafeltennist → niet in de suggesties');
  console.log('OK kale voornaam bij de start → vraag (alle spellen), suggesties voluit');

  // --- aan tafel: voornaam zolang er één Ilse meedoet ---
  r = await api('POST', '/api/boerenbridge/games', { players: ['Ilse B.', 'Tim', 'Sara'] });
  assert.equal(r.status, 201);
  const live = r.body;
  assert.deepEqual(live.players, ['Ilse', 'Tim', 'Sara'], 'create');
  r = await api('GET', '/api/boerenbridge/games/' + live.id);
  assert.deepEqual(r.body.players, ['Ilse', 'Tim', 'Sara'], 'get');
  r = await api('GET', '/api/boerenbridge/current');
  assert.deepEqual(r.body.game.players, ['Ilse', 'Tim', 'Sara'], 'snapshot');
  r = await api('GET', '/api/boerenbridge/games?status=active');
  assert.deepEqual(r.body.games[0].players, ['Ilse', 'Tim', 'Sara'], 'hervat-lijst');

  r = await api('POST', '/api/boerenbridge/games/' + live.id + '/swap', { round: 0, seat: 1, name: 'ilse' });
  assert.equal(r.status, 400);
  assert.equal(r.body.ask.first, 'Ilse', 'ook bij een wissel');
  r = await api('POST', '/api/boerenbridge/games/' + live.id + '/swap', { round: 0, seat: 1, name: 'Ilse de V.' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.players, ['Ilse B.', 'Ilse de V.', 'Sara'], 'allebei aan tafel → voluit');
  r = await api('POST', '/api/boerenbridge/games/' + live.id + '/swap', { round: 0, seat: 1, name: 'Tim' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.players, ['Ilse', 'Tim', 'Sara'], 'wissel teruggedraaid → weer de voornaam');
  r = await api('POST', '/api/boerenbridge/games/' + live.id + '/abandon');
  assert.equal(r.status, 200);

  r = await api('POST', '/api/klaverjas/games', { players: ['Ilse de V.', 'Tim', 'An', 'Bo'] });
  assert.deepEqual(r.body.teamNames, ['Ilse & An', 'Tim & Bo'], 'klaverjas: ook in de teamnamen');
  await api('POST', '/api/klaverjas/games/' + r.body.id + '/abandon');
  r = await api('POST', '/api/tafeltennis/games', { players: ['Ilse B.', 'Tim', 'Sara'], settings: {} });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.players, ['Ilse', 'Tim', 'Sara'], 'tafeltennis');
  assert.ok(r.body.matches.some(m => m.slots.some(s => s.name === 'Ilse')), 'in het schema');
  assert.ok(!JSON.stringify(r.body).includes('Ilse B.'), 'nergens meer voluit');
  await api('POST', '/api/tafeltennis/games/' + r.body.id + '/abandon');
  r = await api('POST', '/api/yahtzee/games', { players: ['Ilse B.', 'Tim'], columns: 1 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.players, ['Ilse', 'Tim'], 'yahtzee');
  assert.ok(!JSON.stringify(r.body).includes('Ilse B.'), 'nergens meer voluit');
  await api('POST', '/api/yahtzee/games/' + r.body.id + '/abandon');
  console.log('OK aan tafel de voornaam, voluit als ze allebei meedoen');

  // --- oude potjes toewijzen ---
  const assign = body => api('POST', '/api/spelers/assign', body);
  r = await assign({ game: 'boerenbridge', id: old.id, from: 'Ilse', to: 'Ilse B.' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.open.map(o => o.game), ['klaverjas', 'yahtzee'], 'boerenbridge is toegewezen');
  r = await assign({ game: 'yahtzee', id: ytOld.body.id, from: 'Ilse', to: 'Ilse de V.' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.open.map(o => o.game), ['klaverjas'], 'yahtzee is toegewezen');
  r = await api('GET', '/api/yahtzee/leaderboard');
  assert.ok(r.body.suggestions.includes('Ilse de V.') && !r.body.suggestions.includes('Ilse'), 'yahtzee voluit');
  r = await api('GET', '/api/boerenbridge/leaderboard');
  const names = r.body.leaderboard.map(row => row.name);
  assert.ok(names.includes('Ilse B.') && !names.includes('Ilse'), 'klassement voluit: ' + names);
  r = await api('GET', '/api/boerenbridge/stats');
  assert.ok(r.body.rows.some(row => row.name === 'Ilse B.'), 'statistiek voluit');
  r = await api('GET', '/api/boerenbridge/games/' + old.id);
  assert.equal(r.body.players[1], 'Ilse', 'het potje zelf toont de voornaam');

  r = await assign({ game: 'boerenbridge', id: old.id, from: 'Ilse B.', to: 'Ilse de V.' });
  assert.equal(r.status, 200, 'vergissing rechtzetten');
  r = await api('GET', '/api/boerenbridge/leaderboard');
  assert.ok(r.body.leaderboard.some(row => row.name === 'Ilse de V.'));
  assert.equal((await assign({ game: 'boerenbridge', id: old.id, from: 'Ilse', to: 'Ilse B.' })).status, 409);
  assert.equal((await assign({ game: 'boerenbridge', id: old.id, from: 'Tim', to: 'Ilse B.' })).status, 400);
  assert.equal((await assign({ game: 'boerenbridge', id: old.id, from: 'Ilse de V.', to: 'Piet' })).status, 400);
  assert.equal((await assign({ game: 'schaken', id: old.id, from: 'Ilse', to: 'Ilse B.' })).status, 404);
  assert.equal((await assign({ game: 'yahtzee', id: old.id, from: 'Ilse', to: 'Ilse B.' })).status, 404,
    'id van een ander spel');
  assert.equal((await assign({ game: 'toString', id: old.id, from: 'Ilse', to: 'Ilse B.' })).status, 404);
  assert.equal((await assign({ game: 'boerenbridge', id: 'nope', from: 'Ilse', to: 'Ilse B.' })).status, 404);
  console.log('OK oude potjes toewijzen (en terugdraaien)');

  // --- persistentie ---
  await stopServer();
  await startServer();
  r = await api('GET', '/api/spelers');
  assert.deepEqual(r.body.groups, GROUPS, 'groep overleeft herstart');
  r = await api('GET', '/api/boerenbridge/leaderboard');
  assert.ok(r.body.leaderboard.some(row => row.name === 'Ilse de V.'), 'toewijzing overleeft herstart');
  console.log('OK persistentie over herstart');

  // --- groep weghalen ---
  r = await api('POST', '/api/spelers/groups', { first: 'Ilse', names: [] });
  assert.deepEqual(r.body, { groups: [], open: [] });
  r = await api('GET', '/api/boerenbridge/games/' + old.id);
  assert.equal(r.body.players[1], 'Ilse de V.', 'zonder groep: gewoon de opgeslagen naam');
  r = await api('POST', '/api/boerenbridge/games', { players: ['Tim', 'Ilse'] });
  assert.equal(r.status, 201, 'kale Ilse mag weer');
  console.log('OK groep weghalen');

  // Kapot spelers.json: opzij zetten, leeg starten, niet crashen.
  await stopServer();
  fs.writeFileSync(path.join(DATA_DIR, 'spelers.json'), JSON.stringify({ groups: [{ first: 'Ilse', names: ['Els', 'Ilse B.'] }] }));
  await startServer();
  r = await api('GET', '/api/spelers');
  assert.deepEqual(r.body.groups, []);
  assert.ok(fs.readdirSync(DATA_DIR).some(f => f.startsWith('spelers.corrupt-')), 'gequarantained');
  console.log('OK ongeldig spelers.json → quarantaine');
}

async function main() {
  pureTests();
  await serverTests();
  console.log('\nAlle spelers-tests geslaagd ✔');
}

main()
  .then(() => stopServer())
  .catch(async err => {
    console.error(err);
    await stopServer();
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));
