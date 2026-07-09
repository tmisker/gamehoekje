// Spellenhoek-server: statische site + boerenbridge-API + SSE.
// Zero dependencies — alleen Node-ingebouwde modules. Start: node server/server.js
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const logic = require('./logic.js');

const PORT = +(process.env.PORT || 3000);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DATA_FILE = path.join(DATA_DIR, 'boerenbridge.json');

// ---------- opslag ----------

let games = [];

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(parsed.games)) throw new Error('onverwachte vorm');
    games = parsed.games;
  } catch (err) {
    // Nooit crash-loopen op een kapot bestand: opzij zetten en leeg starten.
    const quarantine = DATA_FILE.replace(/\.json$/, '.corrupt-' + Date.now() + '.json');
    fs.renameSync(DATA_FILE, quarantine);
    console.error('FOUT: databestand onleesbaar (' + err.message + '); verplaatst naar ' + quarantine);
  }
}

function save() {
  // Synchronous + atomische rename: geen half geschreven bestand na een crash.
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ games }, null, 1));
  fs.renameSync(tmp, DATA_FILE);
}

function findGame(id) {
  const game = games.find(g => g.id === id);
  if (!game) throw logic.httpError(404, 'Spel niet gevonden');
  return game;
}

// Snapshot voor display + SSE: laatste actieve spel, anders het spel dat
// < 10 min geleden eindigde (winnaarscherm), anders idle + leaderboard.
function currentSnapshot() {
  const byUpdated = (a, b) => (a.updatedAt < b.updatedAt ? 1 : -1);
  const active = games.filter(g => g.status === 'active').sort(byUpdated);
  if (active.length) return { game: logic.enrich(active[0]), leaderboard: logic.leaderboard(games) };
  const justFinished = games
    .filter(g => g.status === 'finished' && Date.now() - Date.parse(g.finishedAt) < 10 * 60 * 1000)
    .sort(byUpdated);
  return {
    game: justFinished.length ? logic.enrich(justFinished[0]) : null,
    leaderboard: logic.leaderboard(games),
  };
}

// ---------- SSE ----------

const sseClients = new Set();

function sseSend(res, payload) {
  res.write('event: state\ndata: ' + JSON.stringify(payload) + '\n\n');
}

function broadcast() {
  if (!sseClients.size) return;
  const payload = currentSnapshot();
  for (const res of sseClients) {
    try { sseSend(res, payload); } catch { sseClients.delete(res); }
  }
}

// Benoemd event (geen comment): clients kunnen zo zien dat de lijn nog leeft.
setInterval(() => {
  for (const res of sseClients) {
    try { res.write('event: ping\ndata: {}\n\n'); } catch { sseClients.delete(res); }
  }
}, 25000).unref();

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
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 65536) { reject(logic.httpError(413, 'Body te groot')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(logic.httpError(400, 'Ongeldige JSON')); }
    });
    req.on('error', reject);
  });
}

// ---------- API ----------

async function handleApi(req, res, pathname, query) {
  const parts = pathname.split('/').filter(Boolean); // ['api','boerenbridge',...]
  const sub = parts.slice(2);

  if (req.method === 'GET' && sub[0] === 'events' && sub.length === 1) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // reverse proxy mag SSE niet bufferen
    });
    sseClients.add(res);
    sseSend(res, currentSnapshot());
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (req.method === 'GET' && sub[0] === 'current' && sub.length === 1) {
    return sendJson(res, 200, currentSnapshot());
  }

  if (req.method === 'GET' && sub[0] === 'leaderboard' && sub.length === 1) {
    return sendJson(res, 200, { leaderboard: logic.leaderboard(games) });
  }

  if (sub[0] === 'games') {
    if (req.method === 'GET' && sub.length === 1) {
      let list = games;
      if (query.get('status')) list = list.filter(g => g.status === query.get('status'));
      list = [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      return sendJson(res, 200, { games: list.map(logic.gameSummary) });
    }
    if (req.method === 'POST' && sub.length === 1) {
      const body = await readBody(req);
      const game = logic.createGame(body.players);
      games.push(game);
      save(); broadcast();
      return sendJson(res, 201, logic.enrich(game));
    }
    if (sub.length === 2 && req.method === 'GET') {
      return sendJson(res, 200, logic.enrich(findGame(sub[1])));
    }
    if (sub.length === 3 && req.method === 'POST') {
      const game = findGame(sub[1]);
      const body = await readBody(req);
      switch (sub[2]) {
        case 'predictions': logic.applyPredictions(game, body.round, body.predictions); break;
        case 'actuals': logic.applyActuals(game, body.round, body.actuals); break;
        case 'undo': logic.undo(game); break;
        case 'abandon': logic.abandon(game); break;
        default: throw logic.httpError(404, 'Onbekende actie');
      }
      save(); broadcast();
      return sendJson(res, 200, logic.enrich(game));
    }
  }

  throw logic.httpError(404, 'Niet gevonden');
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
  const withSlash = pathname.endsWith('/') ? pathname : pathname + '/';
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
      await handleApi(req, res, pathname, url.searchParams);
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

load();
server.listen(PORT, () => {
  console.log('Spellenhoek draait op http://localhost:' + PORT + ' (data: ' + DATA_FILE + ')');
});
