// Boerenbridge-spellogica — autoritatief op de server.
// Puur (geen I/O); ook bruikbaar in Node-tests via module.exports.
'use strict';

const shared = require('./shared.js');
const bbStats = require('./bb-stats.js');
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

// Hoe een rondescore tot stand kwam — puur voor de weergave (kleur):
// 'exact' = precies voorspeld (pluspunten mét de bonus van 5),
// 'over'  = te veel geraapt (pluspunten zónder bonus),
// 'under' = te weinig geraapt (minpunten).
function scoreKind(pred, act) {
  if (act === pred) return 'exact';
  return act > pred ? 'over' : 'under';
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
  if (players.length < 2 || players.length > 6) throw httpError(400, 'Kies 2 tot 6 spelers');
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
  // `last` = de speler wiens keuze zojuist veranderde; daar reageert het
  // weetje op het voorspelscherm op (zie draftCandidates).
  const before = game.draft && game.draft.phase === phase ? game.draft : null;
  const prev = before ? before.values : null;
  let last = null;
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== null && (!prev || prev[i] !== values[i])) last = i;
  }
  // Verandert er niets (een herhaalde POST), dan blijft de vorige keuze staan —
  // anders zou het weetje op het scorebord zomaar verdwijnen.
  if (last === null && before && Number.isInteger(before.last) && values[before.last] !== null) {
    last = before.last;
  }
  game.draft = values.some(v => v !== null) ? { phase, values, last } : null;
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
// concept-invoer van de slagen zo blijft staan, met per speler de score van de
// ronde (`deltas`) en hoe die tot stand komt (`kinds`, zie scoreKind).
// Niet-autoritatief (de draft telt nergens in mee), maar wél hier berekend —
// de scoreformule is een spelregel en hoort niet in de clients.
function projection(game, totals) {
  if (game.status !== 'active' || game.phase !== 'actual') return null;
  const preds = game.predictions[game.currentRound];
  const draft = game.draft && game.draft.phase === 'actual' ? game.draft.values : null;
  if (!preds || !draft) return null;
  const deltas = preds.map((p, i) => (draft[i] == null ? null : scoreRound(p, draft[i])));
  const kinds = preds.map((p, i) => (draft[i] == null ? null : scoreKind(p, draft[i])));
  const projected = totals.map((t, i) => t + (deltas[i] || 0));
  return { deltas, kinds, totals: projected, positions: positions(projected) };
}

// Per gespeelde ronde per speler hoe de score tot stand kwam (zie scoreKind).
// De clients kleuren hierop, zodat de scoreregels op de server blijven.
function getRoundKinds(game) {
  return game.roundScores.map((row, r) => {
    const preds = game.predictions[r] || [];
    const acts = game.actuals[r] || [];
    return row.map((_, i) => (
      Number.isInteger(preds[i]) && Number.isInteger(acts[i]) ? scoreKind(preds[i], acts[i]) : null
    ));
  });
}

// Verrijkte view voor API/SSE: spel + afgeleide velden (niet persistent).
function enrich(game, games) {
  const n = game.players.length;
  const roundIdx = Math.min(game.currentRound, game.rounds.length - 1);
  const r = game.rounds[roundIdx];
  const cumulative = cumulativeTotals(game);
  const totals = cumulative.length ? cumulative[cumulative.length - 1].slice() : game.players.map(() => 0);
  const hist = historyOf(games);
  return Object.assign({}, game, {
    totals,
    cumulative,
    positions: positions(totals),
    projection: projection(game, totals),
    roundKinds: getRoundKinds(game),
    fact: pickFact(game, hist),            // weetje voor de komende ronde (lopend potje)
    draftFact: pickDraftFact(game, hist),  // reactie op de laatst aangetikte voorspelling
    highlights: highlights(game),          // hoogtepunten (afgerond potje)
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

// ---- Weetjes (lopend potje) en hoogtepunten (afgerond potje) ----
// Tekst voor de schermen, berekend uit de gespeelde rondes van het potje zelf
// (geen historie). De server kiest en formuleert; de clients tonen alleen.

function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' en ' + names[names.length - 1];
}

function cardsTxt(cards) {
  return cards + (cards === 1 ? ' kaart' : ' kaarten');
}

function formatDuration(ms) {
  const min = Math.round(ms / 60000);
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return m + ' min';
  return h + ' uur' + (m ? ' ' + m + ' min' : '');
}

// Wie na ronde r (index in cumulative) aan kop staat; gelijke totalen delen de kop.
function leadersAfter(cum, r) {
  const row = cum[r];
  const max = Math.max(...row);
  return row.map((t, i) => (t === max ? i : -1)).filter(i => i >= 0);
}

// Hoe vaak de kop van eigenaar wisselde: pas als niemand van de vorige
// koplopers nog bovenaan staat — een gedeelde kop is nog geen wissel.
function leadChanges(cum) {
  let changes = 0;
  for (let r = 1; r < cum.length; r++) {
    const prev = leadersAfter(cum, r - 1), now = leadersAfter(cum, r);
    if (!now.some(i => prev.includes(i))) changes++;
  }
  return changes;
}

// Nulletjes per speler: hoe vaak 0 gevraagd en hoe vaak dat ook gehaald.
function zeroStats(game) {
  const zeros = game.players.map(() => ({ asked: 0, made: 0 }));
  game.roundScores.forEach((_, r) => game.players.forEach((_, i) => {
    if (game.predictions[r][i] !== 0) return;
    zeros[i].asked++;
    if (game.actuals[r][i] === 0) zeros[i].made++;
  }));
  return zeros;
}

// Kandidaat-weetjes voor de komende ronde, elk met een gewicht: nieuws
// (reeks, onbereikbare kop, halverwege) weegt zwaarder dan achtergrond.
function factCandidates(game) {
  const out = [];
  const played = game.roundScores.length;
  if (game.status !== 'active' || !played) return out;
  const P = game.players, n = P.length;
  const cum = cumulativeTotals(game);
  const totals = cum[played - 1];
  const kinds = getRoundKinds(game);
  const next = game.rounds[game.currentRound];
  const remaining = game.rounds.slice(game.currentRound);
  const add = (weight, icon, text) => out.push({ weight, icon, text });
  const last = played - 1;

  // Reeksen: rondes op rij precies goed, of juist mis.
  P.forEach((name, i) => {
    let hit = 0;
    for (let r = last; r >= 0 && kinds[r][i] === 'exact'; r--) hit++;
    if (hit >= 3) add(4 + Math.min(hit, 4), '🔥', name + ' zit al ' + hit + ' rondes op rij precies goed.');
    let miss = 0;
    for (let r = last; r >= 0 && kinds[r][i] !== 'exact'; r--) miss++;
    if (miss >= 3) add(3, '🙈', name + ' zat er de laatste ' + miss + ' rondes naast.');
  });

  // De stand: gedeelde kop, de achtervolger, een onbereikbare kop.
  const leaders = leadersAfter(cum, last);
  const leaderNames = joinNames(leaders.map(i => P[i]));
  const others = P.map((_, i) => i).filter(i => !leaders.includes(i));
  const second = others.length ? Math.max(...others.map(i => totals[i])) : null;
  const chasers = others.filter(i => totals[i] === second).map(i => P[i]);
  const gap = second == null ? 0 : totals[leaders[0]] - second;
  if (leaders.length > 1) {
    add(5, '🤝', leaderNames + ' staan precies gelijk aan kop.');
  } else {
    const exactPts = next.cards + 5;
    if (played >= 5 && gap <= exactPts) {
      add(4, '🎯', joinNames(chasers) + (chasers.length > 1 ? ' staan ' : ' staat ') + gap
        + ' achter op ' + leaderNames + '. Precies voorspellen levert ' + exactPts + ' punten op.');
    }
    // Zelfs als de koploper elke ronde alles verliest en de rest alles pakt.
    const maxSwing = remaining.reduce((a, r) => a + 2 * r.cards + 5, 0);
    if (gap > maxSwing) add(10, '🏆', leaderNames + ' is niet meer in te halen.');
    const always = cum.every((_, r) => {
      const l = leadersAfter(cum, r);
      return l.length === 1 && l[0] === leaders[0];
    });
    if (played >= 5 && always) add(3, '👑', leaderNames + ' staat al de hele avond aan kop.');
  }
  const changes = leadChanges(cum);
  if (changes >= 2) add(2 + Math.min(changes, 4), '🔁', 'De kop is vanavond al ' + changes + ' keer gewisseld.');

  // Halverwege: na de 1-kaartronde.
  const half = game.rounds.findIndex(r => r.cards === 1);
  if (half >= 0 && played === half + 1) {
    add(9, '⏱️', 'Halverwege! ' + leaderNames + (leaders.length > 1
      ? ' staan gelijk aan kop.'
      : ' staat aan kop, ' + gap + ' punten voor op ' + joinNames(chasers) + '.'));
  }

  // Vorige ronde: hoeveel zaten er goed, en vroeg de tafel te veel of te weinig?
  const hits = kinds[last].filter(k => k === 'exact').length;
  const asked = game.predictions[last].reduce((a, b) => a + b, 0);
  const cardsLast = game.rounds[last].cards;
  const askedTxt = asked === cardsLast ? 'de tafel vroeg precies rond'
    : asked > cardsLast ? 'de tafel vroeg ' + (asked - cardsLast) + ' te veel'
      : 'de tafel vroeg ' + (cardsLast - asked) + ' te weinig';
  if (hits === n) add(5, '💯', 'Vorige ronde zat iedereen precies goed!');
  else if (hits === 0) add(4, '🙈', 'Vorige ronde zat niemand goed; ' + askedTxt + '.');
  else add(1, '📋', 'Vorige ronde ' + (hits === 1 ? 'zat ' : 'zaten ') + hits + ' van de ' + n + ' goed; ' + askedTxt + '.');

  // Uitschieters van de vorige ronde, als het de grootste van de avond zijn.
  if (played >= 3) {
    const row = game.roundScores[last];
    const all = game.roundScores.flat();
    const maxLast = Math.max(...row);
    if (maxLast === Math.max(...all) && maxLast >= 8) {
      const who = P.filter((_, i) => row[i] === maxLast);
      add(3, '🚀', joinNames(who) + (who.length > 1 ? ' pakten' : ' pakte') + ' vorige ronde '
        + maxLast + ' punten, de beste ronde van de avond.');
    }
    const minLast = Math.min(...row);
    if (minLast === Math.min(...all) && minLast <= -4) {
      const who = P.filter((_, i) => row[i] === minLast);
      add(3, '💥', joinNames(who) + (who.length > 1 ? ' leverden' : ' leverde') + ' vorige ronde '
        + (-minLast) + ' punten in, de zwaarste klap van de avond.');
    }
  }

  // De tafel vanavond.
  if (played >= 4) {
    const all = kinds.flat();
    const pct = Math.round(100 * all.filter(k => k === 'exact').length / all.length);
    add(1, '📊', 'Vanavond zit ' + pct + '% van de voorspellingen precies goed.');
  }
  const zeros = zeroStats(game);
  const zerosAsked = zeros.reduce((a, z) => a + z.asked, 0);
  const zerosMade = zeros.reduce((a, z) => a + z.made, 0);
  if (zerosAsked >= 4) add(2, '0️⃣', 'Vanavond al ' + zerosAsked + ' keer nul gevraagd, ' + zerosMade + ' keer gehaald.');
  const mostZeros = Math.max(...zeros.map(z => z.made));
  if (mostZeros >= 3) {
    const who = P.filter((_, i) => zeros[i].made === mostZeros);
    add(2, '0️⃣', joinNames(who) + (who.length > 1 ? ' haalden' : ' haalde') + ' vanavond al ' + mostZeros + ' nulletjes.');
  }

  // Spiegelronde: dezelfde kaarten eerder vanavond.
  const mirror = game.rounds.findIndex((r, i) => i < game.currentRound && r.cards === next.cards);
  if (mirror >= 0) {
    const good = P.filter((_, i) => kinds[mirror][i] === 'exact');
    const pre = 'Eerder vanavond met ' + cardsTxt(next.cards);
    add(2, '🪞', good.length === 0 ? pre + ' zat niemand goed.'
      : good.length === n ? pre + ' zat iedereen goed.'
        : good.length === 1 ? pre + ' zat alleen ' + good[0] + ' goed.'
          : pre + ' zaten ' + joinNames(good) + ' goed.');
  }
  return out;
}

// De spelregels die bb-stats nodig heeft om te kunnen tellen; daar staat
// bewust geen scoreformule of kleurclassificatie in.
const RULES = { getRoundKinds, playerOrder, cumulativeTotals, suitNames: SUIT_NAMES };

// Historie = alles uit eerdere afgeronde potjes. Wordt bij élke mutatie
// opgevraagd (ook bij een draft-POST), dus gecachet op wat er verandert als er
// een potje bij komt: hoeveel er af zijn en wanneer het laatste eindigde.
let historyCache = { key: null, value: null };
function historyOf(games) {
  if (!Array.isArray(games)) return null;
  let count = 0, last = '';
  for (const g of games) {
    if (g.status !== 'finished') continue;
    count++;
    if (g.finishedAt > last) last = g.finishedAt;
  }
  if (!count) return null;
  const key = count + '@' + last;
  if (historyCache.key !== key) {
    historyCache = { key, value: bbStats.collect(games.filter(g => g.status === 'finished'), RULES) };
  }
  return historyCache.value;
}

const ORDINAL = ['1e', '2e', '3e', '4e', '5e', '6e', '7e', '8e', '9e', '10e'];
const ordinal = k => ORDINAL[k - 1] || k + 'e';

// Weetjes uit eerdere potjes. Bewust lichter gewogen dan het nieuws van
// vanavond (reeksen, kopwisselingen): achtergrond verliest van wat er nú
// gebeurt. Overal een minimum aantal waarnemingen, en bij weinig data een
// telling ("4 van de 9") in plaats van een percentage.
function historyCandidates(game, hist) {
  const out = [];
  if (!hist || game.status !== 'active') return out;
  const add = (weight, icon, text) => out.push({ weight, icon, text });
  const P = game.players, n = P.length;
  const played = game.roundScores.length;
  const cum = cumulativeTotals(game);
  const totals = played ? cum[played - 1] : P.map(() => 0);
  const cards = game.rounds[game.currentRound].cards;
  const order = playerOrder(n, game.currentRound);
  const mine = P.map(name => hist.players.get(shared.nameKey(name)) || null);

  mine.forEach((p, i) => {
    if (!p) return;
    const pc = p.byCards.get(cards);
    if (pc && pc.rounds >= 5) {
      if (!pc.exact) {
        add(3, '🧊', P[i] + ' zat bij ' + cardsTxt(cards) + ' nog nooit precies goed ('
          + pc.rounds + ' keer geprobeerd).');
      } else {
        add(2, '📈', P[i] + ' zit bij ' + cardsTxt(cards) + ' ' + pc.exact + ' van de '
          + pc.rounds + ' keer goed.');
      }
    }
    const fav = bbStats.favouriteAsk(pc);
    if (fav) add(2, '🔮', P[i] + ' vraagt bij ' + cardsTxt(cards) + ' meestal ' + fav.value + '.');
    if (p.zerosAsked >= 10) {
      add(1, '0️⃣', P[i] + ' vroeg al ' + p.zerosAsked + ' keer nul en haalde het '
        + p.zerosMade + ' keer.');
    }
    // De deler voorspelt als laatste — voor sommigen scheelt dat.
    if (order[n - 1] === i && p.late.rounds >= 10 && p.early.rounds >= 10) {
      const late = bbStats.pct(p.late.exact, p.late.rounds);
      const early = bbStats.pct(p.early.exact, p.early.rounds);
      if (late - early >= 12) {
        add(2, '🎩', P[i] + ' voorspelt nu als laatste; dat gaat beter (' + late
          + '% tegen ' + early + '%).');
      } else if (early - late >= 12) {
        add(2, '🎩', P[i] + ' voorspelt nu als laatste; juist dan gaat het vaker mis ('
          + late + '% tegen ' + early + '%).');
      }
    }
    // Ligt deze avond boven of onder het eigen gemiddelde op dit punt?
    if (played >= 4) {
      const cb = p.cumByRound[played - 1];
      if (cb && cb.count >= 3) {
        const diff = totals[i] - Math.round(cb.sum / cb.count);
        if (Math.abs(diff) >= 8) {
          add(2, diff > 0 ? '⬆️' : '⬇️', P[i] + ' staat ' + Math.abs(diff) + ' punten '
            + (diff > 0 ? 'boven' : 'onder') + ' het eigen gemiddelde na ' + played + ' rondes.');
        }
      }
    }
  });

  // Het record aan deze tafel, en wie daar vanavond op koers ligt.
  const holders = mine.map((p, i) => (p && p.bestScore > -Infinity ? { i, score: p.bestScore } : null))
    .filter(Boolean);
  if (holders.length) {
    const rec = holders.reduce((a, b) => (b.score > a.score ? b : a));
    let paced = false;
    if (played >= 8) {
      P.forEach((name, i) => {
        const projected = Math.round((totals[i] / played) * game.rounds.length);
        if (projected > rec.score && !paced) {
          paced = true;
          add(3, '🏅', name + ' ligt op koers voor ongeveer ' + projected
            + ' punten; het record aan deze tafel is ' + rec.score + ' (' + P[rec.i] + ').');
        }
      });
    }
    if (!paced) add(1, '🏅', 'Het record aan deze tafel is ' + rec.score + ' (' + P[rec.i] + ').');
  }

  // Onderling: wie wint er vaker als deze twee allebei meedoen?
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const key = [shared.nameKey(P[i]), shared.nameKey(P[j])].sort().join('|');
      const e = hist.pairs.get(key);
      if (!e || e.games < 4) continue;
      const win = e.winsA >= e.winsB ? { name: e.a, wins: e.winsA } : { name: e.b, wins: e.winsB };
      if (!win.wins) continue;
      add(1, '⚔️', e.a + ' en ' + e.b + ' speelden al ' + e.games + ' potjes samen; '
        + win.name + ' won er ' + win.wins + '.');
    }
  }

  // Halverwege: zegt de koploper na de 1-kaartronde iets? Even zwaar als het
  // halverwege-weetje zelf, zodat ze elkaar afwisselen.
  const half = game.rounds.findIndex(r => r.cards === 1);
  if (half >= 0 && played === half + 1 && hist.halfway.games >= 4) {
    add(9, '🔮', 'De koploper na de 1-kaartronde won ' + hist.halfway.leaderWon
      + ' van de ' + hist.halfway.games + ' potjes.');
  }

  // Is dit ronde-type het lastigst of juist het makkelijkst?
  const rows = bbStats.cardRows(hist).filter(c => c.rounds >= 12);
  if (rows.length >= 3) {
    const here = rows.find(c => c.cards === cards);
    if (here) {
      const hard = rows.reduce((a, b) => (b.exactPct < a.exactPct ? b : a));
      const easy = rows.reduce((a, b) => (b.exactPct > a.exactPct ? b : a));
      if (here.cards === hard.cards && hard.cards !== easy.cards) {
        add(2, '😤', 'Bij ' + cardsTxt(cards) + ' zit maar ' + here.exactPct
          + '% van de tafel goed — het lastigste ronde-type.');
      } else if (here.cards === easy.cards && hard.cards !== easy.cards) {
        add(2, '🍀', 'Bij ' + cardsTxt(cards) + ' zit ' + here.exactPct
          + '% van de tafel goed — het makkelijkste ronde-type.');
      }
    }
  }
  return out;
}

// Reactie op de zojuist aangetikte voorspelling (`draft.last`). Anders dan het
// weetje van de ronde mag dit wél bij elke keuze wisselen — dat is juist de bedoeling.
function draftCandidates(game, hist) {
  const out = [];
  if (game.status !== 'active' || game.phase !== 'predict') return out;
  const d = game.draft;
  if (!d || d.phase !== 'predict' || !Number.isInteger(d.last)) return out;
  const i = d.last, pred = d.values[i];
  if (!Number.isInteger(pred)) return out;
  const P = game.players, name = P[i];
  const cards = game.rounds[game.currentRound].cards;
  const played = game.roundScores.length;
  const cum = cumulativeTotals(game);
  const totals = played ? cum[played - 1] : P.map(() => 0);
  const add = (weight, icon, text) => out.push({ weight, icon, text });
  const p = hist ? hist.players.get(shared.nameKey(name)) : null;
  const pc = p && p.byCards.get(cards);

  const gain = pred + 5;
  const leadMax = Math.max(...totals);
  if (played >= 3 && totals[i] < leadMax && totals[i] + gain > leadMax) {
    add(4, '🎯', 'Exact zitten levert ' + name + ' ' + gain + ' punten op — genoeg voor de kop.');
  } else {
    add(1, '🎯', 'Exact zitten levert ' + name + ' ' + gain + ' punten op.');
  }

  if (pred === 0) {
    let zeros = 0;
    for (let r = 0; r < played; r++) if (game.predictions[r][i] === 0) zeros++;
    if (zeros >= 2) add(3, '0️⃣', name + ' vraagt nul — het ' + ordinal(zeros + 1) + ' nulletje vanavond.');
    else if (p && p.zerosAsked >= 8) {
      add(2, '0️⃣', name + ' vraagt nul; dat lukte ' + p.zerosMade + ' van de ' + p.zerosAsked + ' keer.');
    } else add(1, '0️⃣', name + ' vraagt nul.');
  }
  if (p && p.rounds >= 20 && pred > p.maxAsk) {
    add(4, '🚀', name + ' vraagt ' + pred + ' van ' + cards + ': de hoogste vraag ooit.');
  }
  if (pc) {
    const ask = pc.asks.get(pred);
    if (ask && ask.count >= 4) {
      add(2, '📈', name + ' vraagt ' + pred + ' — bij ' + cardsTxt(cards) + ' lukte dat '
        + ask.made + ' van de ' + ask.count + ' keer.');
    }
  }
  if (pred === cards && cards >= 3) add(3, '😳', name + ' vraagt alle ' + cards + ' slagen.');
  return out;
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

// Eén weetje per ronde, vastgepind: de keuze hangt alleen af van de gespeelde
// rondes en het potje-id, niet van de concept-invoer — anders zou de tekst
// bij elke aangetikte voorspelling verspringen. Uit de zwaarste kandidaten
// (gewicht ≥ top − 1) kiest een hash, zodat niet elke ronde hetzelfde soort
// weetje bovenkomt.
// Nieuws (wat er vanavond gebeurt) weegt zwaarder dan achtergrond (historie),
// maar zou over 15 rondes alles opslokken: een lopende reeks wint anders elke
// ronde opnieuw. Daarom wisselen de rondes elkaar af — oneven ronde nieuws,
// even ronde achtergrond — met terugval op de andere groep als die leeg is.
// Alleen echt groot nieuws (gewicht >= 9, zoals een onbereikbare koploper)
// breekt daar doorheen.
const NEWS_FROM = 4;
function pickFact(game, hist) {
  const all = factCandidates(game).concat(historyCandidates(game, hist));
  if (!all.length) return null;
  const top = all.reduce((a, b) => (b.weight > a.weight ? b : a));
  let pool = all.filter(f => f.weight >= 9);
  if (top.weight < 9) {
    const news = all.filter(f => f.weight >= NEWS_FROM);
    const background = all.filter(f => f.weight < NEWS_FROM);
    let group = game.currentRound % 2 ? news : background;
    if (!group.length) group = group === news ? background : news;
    const best = group.reduce((a, b) => (b.weight > a.weight ? b : a)).weight;
    pool = group.filter(f => f.weight >= best - 1);
  }
  const f = pool[hashStr(game.id + ':' + game.currentRound) % pool.length];
  return { icon: f.icon, text: f.text };
}

// Het weetje bij de laatst aangetikte voorspelling. Wisselt bewust wél mee met
// de invoer: de sleutel bevat de speler en de gekozen waarde.
function pickDraftFact(game, hist) {
  const c = draftCandidates(game, hist);
  if (!c.length) return null;
  // Anders dan bij het weetje van de ronde geen speelruimte in het gewicht: het
  // meest specifieke wint, anders verdringt "exact zitten levert X op" alles.
  c.sort((a, b) => b.weight - a.weight);
  const pool = c.filter(f => f.weight === c[0].weight);
  const d = game.draft;
  const f = pool[hashStr(game.id + ':' + game.currentRound + ':' + d.last + ':' + d.values[d.last]) % pool.length];
  return { icon: f.icon, text: f.text };
}

// Hoogtepunten van een afgerond potje, voor het eindscherm.
function highlights(game) {
  if (game.status !== 'finished') return [];
  const out = [];
  const P = game.players;
  const cum = cumulativeTotals(game), played = cum.length;
  const kinds = getRoundKinds(game);
  const add = (icon, text) => out.push({ icon, text });

  // Comeback van de winnaar: grootste achterstand onderweg (vanaf 5 punten,
  // anders is het geen comeback maar gewoon spelverloop).
  let back = { deficit: 4, round: -1, who: -1 };
  for (const w of game.winnerIdxs) {
    for (let r = 0; r < played - 1; r++) {
      const d = Math.max(...cum[r]) - cum[r][w];
      if (d > back.deficit) back = { deficit: d, round: r, who: w };
    }
  }
  if (back.who >= 0) {
    add('📈', P[back.who] + ' kwam terug van ' + back.deficit + ' punten achterstand (na ronde ' + (back.round + 1) + ').');
  }

  // Kantelpunt: vanaf welke ronde stond de winnaar onbetwist bovenaan? Dat is
  // de eerste ronde na de laatste waarin dat níet zo was. Bij een gedeelde
  // winst bestaat dat moment niet (took === played) en blijft de regel weg.
  const winner = game.winnerIdxs[0];
  let took = 0;
  for (let r = played - 1; r >= 0; r--) {
    const row = cum[r], max = Math.max(...row);
    if (row[winner] === max && row.filter(t => t === max).length === 1) continue;
    took = r + 1;
    break;
  }
  // Ligt het kantelpunt vlak na de grootste achterstand, dan vertelt de
  // comeback-regel hierboven hetzelfde verhaal al.
  const overlaps = back.who === winner && took <= back.round + 1;
  if (took > 0 && took < played && !overlaps) {
    add('🔀', 'Kantelpunt: in ronde ' + (took + 1) + ' nam ' + P[winner]
      + ' de kop over en die ging er niet meer af.');
  }

  // Langst aan kop, en hoe vaak de kop wisselde.
  const led = P.map((_, i) => cum.filter(row => row[i] === Math.max(...row)).length);
  const most = Math.max(...led);
  const kings = P.filter((_, i) => led[i] === most);
  const stood = kings.length > 1 ? ' stonden ' : ' stond ';
  add('👑', joinNames(kings) + stood + (most === played
    ? 'van begin tot eind aan kop.'
    : most + ' van de ' + played + ' rondes aan kop.'));
  const changes = leadChanges(cum);
  if (changes) add('🔁', 'De kop wisselde ' + changes + ' keer van eigenaar.');

  // Trefzekerheid.
  const hits = P.map((_, i) => kinds.filter(row => row[i] === 'exact').length);
  const hi = Math.max(...hits), lo = Math.min(...hits);
  const sharp = P.filter((_, i) => hits[i] === hi);
  add('🎯', sharp.length === P.length
    ? 'Iedereen zat ' + hi + ' van de ' + played + ' rondes precies goed.'
    : joinNames(sharp) + (sharp.length > 1 ? ' zaten' : ' zat') + ' het vaakst goed: ' + hi + ' van de ' + played + ' rondes.');
  if (lo < hi) {
    const blunt = P.filter((_, i) => hits[i] === lo);
    add('🙈', joinNames(blunt) + (blunt.length > 1 ? ' zaten' : ' zat') + ' er het vaakst naast: ' + (played - lo) + ' keer.');
  }

  // Beste ronde en zwaarste klap.
  let top = { s: -Infinity }, bottom = { s: Infinity };
  game.roundScores.forEach((row, r) => row.forEach((s, i) => {
    if (s > top.s) top = { s, r, i };
    if (s < bottom.s) bottom = { s, r, i };
  }));
  add('🚀', 'Beste ronde: ' + P[top.i] + ' +' + top.s + ' (ronde ' + (top.r + 1) + ', ' + cardsTxt(game.rounds[top.r].cards) + ').');
  if (bottom.s <= -3) {
    add('💥', 'Zwaarste klap: ' + P[bottom.i] + ' ' + bottom.s + ' (ronde ' + (bottom.r + 1) + ', ' + cardsTxt(game.rounds[bottom.r].cards) + ').');
  }

  // Nulletjes-koning.
  const zeros = zeroStats(game);
  const mostZ = Math.max(...zeros.map(z => z.made));
  if (mostZ >= 2) {
    const who = P.map((_, i) => i).filter(i => zeros[i].made === mostZ);
    add('0️⃣', 'Nulletjes-koning: ' + joinNames(who.map(i => P[i] + ' (' + zeros[i].made + ' van ' + zeros[i].asked + ')')) + '.');
  }

  // Duur — alleen bij een normale avond; een potje dat dagen openstond zegt niets.
  const ms = Date.parse(game.finishedAt) - Date.parse(game.createdAt);
  if (ms >= 5 * 60000 && ms <= 6 * 3600000) add('⏱️', 'Het potje duurde ' + formatDuration(ms) + '.');
  return out;
}

// Eretitels uit de klassementsrijen; `winners` = iedereen met de topwaarde.
// 'under' = te weinig gehaald = te veel gevraagd (optimist); 'over' andersom.
const AWARDS = [
  { key: 'scherpschutter', icon: '🎯', title: 'Scherpschutter', min: 1,
    value: r => r.exactPct, detail: r => r.exactPct + '% precies' },
  { key: 'nulletjes', icon: '0️⃣', title: 'Nulletjes-koning', min: 1,
    value: r => r.zerosMade, detail: r => r.zerosMade + ' van ' + r.zerosAsked },
  { key: 'reeks', icon: '🔥', title: 'Langste reeks', min: 2,
    value: r => r.bestStreak, detail: r => r.bestStreak + ' op rij' },
  { key: 'optimist', icon: '🚀', title: 'Optimist', min: 2,
    value: r => r.under - r.over, detail: r => r.under + '× te veel gevraagd' },
  { key: 'pessimist', icon: '🐢', title: 'Pessimist', min: 2,
    value: r => r.over - r.under, detail: r => r.over + '× te weinig gevraagd' },
];

function awards(rows) {
  const out = [];
  for (const a of AWARDS) {
    const top = Math.max(...rows.map(a.value));
    if (!(top >= a.min)) continue;
    out.push({
      key: a.key, icon: a.icon, title: a.title,
      winners: rows.filter(r => a.value(r) === top).map(r => ({ name: r.name, detail: a.detail(r) })),
    });
  }
  return out;
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
  const rows = shared.aggregate(finished, game => {
    const totals = getTotals(game);
    return game.players.map((_, i) => ({
      points: totals[i],
      won: !!game.winnerIdxs && game.winnerIdxs.includes(i),
    }));
  });
  // Per speler, over alle rondes: trefzekerheid ('exact'), te veel gevraagd
  // ('under'), te weinig gevraagd ('over'), nulletjes en de langste reeks
  // precies-goed binnen één potje.
  const extra = new Map();
  for (const game of finished) {
    const kinds = getRoundKinds(game);
    game.players.forEach((name, i) => {
      const key = shared.nameKey(name);
      let e = extra.get(key);
      if (!e) {
        e = { rounds: 0, exact: 0, over: 0, under: 0, zerosAsked: 0, zerosMade: 0, bestStreak: 0 };
        extra.set(key, e);
      }
      let streak = 0;
      for (let r = 0; r < game.roundScores.length; r++) {
        const k = kinds[r][i];
        if (!k) continue;
        e.rounds++;
        e[k]++;
        streak = k === 'exact' ? streak + 1 : 0;
        if (streak > e.bestStreak) e.bestStreak = streak;
        if (game.predictions[r][i] === 0) {
          e.zerosAsked++;
          if (game.actuals[r][i] === 0) e.zerosMade++;
        }
      }
    });
  }
  return rows.map(row => {
    const e = extra.get(shared.nameKey(row.name));
    return Object.assign(row, e, { exactPct: e.rounds ? Math.round((100 * e.exact) / e.rounds) : 0 });
  });
}

// Payload voor /leaderboard: rijen + de keuzelijst + hoeveel potjes meetellen.
function leaderboardView(games, exclude) {
  const view = shared.leaderboardView(games, exclude, buildRows);
  view.awards = awards(view.leaderboard);
  return view;
}

module.exports = {
  SUITS, SUIT_NAMES, SUIT_COLORS,
  buildRounds, scoreRound, scoreKind, dealerIdx, playerOrder,
  createGame, applyPredictions, applyDraft, applyActuals, undo, abandon,
  getTotals, cumulativeTotals, positions, projection, getRoundKinds, enrich, gameSummary,
  leaderboard, leaderboardView, awards,
  // Records + notities over de tafel; het scorebord toont ze als er geen potje loopt.
  tableFacts: games => {
    const hist = historyOf(games);
    if (!hist) return [];
    return bbStats.recordRows(hist)
      .map(r => ({ icon: r.icon, text: r.title + ': ' + r.text }))
      .concat(bbStats.tableNotes(hist));
  },
  factCandidates, historyCandidates, draftCandidates, pickFact, pickDraftFact, highlights,
  statsView: (games, exclude) => bbStats.statsView(games, exclude, RULES),
  historyOf,
  finishedGames: shared.finishedGames,
  leaderboardPlayers: shared.leaderboardPlayers,
  httpError,
};
