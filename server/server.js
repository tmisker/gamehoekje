// Spellenhoek-server: statische site + spel-API's (boerenbridge, klaverjas) + SSE.
// Zero dependencies — alleen Node-ingebouwde modules. Start: node server/server.js
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const shared = require('./shared.js');
const logic = require('./logic.js');
const klaverjas = require('./klaverjas.js');

const PORT = +(process.env.PORT || 3000);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));

// ---------- opslag ----------

// Eén databestand per spel; elke store houdt zijn eigen lijst potjes bij.
function createStore(filename, notFound) {
  const file = path.join(DATA_DIR, filename);
  const store = {
    file,
    games: [],
    load() {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      if (!fs.existsSync(file)) return;
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Array.isArray(parsed.games)) throw new Error('onverwachte vorm');
        store.games = parsed.games;
      } catch (err) {
        // Nooit crash-loopen op een kapot bestand: opzij zetten en leeg starten.
        const quarantine = file.replace(/\.json$/, '.corrupt-' + Date.now() + '.json');
        fs.renameSync(file, quarantine);
        console.error('FOUT: databestand onleesbaar (' + err.message + '); verplaatst naar ' + quarantine);
      }
    },
    save() {
      // Synchronous + atomische rename: geen half geschreven bestand na een crash.
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ games: store.games }, null, 1));
      fs.renameSync(tmp, file);
    },
    find(id) {
      const game = store.games.find(g => g.id === id);
      if (!game) throw shared.httpError(404, notFound);
      return game;
    },
  };
  return store;
}

const bb = createStore('boerenbridge.json', 'Spel niet gevonden');
const kj = createStore('klaverjas.json', 'Potje niet gevonden');

// Zolang het winnaarscherm blijft staan na een afgerond potje.
const WINNER_WINDOW = 10 * 60 * 1000;

// Snapshot voor display + SSE: laatste actieve potje, anders het potje dat
// < 10 min geleden eindigde (winnaarscherm), anders idle + klassement.
function snapshotOf(store, mod) {
  const byUpdated = (a, b) => (a.updatedAt < b.updatedAt ? 1 : -1);
  const active = store.games.filter(g => g.status === 'active').sort(byUpdated);
  if (active.length) {
    return { game: mod.enrich(active[0]), leaderboard: mod.leaderboard(store.games) };
  }
  const justFinished = store.games
    .filter(g => g.status === 'finished' && Date.now() - Date.parse(g.finishedAt) < WINNER_WINDOW)
    .sort(byUpdated);
  return {
    game: justFinished.length ? mod.enrich(justFinished[0]) : null,
    leaderboard: mod.leaderboard(store.games),
  };
}

// ---------- SSE ----------

// Eén live-kanaal per spel. Bij connect en na elke mutatie gaat de **volledige
// snapshot** over de lijn (nooit deltas).
function createChannel(snapshotFn) {
  const clients = new Set();
  let expiryTimer = null;

  function send(res, payload) {
    res.write('event: state\ndata: ' + JSON.stringify(payload) + '\n\n');
  }

  // Het winnaarscherm valt na 10 min uit de snapshot, maar zonder mutatie komt
  // er geen broadcast — plan er dus zelf één zodra de vervaltijd verstrijkt.
  function scheduleWinnerExpiry(snapshot) {
    if (expiryTimer) { clearTimeout(expiryTimer); expiryTimer = null; }
    const g = snapshot.game;
    if (!g || g.status !== 'finished') return;
    const left = WINNER_WINDOW - (Date.now() - Date.parse(g.finishedAt));
    expiryTimer = setTimeout(broadcast, Math.max(left, 0) + 1000);
    expiryTimer.unref();
  }

  function broadcast() {
    const payload = snapshotFn();
    scheduleWinnerExpiry(payload);
    if (!clients.size) return;
    for (const res of clients) {
      try { send(res, payload); } catch { clients.delete(res); }
    }
  }

  function attach(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // reverse proxy mag SSE niet bufferen
    });
    clients.add(res);
    const snapshot = snapshotFn();
    send(res, snapshot);
    scheduleWinnerExpiry(snapshot);
    req.on('close', () => clients.delete(res));
  }

  // Benoemd event (geen comment): clients kunnen zo zien dat de lijn nog leeft.
  function ping() {
    for (const res of clients) {
      try { res.write('event: ping\ndata: {}\n\n'); } catch { clients.delete(res); }
    }
  }

  return { broadcast, attach, ping };
}

const bbLive = createChannel(() => snapshotOf(bb, logic));
const kjLive = createChannel(() => snapshotOf(kj, klaverjas));

setInterval(() => { bbLive.ping(); kjLive.ping(); }, 25000).unref();

// ---------- HTTP-helpers ----------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    // Buffers verzamelen en één keer decoderen: per-chunk toString() zou een
    // multi-byte UTF-8-teken op een chunkgrens kunnen breken.
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 65536) { reject(logic.httpError(413, 'Body te groot')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const data = Buffer.concat(chunks).toString('utf8');
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(logic.httpError(400, 'Ongeldige JSON')); }
    });
    req.on('error', reject);
  });
}

// ---------- API ----------

async function handleBoerenbridgeApi(req, res, pathname, query) {
  const parts = pathname.split('/').filter(Boolean); // ['api','boerenbridge',...]
  const sub = parts.slice(2);

  if (req.method === 'GET' && sub[0] === 'events' && sub.length === 1) {
    return bbLive.attach(req, res);
  }

  if (req.method === 'GET' && sub[0] === 'current' && sub.length === 1) {
    return sendJson(res, 200, snapshotOf(bb, logic));
  }

  if (req.method === 'GET' && sub[0] === 'leaderboard' && sub.length === 1) {
    // ?exclude=Naam&exclude=Naam of ?exclude=Naam,Naam — potjes met deze
    // spelers tellen niet mee (zie logic.finishedGames).
    const exclude = query.getAll('exclude').flatMap(v => v.split(','));
    return sendJson(res, 200, logic.leaderboardView(bb.games, exclude));
  }

  if (sub[0] === 'games') {
    if (req.method === 'GET' && sub.length === 1) {
      let list = bb.games;
      if (query.get('status')) list = list.filter(g => g.status === query.get('status'));
      list = [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      return sendJson(res, 200, { games: list.map(logic.gameSummary) });
    }
    if (req.method === 'POST' && sub.length === 1) {
      const body = await readBody(req);
      const game = logic.createGame(body.players);
      bb.games.push(game);
      bb.save(); bbLive.broadcast();
      return sendJson(res, 201, logic.enrich(game));
    }
    if (sub.length === 2 && req.method === 'GET') {
      return sendJson(res, 200, logic.enrich(bb.find(sub[1])));
    }
    if (sub.length === 3 && req.method === 'POST') {
      const game = bb.find(sub[1]);
      const body = await readBody(req);
      switch (sub[2]) {
        case 'predictions': logic.applyPredictions(game, body.round, body.predictions); break;
        case 'actuals': logic.applyActuals(game, body.round, body.actuals); break;
        case 'undo': logic.undo(game); break;
        case 'abandon': logic.abandon(game); break;
        default: throw logic.httpError(404, 'Onbekende actie');
      }
      bb.save(); bbLive.broadcast();
      return sendJson(res, 200, logic.enrich(game));
    }
  }

  throw logic.httpError(404, 'Niet gevonden');
}

async function handleKlaverjasApi(req, res, pathname, query) {
  const sub = pathname.split('/').filter(Boolean).slice(2); // na ['api','klaverjas']

  if (req.method === 'GET' && sub[0] === 'events' && sub.length === 1) {
    return kjLive.attach(req, res);
  }

  if (req.method === 'GET' && sub[0] === 'current' && sub.length === 1) {
    return sendJson(res, 200, snapshotOf(kj, klaverjas));
  }

  if (req.method === 'GET' && sub[0] === 'leaderboard' && sub.length === 1) {
    // ?exclude=Naam&exclude=Naam of ?exclude=Naam,Naam — potjes met deze
    // spelers tellen niet mee (zie shared.finishedGames).
    const exclude = query.getAll('exclude').flatMap(v => v.split(','));
    return sendJson(res, 200, klaverjas.leaderboardView(kj.games, exclude));
  }

  if (sub[0] === 'games') {
    if (req.method === 'GET' && sub.length === 1) {
      let list = kj.games;
      if (query.get('status')) list = list.filter(g => g.status === query.get('status'));
      list = [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      return sendJson(res, 200, { games: list.map(klaverjas.gameSummary) });
    }
    if (req.method === 'POST' && sub.length === 1) {
      const body = await readBody(req);
      const game = klaverjas.createGame(body.players);
      kj.games.push(game);
      kj.save(); kjLive.broadcast();
      return sendJson(res, 201, klaverjas.enrich(game));
    }
    if (sub.length === 2 && req.method === 'GET') {
      return sendJson(res, 200, klaverjas.enrich(kj.find(sub[1])));
    }
    if (sub.length === 3 && req.method === 'POST') {
      const game = kj.find(sub[1]);
      const body = await readBody(req);
      switch (sub[2]) {
        case 'start': klaverjas.startRound(game, body.round, body); break;
        case 'round': klaverjas.applyRound(game, body.round, body); break;
        case 'undo': klaverjas.undo(game); break;
        case 'abandon': klaverjas.abandon(game); break;
        default: throw shared.httpError(404, 'Onbekende actie');
      }
      kj.save(); kjLive.broadcast();
      return sendJson(res, 200, klaverjas.enrich(game));
    }
  }

  throw shared.httpError(404, 'Niet gevonden');
}

// ---------- statische bestanden ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

const BLOCKED_PREFIXES = ['/data/', '/.git/', '/server/', '/node_modules/'];

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { error: 'Methode niet toegestaan' });
  }
  if (pathname.includes('\0')) return sendJson(res, 400, { error: 'Ongeldig pad' });
  // toLowerCase: op een case-insensitief bestandssysteem zou /SERVER/ anders
  // langs de blokkade komen.
  const withSlash = (pathname.endsWith('/') ? pathname : pathname + '/').toLowerCase();
  if (BLOCKED_PREFIXES.some(p => withSlash.startsWith(p))) {
    return sendJson(res, 404, { error: 'Niet gevonden' });
  }

  let filePath = path.normalize(path.join(ROOT, pathname));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return sendJson(res, 404, { error: 'Niet gevonden' });
  }
  let stat;
  try { stat = fs.statSync(filePath); } catch { stat = null; }
  if (stat && stat.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    try { stat = fs.statSync(filePath); } catch { stat = null; }
  }
  if (!stat || !stat.isFile()) return sendJson(res, 404, { error: 'Niet gevonden' });

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    // Thuisnetwerk: versheid boven caching, zeker voor HTML.
    'Cache-Control': ext === '.html' ? 'no-cache' : 'max-age=300',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { return sendJson(res, 400, { error: 'Ongeldige URL' }); }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return sendJson(res, 400, { error: 'Ongeldig pad' }); }

  try {
    if (pathname.startsWith('/api/boerenbridge/')) {
      await handleBoerenbridgeApi(req, res, pathname, url.searchParams);
    } else if (pathname.startsWith('/api/klaverjas/')) {
      await handleKlaverjasApi(req, res, pathname, url.searchParams);
    } else {
      serveStatic(req, res, pathname);
    }
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) sendJson(res, status, { error: err.status ? err.message : 'Serverfout' });
    else res.end();
  }
});

// Node ≥18 kapt anders long-lived responses (SSE) na 5 minuten af.
server.requestTimeout = 0;

bb.load();
kj.load();
server.listen(PORT, () => {
  console.log('Spellenhoek draait op http://localhost:' + PORT + ' (data: ' + DATA_DIR + ')');
});
