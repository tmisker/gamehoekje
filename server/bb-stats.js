// Statistiek over meerdere boerenbridge-potjes: per speler, per ronde-type,
// onderling, en records. Puur (geen I/O); ook los te testen.
//
// De spelregels blijven in logic.js. Die geeft ze mee via `rules`
// ({ getRoundKinds, playerOrder, cumulativeTotals }), zodat de scoreformule en
// de kleurclassificatie hier niet worden gedupliceerd — dit bestand telt
// alleen, het rekent geen score uit.
'use strict';

const shared = require('./shared.js');
const { nameKey } = shared;

const WEEKDAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];

function emptyPlayer(name) {
  return {
    name, key: nameKey(name),
    games: 0, wins: 0, shared: 0,
    rounds: 0, exact: 0, over: 0, under: 0,
    zerosAsked: 0, zerosMade: 0, bestStreak: 0,
    totals: [], bestScore: -Infinity, worstScore: Infinity,
    bestRound: null, worstRound: null,
    byCards: new Map(),        // kaartaantal -> {rounds, exact, asks: Map(waarde -> {count, made})}
    bySuit: new Map(),         // troefindex -> {rounds, exact}
    cumByRound: [],            // per ronde-index {sum, count}: gemiddelde stand op dat punt
    maxAsk: -1,                // hoogste aantal dat deze speler ooit vroeg
    firstHalf: 0, secondHalf: 0,
    askIndexSum: 0,            // som van (gevraagd / eerlijk deel); /rounds = durf
    early: { rounds: 0, exact: 0 },  // als eerste aan de beurt om te voorspellen
    late: { rounds: 0, exact: 0 },   // als laatste (de deler)
    lastPlayed: 0,
  };
}

function bucket(map, key, make) {
  let e = map.get(key);
  if (!e) { e = make(); map.set(key, e); }
  return e;
}

// Wie er na ronde r aan kop staat (gelijke totalen delen de kop).
function leadersAfter(cum, r) {
  const row = cum[r];
  const max = Math.max(...row);
  return row.map((t, i) => (t === max ? i : -1)).filter(i => i >= 0);
}

// Eén pass over alle afgeronde potjes. Alles wat de weetjes en de
// statistiekpagina nodig hebben komt hieruit.
function collect(finished, rules) {
  const players = new Map();
  const byCards = new Map();   // kaartaantal -> {rounds (spelersrondes), exact, askDiff, dealt}
  const bySuit = new Map();    // troefindex -> {rounds, exact}
  const pairs = new Map();     // "a|b" -> {a, b, games, winsA, winsB, shared}
  const weekdays = new Array(7).fill(0);
  const halfway = { games: 0, leaderWon: 0 };
  const durations = [];
  const records = {
    topScore: null, lowScore: null, bestRound: null, worstRound: null,
    widest: null, closest: null, longestStreak: null,
  };

  for (const game of finished) {
    const P = game.players, n = P.length;
    const kinds = rules.getRoundKinds(game);
    const cum = rules.cumulativeTotals(game);
    const played = game.roundScores.length;
    if (!played) continue;
    const totals = cum[played - 1];
    const winners = game.winnerIdxs || [];
    const at = Date.parse(game.finishedAt || game.createdAt) || 0;
    if (at) weekdays[new Date(at).getDay()]++;
    const ms = Date.parse(game.finishedAt) - Date.parse(game.createdAt);
    if (ms >= 5 * 60000 && ms <= 6 * 3600000) durations.push({ ms, players: P.slice(), at });

    // Marges: hoe ruim won de winnaar van de nummer twee?
    const best = Math.max(...totals);
    const rest = totals.filter(t => t !== best);
    if (rest.length) {
      const margin = best - Math.max(...rest);
      const who = P[totals.indexOf(best)];
      const entry = { margin, name: who, score: best, at, players: P.slice() };
      if (!records.widest || margin > records.widest.margin) records.widest = entry;
      if (!records.closest || margin < records.closest.margin) records.closest = entry;
    }

    // Koploper na de 1-kaartronde: voorspelt die de winst?
    const half = game.rounds.findIndex(r => r.cards === 1);
    if (half >= 0 && half < played) {
      const lead = leadersAfter(cum, half);
      if (lead.length === 1) {
        halfway.games++;
        if (winners.includes(lead[0])) halfway.leaderWon++;
      }
    }

    P.forEach((name, i) => {
      const p = bucket(players, nameKey(name), () => emptyPlayer(name));
      p.name = name;                       // recentste schrijfwijze wint
      if (at >= p.lastPlayed) p.lastPlayed = at;
      p.games++;
      if (winners.includes(i)) { p.wins++; if (winners.length > 1) p.shared++; }
      p.totals.push(totals[i]);
      if (totals[i] > p.bestScore) p.bestScore = totals[i];
      if (totals[i] < p.worstScore) p.worstScore = totals[i];

      let streak = 0;
      for (let r = 0; r < played; r++) {
        const kind = kinds[r][i];
        if (!kind) continue;
        const cards = game.rounds[r].cards;
        const suit = game.rounds[r].suitIdx;
        const pred = game.predictions[r][i];
        const score = game.roundScores[r][i];

        p.rounds++;
        p[kind]++;
        streak = kind === 'exact' ? streak + 1 : 0;
        if (streak > p.bestStreak) p.bestStreak = streak;
        if (pred === 0) { p.zerosAsked++; if (game.actuals[r][i] === 0) p.zerosMade++; }
        p.askIndexSum += (pred * n) / cards;      // 1 = precies het eerlijke deel
        if (r <= half || half < 0) p.firstHalf += score; else p.secondHalf += score;

        const pc = bucket(p.byCards, cards, () => ({ rounds: 0, exact: 0, asks: new Map() }));
        pc.rounds++;
        if (kind === 'exact') pc.exact++;
        const ask = bucket(pc.asks, pred, () => ({ count: 0, made: 0 }));
        ask.count++;
        if (kind === 'exact') ask.made++;
        if (pred > p.maxAsk) p.maxAsk = pred;
        const cb = p.cumByRound[r] || (p.cumByRound[r] = { sum: 0, count: 0 });
        cb.sum += cum[r][i];
        cb.count++;
        const ps = bucket(p.bySuit, suit, () => ({ rounds: 0, exact: 0 }));
        ps.rounds++;
        if (kind === 'exact') ps.exact++;

        // Als eerste of als laatste (deler) voorspellen.
        const order = rules.playerOrder(n, r);
        const slot = order[0] === i ? p.early : order[n - 1] === i ? p.late : null;
        if (slot) { slot.rounds++; if (kind === 'exact') slot.exact++; }

        const roundRec = { name, score, cards, round: r + 1, at, players: P.slice() };
        if (!p.bestRound || score > p.bestRound.score) p.bestRound = roundRec;
        if (!p.worstRound || score < p.worstRound.score) p.worstRound = roundRec;
        if (!records.bestRound || score > records.bestRound.score) records.bestRound = roundRec;
        if (!records.worstRound || score < records.worstRound.score) records.worstRound = roundRec;
      }
      const scoreRec = { name, score: totals[i], at, players: P.slice() };
      if (!records.topScore || scoreRec.score > records.topScore.score) records.topScore = scoreRec;
      if (!records.lowScore || scoreRec.score < records.lowScore.score) records.lowScore = scoreRec;
      if (!records.longestStreak || p.bestStreak > records.longestStreak.streak) {
        records.longestStreak = { name, streak: p.bestStreak };
      }
    });

    // Per ronde-type: hoeveel van de tafel zat goed, en vroeg de tafel te veel?
    for (let r = 0; r < played; r++) {
      const cards = game.rounds[r].cards;
      // `rounds` telt spelersrondes (noemer voor het percentage), `dealt` telt
      // hoe vaak dit kaartaantal aan tafel lag (noemer voor "samen gevraagd").
      const c = bucket(byCards, cards, () => ({ cards, rounds: 0, exact: 0, askDiff: 0, dealt: 0 }));
      c.rounds += n;
      c.exact += kinds[r].filter(k => k === 'exact').length;
      c.askDiff += game.predictions[r].reduce((a, b) => a + b, 0) - cards;
      c.dealt++;
      const s = bucket(bySuit, game.rounds[r].suitIdx, () => ({ rounds: 0, exact: 0 }));
      s.rounds += n;
      s.exact += kinds[r].filter(k => k === 'exact').length;
    }

    // Onderling: per paar aan tafel wie er won. De sleutel is het gesorteerde
    // namenpaar, zodat dezelfde twee altijd op dezelfde plek terechtkomen.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const flip = nameKey(P[j]) < nameKey(P[i]);
        const [x, y] = flip ? [j, i] : [i, j];   // x = kant A, y = kant B
        const key = nameKey(P[x]) + '|' + nameKey(P[y]);
        const e = bucket(pairs, key, () => ({ a: P[x], b: P[y], games: 0, winsA: 0, winsB: 0, neither: 0 }));
        e.a = P[x];
        e.b = P[y];
        e.games++;
        const xWon = winners.includes(x), yWon = winners.includes(y);
        if (xWon && !yWon) e.winsA++;
        else if (yWon && !xWon) e.winsB++;
        else e.neither++;
      }
    }
  }
  return { players, byCards, bySuit, pairs, weekdays, halfway, durations, records, games: finished.length };
}

const pct = (part, whole) => (whole ? Math.round((100 * part) / whole) : 0);
const round1 = v => Math.round(v * 10) / 10;
// Nederlandse notatie voor tekst die de server zelf formuleert.
const num = v => String(round1(v)).replace('.', ',');
function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' en ' + names[names.length - 1];
}

// Spreiding van de eindscores: hoe wisselvallig is iemand?
function stdev(values) {
  if (values.length < 3) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return round1(Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length));
}

// De vaakst gevraagde waarde bij een kaartaantal, mits het echt een gewoonte is.
function favouriteAsk(entry) {
  if (!entry || entry.rounds < 5) return null;
  let best = null;
  for (const [value, e] of entry.asks) {
    if (!best || e.count > best.count) best = { value, count: e.count, made: e.made };
  }
  return best && best.count / entry.rounds >= 0.5 ? best : null;
}

// Rij per speler voor de statistiekpagina.
function playerRows(hist) {
  return [...hist.players.values()].map(p => ({
    name: p.name,
    games: p.games,
    wins: p.wins,
    sharedWins: p.shared,
    winPct: pct(p.wins, p.games),
    avgPoints: round1(p.totals.reduce((a, b) => a + b, 0) / p.games),
    bestScore: p.bestScore,
    worstScore: p.worstScore,
    spread: stdev(p.totals),
    rounds: p.rounds,
    exact: p.exact, over: p.over, under: p.under,
    exactPct: pct(p.exact, p.rounds),
    overPct: pct(p.over, p.rounds),
    underPct: pct(p.under, p.rounds),
    zerosAsked: p.zerosAsked, zerosMade: p.zerosMade,
    bestStreak: p.bestStreak,
    ask: p.rounds ? round1(p.askIndexSum / p.rounds) : 0,
    firstHalf: p.firstHalf, secondHalf: p.secondHalf,
    bestRound: p.bestRound && p.bestRound.score,
    worstRound: p.worstRound && p.worstRound.score,
    earlyPct: p.early.rounds >= 8 ? pct(p.early.exact, p.early.rounds) : null,
    latePct: p.late.rounds >= 8 ? pct(p.late.exact, p.late.rounds) : null,
    byCards: [...p.byCards.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([cards, e]) => ({ cards, rounds: e.rounds, exact: e.exact, exactPct: pct(e.exact, e.rounds) })),
  })).sort((a, b) => b.exactPct - a.exactPct || b.wins - a.wins || a.name.localeCompare(b.name, 'nl'));
}

function cardRows(hist) {
  return [...hist.byCards.values()]
    .sort((a, b) => a.cards - b.cards)
    .map(c => ({
      cards: c.cards, rounds: c.rounds, exactPct: pct(c.exact, c.rounds),
      askDiff: c.dealt ? round1(c.askDiff / c.dealt) : 0,
    }));
}

function suitRows(hist, names) {
  return [...hist.bySuit.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idx, e]) => ({ suitIdx: idx, name: names[idx], rounds: e.rounds, exactPct: pct(e.exact, e.rounds) }));
}

function pairRows(hist) {
  return [...hist.pairs.values()]
    .filter(p => p.games >= 3)
    .sort((a, b) => b.games - a.games || b.winsA + b.winsB - (a.winsA + a.winsB))
    .map(p => ({ a: p.a, b: p.b, games: p.games, winsA: p.winsA, winsB: p.winsB }));
}

function formatDuration(ms) {
  const min = Math.round(ms / 60000);
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return m + ' min';
  return h + ' uur' + (m ? ' ' + m + ' min' : '');
}

const cardsTxt = c => c + (c === 1 ? ' kaart' : ' kaarten');

// Records als kant-en-klare regels; de pagina toont ze alleen.
function recordRows(hist) {
  const r = hist.records, out = [];
  const add = (icon, title, text) => out.push({ icon, title, text });
  if (r.topScore) add('🏆', 'Hoogste eindscore', r.topScore.name + ' — ' + r.topScore.score + ' punten');
  if (r.lowScore) add('🧊', 'Laagste eindscore', r.lowScore.name + ' — ' + r.lowScore.score + ' punten');
  if (r.bestRound) {
    add('🚀', 'Beste ronde', r.bestRound.name + ' — +' + r.bestRound.score
      + ' bij ' + cardsTxt(r.bestRound.cards));
  }
  if (r.worstRound && r.worstRound.score <= -2) {
    add('💥', 'Zwaarste klap', r.worstRound.name + ' — ' + r.worstRound.score
      + ' bij ' + cardsTxt(r.worstRound.cards));
  }
  if (r.longestStreak && r.longestStreak.streak >= 3) {
    add('🔥', 'Langste reeks', r.longestStreak.name + ' — ' + r.longestStreak.streak + ' rondes op rij precies');
  }
  if (r.widest) add('📏', 'Ruimste winst', r.widest.name + ' — ' + r.widest.margin + ' punten voorsprong');
  if (r.closest) add('😬', 'Nipste winst', r.closest.name + ' — ' + r.closest.margin + ' punten voorsprong');
  const d = hist.durations;
  if (d.length >= 3) {
    const fast = d.reduce((a, b) => (b.ms < a.ms ? b : a));
    const slow = d.reduce((a, b) => (b.ms > a.ms ? b : a));
    add('⚡', 'Snelste potje', formatDuration(fast.ms));
    add('🐌', 'Langste potje', formatDuration(slow.ms));
  }
  return out;
}

// Losse weetjes over de tafel als geheel.
function tableNotes(hist) {
  const out = [];
  const add = (icon, text) => out.push({ icon, text });
  const cards = cardRows(hist).filter(c => c.rounds >= 12);
  if (cards.length >= 3) {
    const hard = cards.reduce((a, b) => (b.exactPct < a.exactPct ? b : a));
    const easy = cards.reduce((a, b) => (b.exactPct > a.exactPct ? b : a));
    if (hard.cards !== easy.cards) {
      add('😤', 'Moeilijkst is ' + cardsTxt(hard.cards) + ': ' + hard.exactPct
        + '% van de tafel zit goed. Makkelijkst is ' + cardsTxt(easy.cards) + ' met ' + easy.exactPct + '%.');
    }
  }
  if (hist.halfway.games >= 3) {
    add('⏱️', 'De koploper na de 1-kaartronde won ' + hist.halfway.leaderWon
      + ' van de ' + hist.halfway.games + ' potjes.');
  }
  const all = cardRows(hist);
  const totalDiff = all.reduce((a, c) => a + c.askDiff, 0);
  if (all.length >= 5) {
    const avg = round1(totalDiff / all.length);
    add('🗣️', avg > 0.2 ? 'De tafel vraagt gemiddeld ' + num(avg) + ' slag te veel per ronde.'
      : avg < -0.2 ? 'De tafel vraagt gemiddeld ' + num(-avg) + ' slag te weinig per ronde.'
        : 'De tafel vraagt gemiddeld precies rond.');
  }
  // Alleen als er echt een vaste avond is: hoogste dag, door hooguit twee dagen
  // gedeeld, en samen minstens een derde van alle potjes.
  const days = hist.weekdays;
  const top = Math.max(...days);
  const busiest = days.map((c, i) => (c === top ? i : -1)).filter(i => i >= 0);
  if (hist.games >= 6 && top >= 2 && busiest.length <= 2 && top * busiest.length >= hist.games / 3) {
    add('📅', 'Er wordt het vaakst op ' + joinNames(busiest.map(i => WEEKDAYS[i]))
      + ' gespeeld (' + top * busiest.length + ' van de ' + hist.games + ' potjes).');
  }
  return out;
}

// Volledige payload voor /stats.
function statsView(games, exclude, rules) {
  const counted = shared.finishedGames(games, exclude);
  const hist = collect(counted, rules);
  return {
    players: shared.leaderboardPlayers(games),
    excluded: shared.leaderboardPlayers(games).filter(n => shared.excludeSet(exclude).has(nameKey(n))),
    gamesCounted: counted.length,
    gamesTotal: shared.finishedGames(games).length,
    rows: playerRows(hist),
    byCards: cardRows(hist),
    bySuit: suitRows(hist, rules.suitNames),
    pairs: pairRows(hist),
    records: recordRows(hist),
    notes: tableNotes(hist),
  };
}

module.exports = {
  collect, statsView, playerRows, cardRows, suitRows, pairRows, recordRows, tableNotes,
  favouriteAsk, formatDuration, cardsTxt, joinNames, stdev, pct, num, leadersAfter, WEEKDAYS,
};
