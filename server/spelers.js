// Spelers die een voornaam delen, zoals "Ilse B." en "Ilse de V.".
// De volledige naam is overal de sleutel: klassement, statistiek en weetjes
// koppelen op naam, dus zo houdt ieder haar eigen scores. Dit lijstje regelt
// de rest, voor alle spellen tegelijk:
//  - een kale voornaam is bij de start (of een wissel) niet genoeg: de server
//    weigert en vraagt welke van de twee (`check`);
//  - de naamsuggesties tonen de volledige namen naast elkaar (`withGroups`);
//  - aan tafel heet je gewoon "Ilse" zolang er maar één Ilse meedoet
//    (`tableLabels` + `relabel`, aan de rand van elke potje-response);
//  - oude potjes met een kale voornaam zijn achteraf toe te wijzen (`assign`).
// Puur; geen I/O. server.js bewaart de groepen in data/spelers.json.
'use strict';

const { httpError, nameKey } = require('./shared.js');

const MAX_NAME = 40;

const clean = s => String(s == null ? '' : s).trim();
const orList = names => names.slice(0, -1).join(', ') + ' of ' + names[names.length - 1];

// De groep waar een naam bij hoort: als kale voornaam of als volledige naam.
function groupOf(name, groups) {
  const key = nameKey(name);
  return groups.find(g => nameKey(g.first) === key || g.names.some(n => nameKey(n) === key)) || null;
}

// Groep toevoegen of vervangen (op voornaam); zonder namen gaat hij weg.
// Geeft de nieuwe lijst terug, het origineel blijft ongemoeid.
function setGroup(groups, input) {
  const first = clean(input && input.first);
  if (!first) throw httpError(400, 'Vul een voornaam in');
  if (first.length > MAX_NAME) throw httpError(400, 'Naam te lang (max ' + MAX_NAME + ' tekens)');
  const others = groups.filter(g => nameKey(g.first) !== nameKey(first));
  const names = (Array.isArray(input.names) ? input.names : []).map(clean).filter(Boolean);
  if (!names.length) return others;
  if (names.length < 2) throw httpError(400, 'Vul minstens twee namen in');
  if (new Set(names.map(nameKey)).size !== names.length) {
    throw httpError(400, 'Elke ' + first + ' heeft een eigen naam nodig');
  }
  for (const n of names) {
    if (n.length > MAX_NAME) throw httpError(400, 'Naam te lang (max ' + MAX_NAME + ' tekens)');
    // Aan tafel valt alles na de voornaam weg; dan moet hij er ook mee beginnen.
    if (!nameKey(n).startsWith(nameKey(first) + ' ')) {
      throw httpError(400, n + ' begint niet met ' + first);
    }
  }
  const mine = new Set([first, ...names].map(nameKey));
  const clash = others.find(g => [g.first, ...g.names].some(n => mine.has(nameKey(n))));
  if (clash) throw httpError(400, 'Die naam staat al bij ' + clash.first);
  return [...others, { first, names }].sort((a, b) => a.first.localeCompare(b.first, 'nl'));
}

// Inhoud van data/spelers.json controleren; gooit bij een onverwachte vorm.
function parseGroups(list) {
  if (!Array.isArray(list)) throw new Error('onverwachte vorm');
  return list.reduce(setGroup, []);
}

// Staat er een kale dubbele voornaam tussen? Dan moet de pagina vragen welke
// er bedoeld is: de fout draagt `ask` mee met de keuzes.
function check(names, groups) {
  if (!Array.isArray(names)) return;
  for (const [index, name] of names.entries()) {
    const g = groups.find(x => nameKey(x.first) === nameKey(name));
    if (!g) continue;
    const err = httpError(400, 'Welke ' + g.first + '? Kies ' + orList(g.names));
    err.ask = { index, name: clean(name), first: g.first, choices: g.names };
    throw err;
  }
}

// Naamsuggesties met de dubbele voornamen erin: een kale "Ilse" uit oude
// potjes wordt de volledige namen, en wie een voornaam deelt staat naast
// elkaar. Groepen die in dit spel nog nooit meededen blijven weg; typt iemand
// de voornaam, dan vraagt `check` het alsnog.
function withGroups(suggestions, groups) {
  const out = [];
  const seen = new Set();
  const add = n => {
    if (seen.has(nameKey(n))) return;
    seen.add(nameKey(n));
    out.push(n);
  };
  for (const name of suggestions) {
    const g = groupOf(name, groups);
    if (g) g.names.forEach(add);
    else add(name);
  }
  return out;
}

// Iedereen die in dit potje meedoet of meedeed: de huidige bewoners plus wie
// er bij een wissel (boerenbridge) van stoel ging of op kwam.
function seated(game) {
  const names = [...game.players];
  for (const s of game.swaps || []) names.push(s.from, s.to);
  return names;
}

// Wie aan deze tafel de enige van zijn voornaam is, heet bij die voornaam.
// Geeft [volledige naam, voornaam]-paren; leeg = niets in te korten.
function tableLabels(names, groups) {
  const pairs = [];
  for (const g of groups) {
    const here = new Map();
    for (const n of names) if (groupOf(n, [g])) here.set(nameKey(n), n);
    if (here.size !== 1) continue;
    const [key, name] = [...here][0];
    if (key !== nameKey(g.first)) pairs.push([name, g.first]);
  }
  return pairs;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Een kopie van de view met de volledige namen vervangen door de voornaam,
// ook midden in teksten (weetjes, hoogtepunten, teamnamen). Het opgeslagen
// potje blijft zoals het is.
function relabel(view, pairs) {
  if (!pairs.length) return view;
  const to = new Map(pairs.map(([name, first]) => [nameKey(name), first]));
  const re = new RegExp('(?<![\\p{L}\\p{N}])(?:' + pairs.map(([name]) => escapeRe(name)).join('|')
    + ')(?![\\p{L}\\p{N}])', 'giu');
  const walk = v => {
    if (typeof v === 'string') return v.replace(re, m => to.get(nameKey(m)));
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return walk(view);
}

// Wie in dit potje speelde: de kale voornaam (of een eerder toegewezen naam,
// om een vergissing recht te zetten) wordt `to`. Namen staan in `players` en
// bij boerenbridge ook in de wissels.
function assign(game, from, to, groups) {
  const g = groups.find(x => x.names.some(n => nameKey(n) === nameKey(to)));
  if (!g) throw httpError(400, 'Onbekende naam');
  const target = g.names.find(n => nameKey(n) === nameKey(to));
  if (groupOf(from, [g]) === null) throw httpError(400, from + ' hoort niet bij ' + g.first);
  const names = seated(game);
  if (!names.some(n => nameKey(n) === nameKey(from))) throw httpError(409, from + ' speelt niet mee in dit potje');
  if (names.some(n => nameKey(n) === nameKey(target))) throw httpError(409, target + ' speelt al mee in dit potje');
  const fix = n => (nameKey(n) === nameKey(from) ? target : n);
  game.players = game.players.map(fix);
  for (const s of game.swaps || []) {
    s.from = fix(s.from);
    s.to = fix(s.to);
  }
}

// Potjes waarin nog een kale dubbele voornaam staat (afgebroken potjes tellen
// nergens mee en blijven weg): [{game, first}].
function unassigned(games, groups) {
  const out = [];
  for (const game of games) {
    if (game.status === 'abandoned') continue;
    const keys = new Set(seated(game).map(nameKey));
    for (const g of groups) if (keys.has(nameKey(g.first))) out.push({ game, first: g.first });
  }
  return out;
}

module.exports = {
  groupOf, setGroup, parseGroups, check, withGroups, seated, tableLabels, relabel, assign, unassigned,
};
