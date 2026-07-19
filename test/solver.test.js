// Correctheidstest voor de cube-solver. Run: node test/solver.test.js
// Lost willekeurige scrambles op met beide oplossers en verifieert elke
// oplossing met isSolved. Aantallen instelbaar: N_KOCIEMBA / N_LBL (env).
'use strict';

const assert = require('node:assert');
const S = require('../src/cube-solver/solver.js');
const K = require('../src/cube-solver/kociemba.js');

const N_KOCIEMBA = +(process.env.N_KOCIEMBA || 200);
const N_LBL = +(process.env.N_LBL || 25);

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

console.log('\nAlle solver-tests geslaagd ✔');
