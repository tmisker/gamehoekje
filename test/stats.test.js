// Test voor de statistiek over meerdere boerenbridge-potjes (server/bb-stats.js)
// en voor de weetjes die daaruit komen. Puur — geen server, geen dependencies.
// Run: node test/stats.test.js
'use strict';

const assert = require('node:assert');
const logic = require('../server/logic.js');

// Een potje uitspelen met een vaste keuzefunctie (r, cards, n) -> {preds, acts}.
// De acts moeten optellen tot het aantal kaarten; de server bewaakt dat.
function play(names, pick, when) {
  const game = logic.createGame(names);
  for (let r = 0; r < game.rounds.length; r++) {
    const { preds, acts } = pick(r, game.rounds[r].cards, names.length);
    logic.applyPredictions(game, r, preds);
    logic.applyActuals(game, r, acts);
  }
  assert.equal(game.status, 'finished');
  if (when) {
    game.createdAt = when;
    game.finishedAt = new Date(Date.parse(when) + 75 * 60000).toISOString(); // 1 uur 15
  }
  return game;
}

// Potje A en C: Ann vraagt en pakt alles, Bo en Cas vragen nul en halen nul.
const allToAnn = (r, cards) => ({ preds: [cards, 0, 0], acts: [cards, 0, 0] });
// Potje B: Bo pakt alles. Ann vraagt er telkens één te veel (nooit goed),
// Cas vraagt nul en haalt nul.
const allToBo = (r, cards) => ({ preds: [1, cards, 0], acts: [0, cards, 0] });

const NAMES = ['Ann', 'Bo', 'Cas'];
const A = play(NAMES, allToAnn, '2026-03-06T20:00:00Z');   // vrijdag
const B = play(NAMES, allToBo, '2026-03-13T20:00:00Z');    // vrijdag
const C = play(NAMES, allToAnn, '2026-03-21T20:00:00Z');   // zaterdag
const GAMES = [A, B, C];

const CARDS_TOTAL = A.rounds.reduce((a, r) => a + r.cards, 0);   // 8..1..8 = 71
const ROUNDS = A.rounds.length;                                   // 15
const WIN_TOTAL = CARDS_TOTAL + 5 * ROUNDS;                       // alles gehaald + 15x bonus
const ZERO_TOTAL = 5 * ROUNDS;                                    // elke ronde nul exact

function main() {
  // --- de potjes zelf: kloppen de aannames van de fixture? ---
  assert.deepEqual(logic.getTotals(A), [WIN_TOTAL, ZERO_TOTAL, ZERO_TOTAL]);
  assert.deepEqual(A.winnerIdxs, [0], 'Ann wint A');
  assert.deepEqual(logic.getTotals(B), [-ROUNDS, WIN_TOTAL, ZERO_TOTAL], 'Ann zit elke ronde 1 te hoog');
  assert.deepEqual(B.winnerIdxs, [1], 'Bo wint B');
  console.log('OK fixture (drie potjes met bekende uitkomst)');

  // --- rijen per speler ---
  {
    const view = logic.statsView(GAMES, []);
    assert.equal(view.gamesCounted, 3);
    assert.equal(view.gamesTotal, 3);
    const row = name => view.rows.find(r => r.name === name);

    const ann = row('Ann');
    assert.equal(ann.games, 3);
    assert.equal(ann.wins, 2, 'Ann wint A en C');
    assert.equal(ann.rounds, 3 * ROUNDS);
    assert.equal(ann.exact, 2 * ROUNDS, 'in B zat Ann er elke ronde naast');
    assert.equal(ann.under, ROUNDS, 'te veel gevraagd = te weinig gehaald');
    assert.equal(ann.over, 0);
    assert.equal(ann.exactPct, 67);
    assert.equal(ann.bestStreak, ROUNDS, 'reeks loopt niet door over potjes heen');
    assert.equal(ann.zerosAsked, 0);
    assert.equal(ann.bestScore, WIN_TOTAL);
    assert.equal(ann.worstScore, -ROUNDS);
    assert.equal(ann.avgPoints, Math.round(((2 * WIN_TOTAL - ROUNDS) / 3) * 10) / 10);
    // Durf = gemiddeld gevraagd gedeeld door het eerlijke deel (kaarten/spelers).
    // In A en C vraagt Ann alles (3,0x), in B telkens één slag (3/kaarten).
    assert.equal(ann.ask, 2.3);
    assert.equal(row('Bo').ask, 1, 'Bo vraagt in één van de drie potjes alles, verder nul');
    assert.equal(ann.bestRound, 13, 'beste ronde: 8 gevraagd, 8 gehaald');
    assert.equal(ann.worstRound, -1);

    const bo = row('Bo');
    assert.equal(bo.wins, 1);
    assert.equal(bo.exactPct, 100);
    assert.equal(bo.zerosAsked, 2 * ROUNDS, 'nul gevraagd in A en C');
    assert.equal(bo.zerosMade, 2 * ROUNDS);
    assert.equal(bo.spread, 33.5, 'spreiding over 75, 146 en 75');

    const cas = row('Cas');
    assert.equal(cas.wins, 0);
    assert.equal(cas.zerosAsked, 3 * ROUNDS, 'Cas vraagt altijd nul');
    assert.equal(cas.ask, 0);
    assert.equal(cas.exactPct, 100);
    assert.equal(cas.spread, 0, 'Cas eindigt elk potje op hetzelfde totaal');
    // Sortering: trefzekerheid eerst, dan winst.
    assert.equal(view.rows[0].exactPct, 100);
    assert.equal(view.rows[view.rows.length - 1].name, 'Ann');
    console.log('OK spelersrijen (trefzekerheid, nulletjes, durf, reeks, spreiding)');
  }

  // --- per kaartaantal en per troef ---
  {
    const view = logic.statsView(GAMES, []);
    const eight = view.byCards.find(c => c.cards === 8);
    // 8 kaarten komt 2x per potje voor, 3 potjes, 3 spelers = 18 spelersrondes;
    // alleen Ann in potje B zat ernaast (2 rondes).
    assert.equal(eight.rounds, 18);
    assert.equal(eight.exactPct, Math.round((100 * 16) / 18));
    // Samen gevraagd: in A en C precies rond, in B één te veel.
    assert.equal(eight.askDiff, Math.round((2 / 6) * 10) / 10);
    const one = view.byCards.find(c => c.cards === 1);
    assert.equal(one.rounds, 9, 'de 1-kaartronde komt één keer per potje voor');
    assert.equal(view.byCards.length, 8, 'kaartaantallen 1 t/m 8');
    assert.equal(view.bySuit.length, 5, 'vijf troeven, ook Sans');
    assert.ok(view.bySuit.every(s => s.rounds > 0 && s.exactPct >= 0));
    console.log('OK per kaartaantal en per troef');
  }

  // --- onderling, records en tafelnotities ---
  {
    const view = logic.statsView(GAMES, []);
    assert.equal(view.pairs.length, 3, 'drie paren aan een tafel van drie');
    const ab = view.pairs.find(p => p.a === 'Ann' && p.b === 'Bo');
    assert.equal(ab.games, 3);
    assert.equal(ab.winsA, 2, 'Ann won er twee');
    assert.equal(ab.winsB, 1);
    const bc = view.pairs.find(p => p.a === 'Bo' && p.b === 'Cas');
    assert.equal(bc.winsB, 0, 'Cas won nooit');

    const rec = title => view.records.find(r => r.title === title);
    assert.match(rec('Hoogste eindscore').text, new RegExp('^Ann — ' + WIN_TOTAL + ' punten$'));
    assert.match(rec('Laagste eindscore').text, new RegExp('^Ann — -' + ROUNDS + ' punten$'));
    assert.equal(rec('Beste ronde').text, 'Ann — +13 bij 8 kaarten');
    assert.equal(rec('Zwaarste klap'), undefined, 'een misser van -1 is geen record');
    assert.equal(rec('Langste reeks').text, 'Ann — 15 rondes op rij precies');
    assert.equal(rec('Snelste potje').text, '1 uur 15 min');
    assert.equal(rec('Langste potje').text, '1 uur 15 min');
    assert.match(rec('Ruimste winst').text, /^Ann — \d+ punten voorsprong$/);

    const notes = view.notes.map(n => n.text);
    assert.ok(notes.some(t => /koploper na de 1-kaartronde won 3 van de 3 potjes/.test(t)),
      'de koploper halverwege won hier altijd: ' + JSON.stringify(notes));
    assert.ok(!notes.some(t => /gespeeld/.test(t)), 'te weinig potjes voor een vaste speelavond');
    console.log('OK onderling, records en tafelnotities');
  }

  // --- het exclude-filter werkt net als bij het klassement ---
  {
    const view = logic.statsView(GAMES, ['Ann']);
    assert.equal(view.gamesCounted, 0, 'Ann deed overal mee');
    assert.deepEqual(view.excluded, ['Ann']);
    assert.deepEqual(view.rows, []);
    assert.ok(view.players.includes('Ann'), 'uitgesloten speler blijft kiesbaar');
    const partial = logic.statsView(GAMES.concat([play(['Dex', 'Eef', 'Fay'], allToAnn)]), ['Ann']);
    assert.equal(partial.gamesCounted, 1);
    assert.equal(partial.rows.length, 3);
    console.log('OK exclude-filter op de statistiek');
  }

  // --- hoogtepunten van een potje ---
  {
    // De ronde vanaf welke iemand onbetwist bovenaan staat, los nagerekend.
    function takeover(game) {
      const cum = logic.cumulativeTotals(game);
      const w = game.winnerIdxs[0];
      for (let r = cum.length - 1; r >= 0; r--) {
        const max = Math.max(...cum[r]);
        const solo = cum[r][w] === max && cum[r].filter(t => t === max).length === 1;
        if (!solo) return r + 1;
      }
      return 0;
    }

    // Ann bouwt in drie rondes een voorsprong op; daarna pakt Bo elke slag en
    // haalt langzaam in. De grootste achterstand ligt dus ver van het moment
    // dat de kop wisselt, en beide regels zijn interessant.
    const late = play(NAMES, (r, cards) => (r < 3
      ? { preds: [cards, 0, 0], acts: [cards, 0, 0] }
      : { preds: [0, cards, 0], acts: [0, cards, 0] }));
    assert.deepEqual(late.winnerIdxs, [1], 'Bo wint');
    const texts = logic.enrich(late, [late]).highlights.map(h => h.text);
    assert.ok(texts.some(t => /^Bo kwam terug van 21 punten achterstand \(na ronde 3\)\.$/.test(t)),
      'comeback: ' + texts);
    const at = takeover(late);
    assert.ok(at > 4, 'de kop wisselt pas laat (ronde ' + (at + 1) + ')');
    assert.ok(texts.includes('Kantelpunt: in ronde ' + (at + 1) + ' nam Bo de kop over en die ging er niet meer af.'),
      'kantelpunt: ' + texts);

    // Gaat de kop meteen na de grootste achterstand om, dan zegt de comeback
    // hetzelfde en blijft het kantelpunt weg.
    const quick = play(NAMES, (r, cards) => (r < 2
      ? { preds: [cards, 0, 0], acts: [cards, 0, 0] }
      : { preds: [cards, cards, 0], acts: [0, cards, 0] }));
    const quickTexts = logic.enrich(quick, [quick]).highlights.map(h => h.text);
    assert.ok(quickTexts.some(t => /^Bo kwam terug van/.test(t)));
    assert.ok(!quickTexts.some(t => /^Kantelpunt/.test(t)), 'geen dubbele regel: ' + quickTexts);

    // Wie van start tot finish leidt heeft geen comeback en geen kantelpunt.
    const wire = logic.enrich(A, [A]).highlights.map(h => h.text);
    assert.ok(!wire.some(t => /Kantelpunt|kwam terug/.test(t)));
    assert.ok(wire.some(t => /^Ann stond van begin tot eind aan kop\.$/.test(t)), 'wire-to-wire: ' + wire);
    console.log('OK hoogtepunten (comeback, kantelpunt, van start tot finish)');
  }

  // --- wisselen van speler: wie speelde welke ronde ---
  {
    // Ann speelt de eerste zes rondes, daarna neemt Dee de stoel over.
    const game = logic.createGame(NAMES);
    for (let r = 0; r < game.rounds.length; r++) {
      const cards = game.rounds[r].cards;
      if (r === 6) logic.applySwap(game, r, 0, 'Dee');
      logic.applyPredictions(game, r, [cards, 0, 0]);
      logic.applyActuals(game, r, [cards, 0, 0]);
    }
    assert.deepEqual(game.players, ['Dee', 'Bo', 'Cas'], 'Dee zit nu op de stoel');
    assert.deepEqual(game.swaps, [{ seat: 0, round: 6, from: 'Ann', to: 'Dee' }]);
    assert.equal(logic.occupantAt(game, 0, 5), 'Ann');
    assert.equal(logic.occupantAt(game, 0, 6), 'Dee');
    assert.equal(logic.occupantAt(game, 1, 6), 'Bo', 'andere stoelen ongemoeid');
    assert.deepEqual(game.winnerIdxs, [0], 'de stoel wint');

    const view = logic.statsView([game], []);
    const row = name => view.rows.find(r => r.name === name);
    assert.equal(row('Dee').games, 1, 'het potje telt voor wie het uitspeelt');
    assert.equal(row('Dee').wins, 1);
    assert.equal(row('Dee').rounds, 9, 'ronde 7 t/m 15');
    assert.equal(row('Dee').bestScore, WIN_TOTAL, 'de eindscore hoort bij de stoel');
    assert.equal(row('Ann').games, 0, 'Ann speelde dit potje niet uit');
    assert.equal(row('Ann').wins, 0);
    assert.equal(row('Ann').rounds, 6, 'ronde 1 t/m 6');
    assert.equal(row('Ann').avgPoints, null);
    assert.equal(row('Ann').bestScore, null);
    assert.equal(row('Ann').worstScore, null);
    assert.equal(row('Ann').exactPct, 100, 'haar rondes tellen wél mee');
    assert.equal(row('Ann').bestStreak, 6, 'de reeks stopt bij de wissel');
    assert.equal(row('Dee').bestStreak, 9);
    // Het klassement kent alleen wie een potje uitspeelde.
    const lb = logic.leaderboardView([game], []).leaderboard;
    assert.ok(lb.some(e => e.name === 'Dee'), 'Dee staat in het klassement');
    assert.ok(!lb.some(e => e.name === 'Ann'), 'Ann niet: zij maakte geen potje af');
    assert.equal(lb.find(e => e.name === 'Dee').exactPct, 100);
    console.log('OK wisselen van speler (rondes en potje apart toegewezen)');
  }

  // --- een potje buiten de telling ---
  {
    const skipped = play(NAMES, allToAnn);
    logic.setCounted(skipped, false);
    const withIt = logic.statsView(GAMES.concat([skipped]), []);
    assert.equal(withIt.gamesCounted, GAMES.length, 'het potje telt niet mee');
    const row = withIt.rows.find(r => r.name === 'Ann');
    assert.equal(row.games, 3, 'Ann houdt haar drie potjes');
    // Ook de weetjes en het klassement slaan het over.
    assert.deepEqual(logic.tableFacts(GAMES.concat([skipped])), logic.tableFacts(GAMES));
    const lb = logic.leaderboardView(GAMES.concat([skipped]), []);
    assert.equal(lb.gamesTotal, GAMES.length);
    // Weer aanzetten telt hem gewoon weer mee.
    logic.setCounted(skipped, true);
    assert.equal(logic.statsView(GAMES.concat([skipped]), []).gamesCounted, GAMES.length + 1);
    assert.throws(() => logic.setCounted(skipped, 'ja'), /meetelt/, 'alleen true of false');
    console.log('OK potje buiten de telling');
  }

  // --- weetjes voor het idle-scherm ---
  {
    const facts = logic.tableFacts(GAMES);
    assert.ok(facts.length >= 5, 'records en notities samen: ' + facts.length);
    assert.ok(facts.every(f => f.icon && f.text), 'elk weetje heeft een icoon en tekst');
    assert.ok(facts.some(f => f.text.startsWith('Hoogste eindscore: Ann — ' + WIN_TOTAL)), 'records: ' + facts.map(f => f.text));
    assert.ok(facts.some(f => /koploper na de 1-kaartronde/.test(f.text)), 'notities zitten erbij');
    assert.deepEqual(logic.tableFacts([]), [], 'zonder historie niets te melden');
    assert.deepEqual(logic.tableFacts([logic.createGame(NAMES)]), [], 'een lopend potje telt niet mee');
    console.log('OK weetjes voor het idle-scherm');
  }

  // --- weetjes uit de historie ---
  {
    const game = logic.createGame(NAMES);
    const enriched = logic.enrich(game, GAMES.concat([game]));
    assert.ok(enriched.fact, 'vóór de eerste ronde is er dankzij de historie al een weetje');
    const texts = logic.historyCandidates(game, logic.historyOf(GAMES)).map(f => f.text);
    const has = re => assert.ok(texts.some(t => re.test(t)), re + ' ontbreekt in ' + JSON.stringify(texts));
    has(/^Cas vroeg al 45 keer nul en haalde het 45 keer\.$/);
    assert.ok(texts.includes('Het record aan deze tafel is ' + WIN_TOTAL + ' (Ann).'), 'record: ' + texts);
    // Een onderlinge stand heeft vier gezamenlijke potjes nodig; met drie
    // zegt het te weinig.
    assert.ok(!texts.some(t => /speelden al/.test(t)), 'nog geen onderlinge stand');
    const more = logic.historyCandidates(game, logic.historyOf(GAMES.concat([play(NAMES, allToAnn)])))
      .map(f => f.text);
    assert.ok(more.includes('Ann en Bo speelden al 4 potjes samen; Ann won er 3.'),
      'onderlinge stand na vier potjes: ' + more);
    has(/^Cas vraagt bij 8 kaarten meestal 0\.$/);
    // Zonder historie blijven alleen de weetjes uit het potje zelf over.
    assert.deepEqual(logic.historyCandidates(game, null), []);
    assert.equal(logic.enrich(game, []).fact, null, 'geen historie, geen gespeelde ronde → geen weetje');
    console.log('OK weetjes uit de historie');
  }

  // --- reactie op de zojuist aangetikte voorspelling ---
  {
    const game = logic.createGame(NAMES);
    const hist = GAMES.concat([game]);
    assert.equal(logic.enrich(game, hist).draftFact, null, 'zonder concept-invoer geen reactie');

    logic.applyDraft(game, 0, 'predict', [3, null, null]);
    assert.equal(game.draft.last, 0, 'Ann tikte als laatste');
    let f = logic.enrich(game, hist).draftFact;
    assert.ok(f && f.text.includes('Ann'), 'reactie gaat over Ann: ' + JSON.stringify(f));
    assert.equal(f.text, 'Exact zitten levert Ann 8 punten op.', 'terugval als er niets bijzonders is');

    logic.applyDraft(game, 0, 'predict', [3, 0, null]);
    assert.equal(game.draft.last, 1);
    f = logic.enrich(game, hist).draftFact;
    // Twee even sterke kandidaten: het nulletje over alle potjes, of hoe vaak
    // deze vraag bij dit kaartaantal lukte. Beide gaan over Bo's nul.
    assert.match(f.text, /^Bo vraagt (nul; dat lukte 30 van de 30|0 — bij 8 kaarten lukte dat 4 van de 4) keer\.$/,
      'reactie op de nul: ' + f.text);

    // Alle acht slagen vragen is nieuw voor Cas: dat wint van de rest.
    logic.applyDraft(game, 0, 'predict', [3, 0, 8]);
    f = logic.enrich(game, hist).draftFact;
    assert.equal(f.text, 'Cas vraagt 8 van 8: de hoogste vraag ooit.');

    // Een ongewijzigde POST verandert de reactie niet.
    logic.applyDraft(game, 0, 'predict', [3, 0, 8]);
    assert.equal(logic.enrich(game, hist).draftFact.text, f.text);
    console.log('OK reactie op een aangetikte voorspelling');
  }

  // --- het weetje van de ronde wisselt tussen nieuws en achtergrond ---
  {
    const game = logic.createGame(NAMES);
    const seen = [];
    for (let r = 0; r < 6; r++) {
      const cards = game.rounds[r].cards;
      seen.push(logic.enrich(game, GAMES.concat([game])).fact);
      logic.applyPredictions(game, r, [cards, 0, 0]);
      logic.applyActuals(game, r, [cards, 0, 0]);
    }
    assert.ok(seen.every(f => f && f.text), 'elke ronde een weetje');
    const unique = new Set(seen.map(f => f.text));
    assert.ok(unique.size >= 4, 'de weetjes herhalen zich niet elke ronde: ' + JSON.stringify([...unique]));
    console.log('OK afwisseling van de weetjes');
  }

  console.log('\nAlle statistiek-tests geslaagd ✔');
}

main();
