// Dobbelsteenherkenning van de yahtzee-pagina. Run: node test/yahtzee-vision.test.js
// Draait zonder server en zonder browser: het <script id="dice-vision">-blok
// komt rechtstreeks uit games/yahtzee/index.html en krijgt synthetische
// camerabeelden (witte stenen met zwarte ogen op een donkere bak) met een
// bekende uitkomst. Dat test het rekenwerk, niet een echte camera: licht,
// lens en stenen in het echt zijn altijd rommeliger.
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'games', 'yahtzee', 'index.html'), 'utf8');
const block = html.match(/<script id="dice-vision">([\s\S]*?)<\/script>/);
assert.ok(block, 'dice-vision-blok in de pagina');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(block[1], sandbox);
const V = sandbox.module.exports;

// ---- synthetische beelden ----

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Ogen in eenheden van een kwart zijde vanuit het midden.
const LAYOUT = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

// Opties: n stenen met zijde `side` (px), `touch` = zoveel stenen op een rij
// tegen elkaar aan (met `gap` × zijde tussen de middens), `blur`, `noise`,
// `gradient` (lamp aan één kant), `shadow` (over een steen), `highlight`
// (glimlicht), `paper` (licht vlak zonder ogen), `edge` (een steen half uit beeld).
function render(opts) {
  const o = Object.assign({ w: 640, h: 480, side: [26, 44], n: 5, touch: 0, gap: 1, noise: 12, pipR: 0.09,
    gradient: 40, bg: 45, face: 215, pip: 35, blur: 0, shadow: 0, highlight: false, paper: false,
    edge: false, seed: 1 }, opts);
  const rand = rng(o.seed);
  const { w, h } = o;
  const side = o.side[0] + rand() * (o.side[1] - o.side[0]);
  const dice = [];
  for (let tries = 0; dice.length < o.n && tries < 5000; tries++) {
    if (o.touch > 1 && dice.length >= 1 && dice.length < o.touch) {
      const p = dice[dice.length - 1];
      const cx = p.cx + Math.cos(p.ang) * side * o.gap, cy = p.cy + Math.sin(p.ang) * side * o.gap;
      if (cx < side || cy < side || cx > w - side || cy > h - side) { dice.length = 0; continue; }
      dice.push({ cx, cy, ang: p.ang, value: 1 + Math.floor(rand() * 6) });
      continue;
    }
    const ang = rand() * Math.PI / 2;
    const cx = side + rand() * (w - 2 * side), cy = side + rand() * (h - 2 * side);
    if (dice.some(d => Math.hypot(d.cx - cx, d.cy - cy) < side * 1.6)) continue;
    if (o.paper && cx < 260 && cy < 140) continue;
    dice.push({ cx, cy, ang, value: 1 + Math.floor(rand() * 6) });
  }
  const shapes = dice.slice();
  if (o.edge) shapes.push({ cx: w - side * 0.2, cy: h / 2, ang: 0.3, value: 6 });
  const data = new Uint8ClampedArray(w * h * 4);
  const gx = (rand() - 0.5) * 2, gy = (rand() - 0.5) * 2;
  const half = side / 2, corner = side * 0.12, pr = side * o.pipR, off = side * 0.27, reach = (side * 0.75) ** 2;
  const SS = 2; // supersampling voor zachte randen
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
        let v = o.bg + o.gradient * ((px / w - 0.5) * gx + (py / h - 0.5) * gy);
        if (o.paper && px > 20 && px < 240 && py > 20 && py < 120) v = 235;
        for (const d of shapes) {
          const dx = px - d.cx, dy = py - d.cy;
          if (dx * dx + dy * dy > reach) continue;
          const c = Math.cos(-d.ang), s = Math.sin(-d.ang);
          const u = dx * c - dy * s, t = dx * s + dy * c;
          const au = Math.abs(u), at = Math.abs(t);
          if (au > half || at > half) continue;
          if (au > half - corner && at > half - corner
            && Math.hypot(au - (half - corner), at - (half - corner)) > corner) continue;
          v = o.face - 25 * Math.max(au, at) / half;
          if (o.shadow) v -= o.shadow * Math.max(0, u / half);
          if (o.highlight && Math.hypot(u + half * 0.3, t + half * 0.35) < side * 0.12) v = 255;
          for (const [lu, lt] of LAYOUT[d.value]) {
            if (Math.hypot(u - lu * off, t - lt * off) < pr) { v = o.pip; break; }
          }
          break;
        }
        acc += v;
      }
      const v = acc / (SS * SS) + (rand() - 0.5) * 2 * o.noise;
      const i = (y * w + x) * 4;
      data[i] = v + 4; data[i + 1] = v; data[i + 2] = v - 6; data[i + 3] = 255;
    }
  }
  if (o.blur) boxBlur(data, w, h, o.blur);
  return { img: { data, width: w, height: h }, values: dice.map(d => d.value).sort() };
}

function boxBlur(data, w, h, r) {
  const g = new Float32Array(w * h), tmp = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = data[i * 4 + 1];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) if (x + k >= 0 && x + k < w) { s += g[y * w + x + k]; n++; }
    tmp[y * w + x] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) if (y + k >= 0 && y + k < h) { s += tmp[(y + k) * w + x]; n++; }
    const i = (y * w + x) * 4, v = s / n;
    data[i] = v + 4; data[i + 1] = v; data[i + 2] = v - 6;
  }
}

const seen = r => r.dice.map(d => d.value || '?').sort().join('');

// ---- herkenning ----

const N = +(process.env.N_VISION || 25);
const SCENARIOS = [
  ['basis', {}, 1],
  ['kleine stenen (18–24 px)', { side: [18, 24] }, 0.96],
  ['grote stenen (50–70 px)', { side: [50, 70] }, 1],
  ['veel ruis', { noise: 25 }, 0.96],
  ['lamp aan één kant', { gradient: 90 }, 1],
  ['lichtere bak', { bg: 110 }, 1],
  ['onscherp', { blur: 1 }, 0.96],
  ['flink onscherp', { blur: 2 }, 0.92],
  ['flauwe ogen', { pip: 110 }, 0.92],
  ['grauwe stenen', { face: 150 }, 0.96],
  ['schaduw over een steen', { shadow: 60 }, 0.96],
  ['glimlicht', { highlight: true }, 0.96],
  ['grote ogen', { pipR: 0.11 }, 0.96],
  ['twee tegen elkaar', { touch: 2 }, 0.92],
  ['drie tegen elkaar', { touch: 3 }, 0.88],
  ['twee bijna tegen elkaar', { touch: 2, gap: 1.05 }, 0.92],
  ['papiertje in beeld', { paper: true }, 0.96],
];

let slowest = 0;
for (const [name, opts, need] of SCENARIOS) {
  let ok = 0;
  const misses = [];
  for (let i = 0; i < N; i++) {
    const { img, values } = render(Object.assign({ seed: 7000 + i }, opts));
    const t0 = process.hrtime.bigint();
    const r = V.detect(img);
    slowest = Math.max(slowest, Number(process.hrtime.bigint() - t0) / 1e6);
    if (seen(r) === values.join('')) ok++;
    else if (misses.length < 3) misses.push(values.join('') + '→' + seen(r));
  }
  const rate = ok / N;
  console.log((rate >= need ? 'OK ' : 'FOUT ') + name + ': ' + Math.round(rate * 100) + '%'
    + (misses.length ? ' (' + misses.join(', ') + ')' : ''));
  assert.ok(rate >= need, name + ': ' + Math.round(rate * 100) + '% < ' + Math.round(need * 100) + '%');
}
console.log('   traagste beeld (640×480): ' + slowest.toFixed(1) + ' ms');

// ---- wat níét als worp mag tellen ----
{
  const empty = V.detect(render({ n: 0 }).img);
  assert.equal(empty.dice.length, 0, 'lege bak');
  const four = render({ n: 4, seed: 3 });
  assert.equal(seen(V.detect(four.img)), four.values.join(''), 'vier stenen = vier');
  const edge = render({ edge: true, seed: 4 });
  assert.equal(seen(V.detect(edge.img)), edge.values.join(''), 'steen half uit beeld telt niet mee');
  const light = V.detect(render({ bg: 205, gradient: 10, seed: 5 }).img);
  assert.equal(light.problem, 'light', 'witte ondergrond wordt gemeld');
  assert.notEqual(light.dice.length, 5);
  console.log('OK lege bak, vier stenen, half uit beeld, witte ondergrond');
}

// ---- de tracker: wanneer gaat een worp de deur uit ----
{
  const thumb = v => new Uint8Array(4800).fill(v);
  const frame = (t, values) => ({ thumb: thumb(t), dice: values.map(v => ({ value: v })) });
  const tr = V.createTracker({ frames: 3 });
  const worp = [2, 3, 3, 5, 6];
  assert.equal(tr.push(frame(10, worp)).state, 'moving', 'eerste beeld = beweging');
  assert.equal(tr.push(frame(200, worp)).state, 'moving', 'beeld verandert flink');
  let r = tr.push(frame(200, worp));
  assert.equal(r.fire, false);
  assert.equal(r.state, 'settling');
  r = tr.push(frame(200, worp));
  assert.equal(r.fire, false);
  r = tr.push(frame(200, worp));
  assert.equal(r.fire, true, 'na drie stille, gelijke beelden');
  assert.deepEqual([...r.values], worp);
  assert.equal(tr.push(frame(200, worp)).fire, false, 'maar één keer');
  // Eén steen even onleesbaar: geen worp, en de teller begint opnieuw.
  const tr2 = V.createTracker({ frames: 2 });
  tr2.push(frame(50, worp));
  assert.equal(tr2.push(frame(50, [2, 3, 3, 5])).state, 'incomplete');
  assert.equal(tr2.push(frame(50, [2, 3, null, 5, 6])).state, 'incomplete');
  assert.equal(tr2.push(frame(50, worp)).fire, false);
  assert.equal(tr2.push(frame(50, worp)).fire, true);
  // Na het invullen: dezelfde stenen blijven liggen → niets, tot er beweging is.
  tr2.disarm();
  for (let i = 0; i < 5; i++) assert.equal(tr2.push(frame(50, worp)).fire, false, 'zelfde worp niet nog eens');
  tr2.push(frame(120, [1, 1, 1, 1, 1]));
  tr2.push(frame(120, [1, 1, 1, 1, 1]));
  assert.equal(tr2.push(frame(120, [1, 1, 1, 1, 1])).fire, true, 'na beweging de nieuwe worp');
  // "Opnieuw lezen" zonder beweging.
  tr2.arm();
  tr2.push(frame(120, [1, 1, 1, 1, 1]));
  assert.equal(tr2.push(frame(120, [1, 1, 1, 1, 1])).fire, true, 'arm() leest opnieuw');
  console.log('OK tracker: stil liggen, één keer, wachten op beweging');
}

console.log('\nAlle dobbelsteenherkenning-tests geslaagd ✔');
