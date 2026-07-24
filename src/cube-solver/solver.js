// ============================================================================
//  Rubik's Cube engine + layer-by-layer solver  (cubie level model)
//  This file is used for Node testing AND embedded (as text) into index.html.
//  Corner indices:  URF UFL ULB UBR DFR DLF DBL DRB  = 0..7
//  Edge indices:    UR UF UL UB DR DF DL DB FR FL BL BR = 0..11
// ============================================================================

// --- basic face moves at cubie level (clockwise quarter turns) -------------
const MOVES = {
  U: { cp:[3,0,1,2,4,5,6,7], co:[0,0,0,0,0,0,0,0],
       ep:[3,0,1,2,4,5,6,7,8,9,10,11], eo:[0,0,0,0,0,0,0,0,0,0,0,0] },
  R: { cp:[4,1,2,0,7,5,6,3], co:[2,0,0,1,1,0,0,2],
       ep:[8,1,2,3,11,5,6,7,4,9,10,0], eo:[0,0,0,0,0,0,0,0,0,0,0,0] },
  F: { cp:[1,5,2,3,0,4,6,7], co:[1,2,0,0,2,1,0,0],
       ep:[0,9,2,3,4,8,6,7,1,5,10,11], eo:[0,1,0,0,0,1,0,0,1,1,0,0] },
  D: { cp:[0,1,2,3,5,6,7,4], co:[0,0,0,0,0,0,0,0],
       ep:[0,1,2,3,7,4,5,6,8,9,10,11], eo:[0,0,0,0,0,0,0,0,0,0,0,0] },
  L: { cp:[0,2,6,3,4,1,5,7], co:[0,1,2,0,0,2,1,0],
       ep:[0,1,10,3,4,5,9,7,8,2,6,11], eo:[0,0,0,0,0,0,0,0,0,0,0,0] },
  B: { cp:[0,1,3,7,4,5,2,6], co:[0,0,1,2,0,0,2,1],
       ep:[0,1,2,11,4,5,6,10,8,9,3,7], eo:[0,0,0,1,0,0,0,1,0,0,1,1] },
};

function solvedState() {
  return { cp:[0,1,2,3,4,5,6,7], co:[0,0,0,0,0,0,0,0],
           ep:[0,1,2,3,4,5,6,7,8,9,10,11], eo:[0,0,0,0,0,0,0,0,0,0,0,0] };
}

function clone(s){ return { cp:s.cp.slice(), co:s.co.slice(), ep:s.ep.slice(), eo:s.eo.slice() }; }

// multiply: apply move m (one of MOVES) once to state s -> new state
function applyMove(s, m) {
  const cp=new Array(8), co=new Array(8), ep=new Array(12), eo=new Array(12);
  for (let i=0;i<8;i++){
    cp[i]=s.cp[m.cp[i]];
    co[i]=(s.co[m.cp[i]]+m.co[i])%3;
  }
  for (let i=0;i<12;i++){
    ep[i]=s.ep[m.ep[i]];
    eo[i]=(s.eo[m.ep[i]]+m.eo[i])%2;
  }
  return {cp,co,ep,eo};
}

// apply a sequence of move tokens like "U", "R'", "F2"
function applySeq(s, tokens) {
  for (const t of tokens) {
    const face = t[0];
    const m = MOVES[face];
    let times = 1;
    if (t[1]==="'") times = 3;
    else if (t[1]==="2") times = 2;
    for (let k=0;k<times;k++) s = applyMove(s, m);
  }
  return s;
}

function isSolved(s){
  for(let i=0;i<8;i++){ if(s.cp[i]!==i||s.co[i]!==0) return false; }
  for(let i=0;i<12;i++){ if(s.ep[i]!==i||s.eo[i]!==0) return false; }
  return true;
}

// ---- move token helpers ----------------------------------------------------
const FACES = ["U","R","F","D","L","B"];
const ALL_MOVES = [];
for (const f of FACES) for (const suf of ["","'","2"]) ALL_MOVES.push(f+suf);

const OPPOSITE = { U:"D", D:"U", R:"L", L:"R", F:"B", B:"F" };

// compress a token list: merge same-face consecutive turns
function compress(tokens){
  // repeatedly fold
  let changed = true;
  let arr = tokens.slice();
  while(changed){
    changed=false;
    const out=[];
    for(let i=0;i<arr.length;i++){
      const t=arr[i];
      if(out.length){
        const last=out[out.length-1];
        if(last[0]===t[0]){
          // same face, combine amounts
          const amt = (turnAmt(last)+turnAmt(t))%4;
          out.pop();
          if(amt!==0) out.push(faceAmt(t[0],amt));
          changed=true;
          continue;
        }
      }
      out.push(t);
    }
    arr=out;
  }
  // also fold A B A where A,B opposite faces  (A and A around B)
  // simple second pass: handle f X f where X is opposite face of f
  changed=true;
  while(changed){
    changed=false;
    for(let i=0;i+2<arr.length;i++){
      if(arr[i][0]===arr[i+2][0] && OPPOSITE[arr[i][0]]===arr[i+1][0]){
        const amt=(turnAmt(arr[i])+turnAmt(arr[i+2]))%4;
        const merged=[];
        if(amt!==0) merged.push(faceAmt(arr[i][0],amt));
        arr=arr.slice(0,i).concat(merged,[arr[i+1]],arr.slice(i+3));
        changed=true;
        break;
      }
    }
  }
  return arr;
}
function turnAmt(t){ if(t[1]==="'")return 3; if(t[1]==="2")return 2; return 1; }
function faceAmt(f,a){ return a===1?f : a===2?f+"2" : f+"'"; }

// ============================================================================
//  SOLVER  (layer by layer)
// ============================================================================

// expand a token (like "R'") into list of base-move applications count
// For search we use the 18 ALL_MOVES tokens directly.

function applyTokenSearch(s,t){
  const m=MOVES[t[0]];
  let times = turnAmt(t);
  for(let k=0;k<times;k++) s=applyMove(s,m);
  return s;
}

// axis of each face: U/D=0, R/L=1, F/B=2
const AXIS = {U:0,D:0,R:1,L:1,F:2,B:2};

// ---- single-piece distance-to-home tables (admissible heuristic) ----------
// EDGE_DIST[home][pos*2+ori]   = min quarter/half turns to send an edge home
// CORNER_DIST[home][pos*3+ori] = same for a corner
function edgeStep(q,o,m){ let i; for(i=0;i<12;i++) if(m.ep[i]===q) break; return [i,(o+m.eo[i])%2]; }
function cornerStep(q,o,m){ let i; for(i=0;i<8;i++) if(m.cp[i]===q) break; return [i,(o+m.co[i])%3]; }
const BASE=[MOVES.U,MOVES.R,MOVES.F,MOVES.D,MOVES.L,MOVES.B];

let EDGE_DIST=null, CORNER_DIST=null;
function buildPieceDist(){
  if(EDGE_DIST) return;
  EDGE_DIST=[]; CORNER_DIST=[];
  for(let home=0;home<12;home++){
    const dist=new Int8Array(24).fill(-1);
    dist[home*2+0]=0; let fr=[[home,0]];
    while(fr.length){ const nx=[];
      for(const [q,o] of fr){ const d=dist[q*2+o];
        for(const m of BASE){ let s=[q,o];
          for(let k=0;k<3;k++){ s=edgeStep(s[0],s[1],m); const idx=s[0]*2+s[1];
            if(dist[idx]<0){dist[idx]=d+1;nx.push([s[0],s[1]]);} } } }
      fr=nx; }
    EDGE_DIST.push(dist);
  }
  for(let home=0;home<8;home++){
    const dist=new Int8Array(24).fill(-1);
    dist[home*3+0]=0; let fr=[[home,0]];
    while(fr.length){ const nx=[];
      for(const [q,o] of fr){ const d=dist[q*3+o];
        for(const m of BASE){ let s=[q,o];
          for(let k=0;k<3;k++){ s=cornerStep(s[0],s[1],m); const idx=s[0]*3+s[1];
            if(dist[idx]<0){dist[idx]=d+1;nx.push([s[0],s[1]]);} } } }
      fr=nx; }
    CORNER_DIST.push(dist);
  }
}

// heuristic: max single-piece distance over the given pieces ({t,i})
function heurPieces(state, pieces){
  let h=0;
  for(const p of pieces){
    if(p.t==='e'){ let q; for(q=0;q<12;q++) if(state.ep[q]===p.i) break; const d=EDGE_DIST[p.i][q*2+state.eo[q]]; if(d>h)h=d; }
    else { let q; for(q=0;q<8;q++) if(state.cp[q]===p.i) break; const d=CORNER_DIST[p.i][q*3+state.co[q]]; if(d>h)h=d; }
  }
  return h;
}

// IDA* with admissible heuristic + transposition table. Cube searches revisit
// the same state via many move orders; deduping states at a given remaining
// depth prunes the tree massively while staying complete.
function stKey(s){
  return s.cp.join("")+s.co.join("")+s.ep.join(",")+s.eo.join("");
}
function searchToGoal(start, goal, maxDepth, pieces, moveset){
  buildPieceDist();
  moveset = moveset || ALL_MOVES;
  if(goal(start)) return [];
  for(let depth=1; depth<=maxDepth; depth++){
    const seen = new Map();
    const res = dls(start, goal, depth, "", "", pieces, moveset, seen);
    if(res) return res;
  }
  return null;
}
function dls(state, goal, depth, l1, l2, pieces, moveset, seen){
  if(depth===0) return goal(state)?[]:null;
  if(heurPieces(state,pieces) > depth) return null;        // admissible prune
  const key = stKey(state);
  const prev = seen.get(key);
  if(prev!==undefined && prev>=depth) return null;         // already explored ≥ this deep
  seen.set(key, depth);
  for(const t of moveset){
    const f=t[0];
    if(f===l1) continue;                                   // no two turns same face
    if(l1 && AXIS[f]===AXIS[l1] && f>l1) continue;         // canonicalise commuting
    if(l2 && AXIS[f]===AXIS[l1] && AXIS[f]===AXIS[l2]) continue;
    const ns=applyTokenSearch(state,t);
    const sub=dls(ns,goal,depth-1,f,l1,pieces,moveset,seen);
    if(sub) return [t].concat(sub);
  }
  return null;
}

// ---- predicates for first two layers (white on D) --------------------------
// We solve D layer pieces and middle layer. Home positions:
//   D edges: DR=4 DF=5 DL=6 DB=7   D corners: DFR=4 DLF=5 DBL=6 DRB=7
//   middle edges: FR=8 FL=9 BL=10 BR=11
function pieceEdgeSolved(s,i){ return s.ep[i]===i && s.eo[i]===0; }
function pieceCornerSolved(s,i){ return s.cp[i]===i && s.co[i]===0; }

function solveF2L(state){
  let moves=[];
  let s=clone(state);
  // solve the bottom layer (cross edges, then corners) with a short heuristic
  // search, then the middle layer deterministically.
  const dEdges=[4,5,6,7];
  const dCorners=[4,5,6,7];

  const solvedSet=[];           // pieces that must stay solved
  function makeGoal(check, idx){
    const fixedEdges = solvedSet.filter(p=>p.t==='e').map(p=>p.i);
    const fixedCorners = solvedSet.filter(p=>p.t==='c').map(p=>p.i);
    return (st)=>{
      if(!check(st,idx)) return false;
      for(const e of fixedEdges) if(!pieceEdgeSolved(st,e)) return false;
      for(const c of fixedCorners) if(!pieceCornerSolved(st,c)) return false;
      return true;
    };
  }

  // observed worst search depths: cross edges 4, first-layer corners 6.
  // caps include a safety margin so a search can never blow up.
  for(const e of dEdges){
    const goal=makeGoal(pieceEdgeSolved,e);
    const seq=searchToGoal(s,goal,8,solvedSet.concat([{t:'e',i:e}]));
    if(!seq) return null;
    s=applySeq(s,seq); moves=moves.concat(seq);
    solvedSet.push({t:'e',i:e});
  }
  for(const c of dCorners){
    const goal=makeGoal(pieceCornerSolved,c);
    const seq=searchToGoal(s,goal,9,solvedSet.concat([{t:'c',i:c}]));
    if(!seq) return null;
    s=applySeq(s,seq); moves=moves.concat(seq);
    solvedSet.push({t:'c',i:c});
  }
  // middle layer: deterministic standard insertions (instant, never deep search)
  const mid = solveMiddle(s);
  if(!mid) return null;
  s = mid.state; moves = moves.concat(mid.moves);
  return {moves, state:s};
}

// ---- deterministic middle (second) layer ----------------------------------
// Bottom layer is solved. Insert the 4 equator edges (FR FL BL BR) using the
// classic "U R U' R' U' F' U F" / mirror algorithms. Works purely from colours.
function solveMiddle(state){
  let s=clone(state), moves=[];
  const run=seq=>{ s=applySeq(s,seq); moves=moves.concat(seq); };
  const ctr={U:0,R:1,F:2,D:3,L:4,B:5};
  const rightN={F:'R',R:'B',B:'L',L:'F'};
  const leftN ={F:'L',R:'F',B:'R',L:'B'};
  const uStick={F:7,R:5,B:1,L:3};      // facelet of the U sticker of the U-edge by face
  const sideStick={F:19,R:10,B:46,L:37};
  const uPos={F:1,R:0,B:3,L:2};        // edge index of the U-layer edge by face
  const rightInsert=X=>['U',rightN[X],"U'",rightN[X]+"'","U'",X+"'",'U',X];
  const leftInsert =X=>["U'",leftN[X]+"'",'U',leftN[X],'U',X,"U'",X+"'"];
  const ejectFront={8:'F',9:'L',10:'B',11:'R'}; // slot -> front face to eject it
  const midSolved=()=>[8,9,10,11].every(i=>s.ep[i]===i&&s.eo[i]===0);
  const FACES=['F','R','B','L'];

  let guard=0;
  while(!midSolved()){
    if(++guard>60) return null;
    const F=stateToFacelets(s);
    // 1) an aligned U-layer middle edge ready to drop in?
    let acted=false;
    for(const X of FACES){
      const e=s.ep[uPos[X]];
      if(e<8) continue;                          // not a middle-type edge
      if(F[sideStick[X]]!==ctr[X]) continue;     // side colour doesn't match centre
      const top=F[uStick[X]];
      if(top===ctr[rightN[X]]) run(rightInsert(X));
      else if(top===ctr[leftN[X]]) run(leftInsert(X));
      else continue;
      acted=true; break;
    }
    if(acted) continue;
    // 2) any middle edge sitting in the U layer but not aligned? rotate U.
    let inU=false;
    for(const X of FACES) if(s.ep[uPos[X]]>=8){ inU=true; break; }
    if(inU){ run(['U']); continue; }
    // 3) a middle edge is stuck wrongly in a slot -> eject it to the U layer.
    for(const slot of [8,9,10,11]){
      if(s.ep[slot]!==slot || s.eo[slot]!==0){ run(rightInsert(ejectFront[slot])); acted=true; break; }
    }
    if(!acted) return null;
  }
  return {moves, state:s};
}

// ---- Last layer : solved with a precomputed BFS table over the LL group ----
// After F2L, only the 4 U corners (0..3) and 4 U edges (0..3) remain. We BFS
// from the solved state using a set of F2L-preserving macro algorithms, which
// generates the whole last-layer group, and store for every reachable state a
// token sequence that solves it. This is complete and provably correct.

function llKey(s){
  // encode only the U-layer pieces
  return s.cp[0]+","+s.cp[1]+","+s.cp[2]+","+s.cp[3]+"|"+
         s.co[0]+s.co[1]+s.co[2]+s.co[3]+"|"+
         s.ep[0]+","+s.ep[1]+","+s.ep[2]+","+s.ep[3]+"|"+
         s.eo[0]+s.eo[1]+s.eo[2]+s.eo[3];
}

function invSeq(toks){
  return toks.slice().reverse().map(t=> t[1]==="'" ? t[0] : t[1]==="2" ? t : t[0]+"'");
}

// F2L-preserving generator macros (their U-layer action generates the LL group)
const LL_MACROS = [
  ["U"],
  ["U'"],
  ["U2"],
  ["R","U","R'","U","R","U2","R'"],                       // Sune (corner orient)
  ["F","R","U","R'","U'","F'"],                           // edge orient
  ["U","R","U'","L'","U","R'","U'","L"],                  // corner 3-cycle
  ["R","U'","R","U","R","U","R","U'","R'","U'","R2"],     // edge 3-cycle (U-perm)
];

const LL_MACROS_INV = LL_MACROS.map(invSeq);

// Compact LL state = [cp0..3, co0..3, ep0..3, eo0..3] (16 ints).
// Each macro acts on the last layer as a fixed group element; precompute it
// by applying the macro to the solved cube and reading the U-layer pieces.
function fromCube(s){ return [s.cp[0],s.cp[1],s.cp[2],s.cp[3], s.co[0],s.co[1],s.co[2],s.co[3],
                              s.ep[0],s.ep[1],s.ep[2],s.ep[3], s.eo[0],s.eo[1],s.eo[2],s.eo[3]]; }
const LL_GEN = LL_MACROS.map(m=> fromCube(applySeq(solvedState(), m)));

// compose compact state x with macro element g  (== applySeq at LL level)
function llCompose(x, g){
  const r = new Array(16);
  for(let i=0;i<4;i++){
    const cpi = g[i];                 // corner now at pos i comes from g[i]
    r[i]   = x[cpi];
    r[4+i] = (x[4+cpi] + g[4+i]) % 3;
    const epi = g[8+i];
    r[8+i]  = x[8+epi];
    r[12+i] = (x[12+epi] + g[12+i]) % 2;
  }
  return r;
}
function llCode(x){
  const cp = x[0] + 4*x[1] + 16*x[2] + 64*x[3];
  const co = x[4] + 3*x[5] + 9*x[6] + 27*x[7];
  const ep = x[8] + 4*x[9] + 16*x[10] + 64*x[11];
  const eo = x[12] + 2*x[13] + 4*x[14] + 8*x[15];
  return ((cp*81 + co)*256 + ep)*16 + eo;
}

let LL_TABLE = null;
let LL_START_CODE = null;
function buildLLTable(){
  if(LL_TABLE) return LL_TABLE;
  LL_TABLE = new Map();              // code -> [parentCode, macroIndex]
  const start = [0,1,2,3, 0,0,0,0, 0,1,2,3, 0,0,0,0];
  LL_START_CODE = llCode(start);
  LL_TABLE.set(LL_START_CODE, null);
  let frontier = [start];
  while(frontier.length){
    const next=[];
    for(const a of frontier){
      const ka = llCode(a);
      for(let mi=0; mi<LL_GEN.length; mi++){
        const b = llCompose(a, LL_GEN[mi]);
        const kb = llCode(b);
        if(!LL_TABLE.has(kb)){
          LL_TABLE.set(kb, [ka, mi]);
          next.push(b);
        }
      }
    }
    frontier=next;
  }
  return LL_TABLE;
}

function solveLL(state){
  const tbl = buildLLTable();
  let cur = llCode(fromCube(state));
  if(!tbl.has(cur)) return null;
  let seq=[];
  while(cur !== LL_START_CODE){
    const [pk,pm] = tbl.get(cur);
    seq = seq.concat(LL_MACROS_INV[pm]);
    cur = pk;
  }
  const s = applySeq(clone(state), seq);
  return {moves: seq, state: s};
}

function solveCube(state){
  if(isSolved(state)) return [];
  const f2l=solveF2L(state);
  if(!f2l) return null;
  const ll=solveLL(f2l.state);
  if(!ll) return null;
  let all=f2l.moves.concat(ll.moves);
  all=compress(all);
  // verify
  if(!isSolved(applySeq(clone(state),all))) return null;
  return all;
}

// ============================================================================
//  STAGED SOLVER  (leer-modus / beginnersmethode)
//  Levert dezelfde oplossing, maar opgesplitst in aanleerbare fases die elk de
//  klassieke algoritmes gebruiken. Zo leer je de trucjes stap voor stap.
//  Fases:  1 kruis · 2 hoeken onderlaag · 3 middelste laag ·
//          4 bovenkruis · 5 bovenvlak · 6 hoeken plaatsen · 7 randen plaatsen
//  Alle fase 4-7 zetten zijn F2L-behoudend, dus de eerste twee lagen blijven
//  staan. Correctheid wordt end-to-end getest (test/solver.test.js).
// ============================================================================

// laatste-laag deeldoelen (alleen de U-laag stukken 0..3)
function uEdgesOriented(s){ return s.eo[0]===0&&s.eo[1]===0&&s.eo[2]===0&&s.eo[3]===0; }
function uCornersOriented(s){ return s.co[0]===0&&s.co[1]===0&&s.co[2]===0&&s.co[3]===0; }
function uCornersPlaced(s){ return s.cp[0]===0&&s.cp[1]===1&&s.cp[2]===2&&s.cp[3]===3; }
function llSolved(s){
  return uCornersPlaced(s)&&uCornersOriented(s)&&uEdgesOriented(s)&&
         s.ep[0]===0&&s.ep[1]===1&&s.ep[2]===2&&s.ep[3]===3;
}

// De klassieke laatste-laag algoritmes (als losse zet-tokens).
const ALG_EO       = ["F","R","U","R'","U'","F'"];        // randen oriënteren (bovenkruis)
const ALG_SUNE     = ["R","U","R'","U","R","U2","R'"];    // hoeken oriënteren (Sune)
const ALG_ANTISUNE = ["R","U2","R'","U'","R","U'","R'"];  // hoeken oriënteren (anti-Sune)
const ALG_CORNER   = ["R'","F","R'","B2","R","F'","R'","B2","R2"]; // hoeken 3-wissel (A-perm, oriëntatie-behoudend)
const ALG_UPERM    = ["R","U'","R","U","R","U","R","U'","R'","U'","R2"]; // randen 3-wissel (U-perm)
const U_SETUPS     = [["U"],["U'"],["U2"]];               // AUF-instellingen

// BFS over een kleine set macro-operaties (elk een tokenlijst) tot `goal` klopt.
// Elke operatie is F2L-behoudend, dus alleen de U-laag verandert → we dedupen op
// llKey. De deeldoelen liggen ondiep, dus dit is vrijwel instant.
function llBFS(state, ops, goal, maxOps){
  if(goal(state)) return [];
  const seen=new Set([llKey(state)]);
  let frontier=[{s:state, path:[]}];
  for(let depth=0; depth<maxOps; depth++){
    const next=[];
    for(const node of frontier){
      for(const op of ops){
        const ns=applySeq(clone(node.s), op);
        const k=llKey(ns);
        if(seen.has(k)) continue;
        const path=node.path.concat(op);
        if(goal(ns)) return path;
        seen.add(k);
        next.push({s:ns, path});
      }
    }
    frontier=next;
    if(!frontier.length) break;
  }
  return null;
}

function solveStaged(state){
  buildPieceDist();
  const out={stages:[], moves:[]};
  let s=clone(state);
  const solvedSet=[];   // stukken die opgelost moeten blijven (kruis + hoeken)
  const record=(key,seq)=>{ seq=compress(seq); out.stages.push({key,moves:seq.slice()}); out.moves=out.moves.concat(seq); };
  const goalFor=(check,idx)=>{
    const fE=solvedSet.filter(p=>p.t==='e').map(p=>p.i);
    const fC=solvedSet.filter(p=>p.t==='c').map(p=>p.i);
    return (st)=>{
      if(!check(st,idx)) return false;
      for(const e of fE) if(!pieceEdgeSolved(st,e)) return false;
      for(const c of fC) if(!pieceCornerSolved(st,c)) return false;
      return true;
    };
  };

  // Fase 1 — kruis op de onderlaag (D-randen 4,5,6,7), intuïtief geplaatst.
  let seq=[];
  for(const e of [4,5,6,7]){
    const sub=searchToGoal(s, goalFor(pieceEdgeSolved,e), 8, solvedSet.concat([{t:'e',i:e}]));
    if(!sub) return null;
    s=applySeq(s,sub); seq=seq.concat(sub); solvedSet.push({t:'e',i:e});
  }
  record("cross", seq);

  // Fase 2 — hoeken van de onderlaag (D-hoeken 4,5,6,7).
  seq=[];
  for(const c of [4,5,6,7]){
    const sub=searchToGoal(s, goalFor(pieceCornerSolved,c), 9, solvedSet.concat([{t:'c',i:c}]));
    if(!sub) return null;
    s=applySeq(s,sub); seq=seq.concat(sub); solvedSet.push({t:'c',i:c});
  }
  record("corners1", seq);

  // Fase 3 — middelste laag (deterministische insteek-algoritmes).
  const mid=solveMiddle(s);
  if(!mid) return null;
  s=mid.state; record("middle", mid.moves);

  // Fase 4 — bovenkruis: de U-randen oriënteren met F R U R' U' F'.
  let sub=llBFS(s, U_SETUPS.concat([ALG_EO]), uEdgesOriented, 12);
  if(!sub) return null; s=applySeq(s,sub); record("eo", sub);

  // Fase 5 — bovenvlak: de U-hoeken oriënteren met Sune / anti-Sune.
  sub=llBFS(s, U_SETUPS.concat([ALG_SUNE, ALG_ANTISUNE]), st=>uCornersOriented(st)&&uEdgesOriented(st), 20);
  if(!sub) return null; s=applySeq(s,sub); record("co", sub);

  // Fase 6 — hoeken op hun plek (hoek-3-wissel).
  sub=llBFS(s, U_SETUPS.concat([ALG_CORNER]), st=>uCornersPlaced(st)&&uCornersOriented(st)&&uEdgesOriented(st), 20);
  if(!sub) return null; s=applySeq(s,sub); record("cp", sub);

  // Fase 7 — randen op hun plek (U-perm): nu is de kubus opgelost.
  sub=llBFS(s, U_SETUPS.concat([ALG_UPERM]), llSolved, 20);
  if(!sub) return null; s=applySeq(s,sub); record("ep", sub);

  // eindcontrole: de gecomprimeerde totaaloplossing moet echt kloppen.
  if(!isSolved(applySeq(clone(state), out.moves))) return null;
  return out;
}

// ---- scramble + facelet conversion (for tests / UI) -----------------------
function randomScramble(n){
  const toks=[];
  let lastFace=null;
  for(let i=0;i<n;i++){
    let t;
    do { t=ALL_MOVES[Math.floor(Math.random()*ALL_MOVES.length)]; } while(t[0]===lastFace);
    lastFace=t[0];
    toks.push(t);
  }
  return toks;
}

// ============================================================================
//  Facelet <-> cubie conversion + validation
//  Facelet index layout (Kociemba):  U=0..8 R=9..17 F=18..26 D=27..35
//  L=36..44 B=45..53.  Within a face:  0 1 2 / 3 4 5 / 6 7 8.
//  Colour codes == face index: 0=U 1=R 2=F 3=D 4=L 5=B.
// ============================================================================
const cornerFacelet = [
  [8,9,20],[6,18,38],[0,36,47],[2,45,11],
  [29,26,15],[27,44,24],[33,53,42],[35,17,51]
];
const edgeFacelet = [
  [5,10],[7,19],[3,37],[1,46],[32,16],[28,25],
  [30,43],[34,52],[23,12],[21,41],[50,39],[48,14]
];
const cornerColor = cornerFacelet.map(t=>t.map(x=>Math.floor(x/9)));
const edgeColor   = edgeFacelet.map(t=>t.map(x=>Math.floor(x/9)));

function stateToFacelets(s){
  const F = new Array(54);
  for(let i=0;i<6;i++) F[9*i+4]=i;                  // centres
  for(let p=0;p<8;p++){
    const j=s.cp[p], ori=s.co[p];
    for(let k=0;k<3;k++) F[cornerFacelet[p][(k+ori)%3]] = cornerColor[j][k];
  }
  for(let p=0;p<12;p++){
    const j=s.ep[p], ori=s.eo[p];
    for(let k=0;k<2;k++) F[edgeFacelet[p][(k+ori)%2]] = edgeColor[j][k];
  }
  return F;
}

// Convert a 54-length colour array to a cubie state. Returns {state} or {error}.
function faceletsToState(F){
  for(const v of F) if(typeof v!=="number"||v<0||v>5) return {error:"Niet alle vlakjes zijn ingekleurd."};
  const cnt=[0,0,0,0,0,0]; for(const v of F) cnt[v]++;
  for(let i=0;i<6;i++) if(cnt[i]!==9) return {error:"Elke kleur moet precies 9 keer voorkomen (kleur "+i+" = "+cnt[i]+")."};
  for(let i=0;i<6;i++) if(F[9*i+4]!==i) return {error:"De middenvlakjes moeten de standaardkleuren houden."};

  const cp=new Array(8), co=new Array(8), ep=new Array(12), eo=new Array(12);
  // corners
  for(let p=0;p<8;p++){
    let ori; for(ori=0;ori<3;ori++){ const c=F[cornerFacelet[p][ori]]; if(c===0||c===3) break; }
    if(ori===3) return {error:"Ongeldige hoek op positie "+p+" (geen wit/geel sticker)."};
    const c1=F[cornerFacelet[p][(ori+1)%3]], c2=F[cornerFacelet[p][(ori+2)%3]];
    let found=-1;
    for(let j=0;j<8;j++){ if(cornerColor[j][1]===c1&&cornerColor[j][2]===c2){found=j;break;} }
    if(found<0) return {error:"Onbekende hoek op positie "+p+"."};
    cp[p]=found; co[p]=ori%3;
  }
  // edges
  for(let p=0;p<12;p++){
    const a=F[edgeFacelet[p][0]], b=F[edgeFacelet[p][1]];
    let found=-1,ori=0;
    for(let j=0;j<12;j++){
      if(edgeColor[j][0]===a&&edgeColor[j][1]===b){found=j;ori=0;break;}
      if(edgeColor[j][0]===b&&edgeColor[j][1]===a){found=j;ori=1;break;}
    }
    if(found<0) return {error:"Onbekende rand op positie "+p+"."};
    ep[p]=found; eo[p]=ori;
  }
  // permutation validity
  if(new Set(cp).size!==8) return {error:"Een hoekstuk komt dubbel voor."};
  if(new Set(ep).size!==12) return {error:"Een randstuk komt dubbel voor."};
  // orientation sums
  if(co.reduce((a,b)=>a+b,0)%3!==0) return {error:"Onmogelijke kubus: een hoek is verkeerd gedraaid."};
  if(eo.reduce((a,b)=>a+b,0)%2!==0) return {error:"Onmogelijke kubus: een rand is verkeerd gedraaid."};
  // permutation parity must match
  const parity=a=>{let pr=0;for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)if(a[i]>a[j])pr^=1;return pr;};
  if(parity(cp)!==parity(ep)) return {error:"Onmogelijke kubus: twee stukken zijn verwisseld."};
  return {state:{cp,co,ep,eo}};
}

const CubeSolver={MOVES,solvedState,clone,applyMove,applySeq,isSolved,solveCube,solveStaged,
  randomScramble,compress,searchToGoal,solveF2L,solveLL,ALL_MOVES,
  buildLLTable,_tableSize:()=>LL_TABLE?LL_TABLE.size:0,
  stateToFacelets,faceletsToState,cornerFacelet,edgeFacelet};
if(typeof module!=="undefined"&&module.exports) module.exports=CubeSolver;
if(typeof window!=="undefined") window.CubeSolver=CubeSolver;
