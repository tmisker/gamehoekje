// Correctheidstest voor de cube-solver. Run: node test/solver.test.js
// Lost willekeurige scrambles op met beide oplossers en verifieert elke
// oplossing met isSolved. Aantallen instelbaar: N_KOCIEMBA / N_LBL (env).
'use strict';

const assert = require('node:assert');
const S = require('../src/cube-solver/solver.js');
const K = require('../src/cube-solver/kociemba.js');

const N_KOCIEMBA = +(process.env.N_KOCIEMBA || 200);
const N_LBL = +(process.env.N_LBL || 25);
const N_STAGED = +(process.env.N_STAGED || 25);

// --- facelet-conversie: round-trip en validatie ---
{
  const s = S.applySeq(S.solvedState(), S.randomScramble(30));
  const back = S.faceletsToState(S.stateToFacelets(s));
  assert.ok(!back.error, 'round-trip zonder fout');
  assert.deepEqual(back.state, s, 'facelets round-trip');

  // twee randen verwisseld → pariteitsfout
  const F = S.stateToFacelets(S.solvedState());
  const [a, b] = [S.edgeFacelet[0], S.edgeFacelet[1]];
  [F[a[0]], F[b[0]]] = [F[b[0]], F[a[0]]];
  [F[a[1]], F[b[1]]] = [F[b[1]], F[a[1]]];
  assert.ok(S.faceletsToState(F).error, 'onmogelijke kubus geweigerd');
  console.log('OK facelet-conversie + validatie');
}

// --- Kociemba: N scrambles, elke oplossing geverifieerd, ±20 zetten ---
{
  K.buildTables();
  let totalLen = 0, maxLen = 0;
  for (let i = 0; i < N_KOCIEMBA; i++) {
    const s = S.applySeq(S.solvedState(), S.randomScramble(25));
    const sol = K.solve(S.clone(s), { maxTime: 1000 });
    assert.ok(sol, 'kociemba vond een oplossing (scramble ' + i + ')');
    assert.ok(S.isSolved(S.applySeq(S.clone(s), sol)), 'oplossing klopt (scramble ' + i + ')');
    totalLen += sol.length;
    if (sol.length > maxLen) maxLen = sol.length;
  }
  const avg = totalLen / N_KOCIEMBA;
  assert.ok(maxLen <= 30, 'max lengte redelijk (' + maxLen + ')');
  console.log('OK kociemba: ' + N_KOCIEMBA + ' scrambles, gem. ' +
    avg.toFixed(1) + ' zetten, max ' + maxLen);
}

// --- laag-voor-laag fallback: N scrambles, geverifieerd ---
{
  for (let i = 0; i < N_LBL; i++) {
    const s = S.applySeq(S.solvedState(), S.randomScramble(25));
    const sol = S.solveCube(S.clone(s));
    assert.ok(sol, 'LBL vond een oplossing (scramble ' + i + ')');
    assert.ok(S.isSolved(S.applySeq(S.clone(s), sol)), 'LBL-oplossing klopt (scramble ' + i + ')');
  }
  // al opgeloste kubus → lege oplossing
  assert.deepEqual(S.solveCube(S.solvedState()), []);
  console.log('OK laag-voor-laag fallback: ' + N_LBL + ' scrambles');
}

// --- staged leer-modus: fases in de juiste volgorde, elk deeldoel bereikt ---
{
  const KEYS = ['cross', 'corners1', 'middle', 'eo', 'co', 'cp', 'ep'];
  // controleert het deeldoel van één fase op de tussentoestand `s`
  const subgoalOk = (key, s) => {
    if (key === 'cross') return [4, 5, 6, 7].every(e => s.ep[e] === e && s.eo[e] === 0);
    if (key === 'corners1') return [4, 5, 6, 7].every(e => s.ep[e] === e && s.eo[e] === 0) &&
      [4, 5, 6, 7].every(c => s.cp[c] === c && s.co[c] === 0);
    if (key === 'middle') { for (let i = 4; i < 12; i++) if (s.ep[i] !== i || s.eo[i] !== 0) return false; return true; }
    if (key === 'eo') return [0, 1, 2, 3].every(i => s.eo[i] === 0);
    if (key === 'co') return [0, 1, 2, 3].every(i => s.eo[i] === 0 && s.co[i] === 0);
    if (key === 'cp') return [0, 1, 2, 3].every(i => s.cp[i] === i && s.co[i] === 0 && s.eo[i] === 0);
    if (key === 'ep') return S.isSolved(s);
    return false;
  };
  let totalLen = 0, maxLen = 0;
  for (let i = 0; i < N_STAGED; i++) {
    const scr = S.applySeq(S.solvedState(), S.randomScramble(25));
    const staged = S.solveStaged(S.clone(scr));
    assert.ok(staged, 'staged vond een oplossing (scramble ' + i + ')');
    assert.deepEqual(staged.stages.map(st => st.key), KEYS, 'fases in juiste volgorde (scramble ' + i + ')');
    // loop de fases langs en verifieer elk deeldoel op de echte tussentoestand
    let s = S.clone(scr);
    for (const st of staged.stages) {
      s = S.applySeq(s, st.moves);
      assert.ok(subgoalOk(st.key, s), 'deeldoel "' + st.key + '" bereikt (scramble ' + i + ')');
    }
    assert.ok(S.isSolved(s), 'staged-oplossing klopt (scramble ' + i + ')');
    // de platte zettenlijst moet dezelfde kubus oplossen
    assert.ok(S.isSolved(S.applySeq(S.clone(scr), staged.moves)), 'platte zettenlijst klopt (scramble ' + i + ')');
    totalLen += staged.moves.length;
    if (staged.moves.length > maxLen) maxLen = staged.moves.length;
  }
  // al opgeloste kubus → 7 fases, geen zetten
  const solved = S.solveStaged(S.solvedState());
  assert.equal(solved.stages.length, 7, 'ook opgeloste kubus krijgt 7 fases');
  assert.equal(solved.moves.length, 0, 'opgeloste kubus: nul zetten');
  console.log('OK staged leer-modus: ' + N_STAGED + ' scrambles, gem. ' +
    (totalLen / N_STAGED).toFixed(0) + ' zetten, max ' + maxLen);
}

console.log('\nAlle solver-tests geslaagd ✔');
