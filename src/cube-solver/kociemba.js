// ============================================================================
//  Kociemba two-phase solver  (≈20-23 move solutions)
//  Reuses the cubie model from solver.js (MOVES / applyMove / applySeq ...).
//
//  Corners URF UFL ULB UBR DFR DLF DBL DRB = 0..7
//  Edges   UR UF UL UB DR DF DL DB FR FL BL BR = 0..11
//  E-slice (UDSlice) edges = FR FL BL BR = indices 8,9,10,11.
//  U/D edges = 0..7.
// ============================================================================
(function(global){
  // In Node: require the model. In the browser / Web Worker the solver script
  // runs first, so its top-level `CubeSolver` lexical binding is in scope.
  const M = (typeof require!=="undefined" && typeof module!=="undefined")
              ? require("./solver.js") : CubeSolver;
  const { MOVES, applyMove, applySeq, clone, solvedState, isSolved } = M;

  // ---- small math helpers --------------------------------------------------
  const Cnk = [];
  for(let n=0;n<13;n++){ Cnk[n]=[]; for(let k=0;k<13;k++){ Cnk[n][k] = (k===0)?1:(k>n?0:Cnk[n-1][k-1]+Cnk[n-1][k]); } }
  const FACT=[1,1,2,6,24,120,720,5040,40320];

  // rank a permutation of distinct values 0..n-1  -> 0..n!-1
  function permRank(p){
    const n=p.length; let r=0;
    for(let i=0;i<n;i++){ r*=(n-i); for(let j=i+1;j<n;j++) if(p[i]>p[j]) r++; }
    return r;
  }
  function permUnrank(r,n){
    const p=new Array(n); const elems=[]; for(let i=0;i<n;i++) elems.push(i);
    // factorial base
    const digs=new Array(n);
    for(let i=0;i<n;i++){ const f=FACT[n-1-i]; digs[i]=Math.floor(r/f); r%=f; }
    // digs[i] is number of smaller-remaining; but our permRank counts inversions left->right
    // reconstruct: choose element with index = (count) among remaining sorted ascending
    for(let i=0;i<n;i++){ const idx=digs[i]; p[i]=elems[idx]; elems.splice(idx,1); }
    return p;
  }

  // ---- coordinates ---------------------------------------------------------
  function getTwist(s){ let t=0; for(let i=0;i<7;i++) t=t*3+s.co[i]; return t; }
  function getFlip(s){ let f=0; for(let i=0;i<11;i++) f=f*2+s.eo[i]; return f; }
  function getSlice(s){ // 0..494 : combination of positions holding slice edges
    let a=0,x=0;
    for(let j=0;j<12;j++){ if(s.ep[j]>=8){ a+=Cnk[j][x+1]; x++; } }
    return a;
  }
  function getCP(s){ return permRank(s.cp); }
  function getEdge8(s){ return permRank(s.ep.slice(0,8)); }
  function getSliceSort(s){ const a=[s.ep[8]-8,s.ep[9]-8,s.ep[10]-8,s.ep[11]-8]; return permRank(a); }

  // ---- move sets -----------------------------------------------------------
  const P1_MOVES=[]; // 18 tokens
  for(const f of ["U","R","F","D","L","B"]) for(const suf of ["","2","'"]) P1_MOVES.push(f+suf);
  const P2_MOVES=["U","U2","U'","D","D2","D'","R2","L2","F2","B2"];
  const FACE_OF = t=>t[0];

  function applyTok(s,t){ const m=MOVES[t[0]]; let n=(t[1]==="2")?2:(t[1]==="'")?3:1; for(let k=0;k<n;k++) s=applyMove(s,m); return s; }
  // full cubie transform of a single token (applied to the solved cube)
  function tokTransform(t){ return applyTok(solvedState(), t); }

  // ---- tables --------------------------------------------------------------
  let T=null;
  function buildTables(log){
    if(T) return T;
    const t0=Date.now();
    T={};
    const MT1=P1_MOVES.map(tokTransform), MT2=P2_MOVES.map(tokTransform);
    const n1=P1_MOVES.length, n2=P2_MOVES.length;

    // -- phase-1 move tables (pure array math on coordinate vectors) --
    T.twistMove=new Int16Array(2187*n1);
    for(let i=0;i<2187;i++){ const co=decodeTwist(i);
      for(let m=0;m<n1;m++){ const mt=MT1[m]; let v=0;
        for(let k=0;k<7;k++) v=v*3+((co[mt.cp[k]]+mt.co[k])%3);
        T.twistMove[i*n1+m]=v; } }
    T.flipMove=new Int16Array(2048*n1);
    for(let i=0;i<2048;i++){ const eo=decodeFlip(i);
      for(let m=0;m<n1;m++){ const mt=MT1[m]; let v=0;
        for(let k=0;k<11;k++) v=v*2+((eo[mt.ep[k]]+mt.eo[k])&1);
        T.flipMove[i*n1+m]=v; } }
    T.sliceMove=new Int16Array(495*n1);
    for(let i=0;i<495;i++){ const set=decodeSliceSet(i);
      for(let m=0;m<n1;m++){ const mt=MT1[m]; let a=0,x=0;
        for(let j=0;j<12;j++){ if(set[mt.ep[j]]){ a+=Cnk[j][x+1]; x++; } }
        T.sliceMove[i*n1+m]=a; } }

    // -- phase-2 move tables --
    T.cpMove=new Uint16Array(40320*n2);
    for(let i=0;i<40320;i++){ const cp=permUnrank(i,8);
      for(let m=0;m<n2;m++){ const mt=MT2[m]; const nc=new Array(8);
        for(let k=0;k<8;k++) nc[k]=cp[mt.cp[k]]; T.cpMove[i*n2+m]=permRank(nc); } }
    T.e8Move=new Uint16Array(40320*n2);
    for(let i=0;i<40320;i++){ const p=permUnrank(i,8);   // edges 0..7 at positions 0..7
      for(let m=0;m<n2;m++){ const mt=MT2[m]; const np=new Array(8);
        for(let k=0;k<8;k++) np[k]=p[mt.ep[k]];          // G1 moves keep U/D edges in 0..7
        T.e8Move[i*n2+m]=permRank(np); } }
    T.ssMove=new Uint8Array(24*n2);
    for(let i=0;i<24;i++){ const p=permUnrank(i,4);       // slice edges (values 0..3) at positions 8..11
      for(let m=0;m<n2;m++){ const mt=MT2[m]; const np=new Array(4);
        for(let k=0;k<4;k++) np[k]=p[mt.ep[8+k]-8]; T.ssMove[i*n2+m]=permRank(np); } }
    if(log) console.log("move tables", Date.now()-t0,"ms");

    // -- pruning tables -- (note: the solved slice combination index is 494)
    T.prTwistSlice=buildPrune(2187,495,T.twistMove,T.sliceMove,n1, 0*495+SLICE_SOLVED);
    T.prFlipSlice =buildPrune(2048,495,T.flipMove ,T.sliceMove,n1, 0*495+SLICE_SOLVED);
    T.prCpSlice   =buildPrune(40320,24,T.cpMove,T.ssMove,n2, 0);
    T.prE8Slice   =buildPrune(40320,24,T.e8Move,T.ssMove,n2, 0);
    if(log) console.log("all tables", Date.now()-t0,"ms");
    return T;
  }
  const SLICE_SOLVED = getSlice(solvedState());   // = 494
  function decodeTwist(t){ const co=new Array(8); let s=0; for(let i=6;i>=0;i--){ co[i]=t%3; t=(t-co[i])/3; s+=co[i]; } co[7]=(3-(s%3))%3; return co; }
  function decodeFlip(f){ const eo=new Array(12); let s=0; for(let i=10;i>=0;i--){ eo[i]=f&1; f=(f-eo[i])/2; s+=eo[i]; } eo[11]=s&1; return eo; }
  function decodeSliceSet(idx){ const pos=[]; let x=3;
    for(let j=11;j>=0;j--){ if(x>=0 && idx>=Cnk[j][x+1]){ idx-=Cnk[j][x+1]; pos.push(j); x--; } }
    const set=new Array(12).fill(false); for(const p of pos) set[p]=true; return set; }

  function buildPrune(NA,NB,moveA,moveB,nMoves,startIdx){
    const size=NA*NB; const d=new Int8Array(size).fill(-1);
    d[startIdx]=0; let frontier=[startIdx]; let depth=0;
    while(frontier.length){
      const next=[];
      for(const idx of frontier){
        const a=(idx/NB)|0, b=idx-a*NB;
        const baseA=a*nMoves, baseB=b*nMoves;
        for(let m=0;m<nMoves;m++){
          const ni=moveA[baseA+m]*NB+moveB[baseB+m];
          if(d[ni]<0){ d[ni]=depth+1; next.push(ni); }
        }
      }
      frontier=next; depth++;
    }
    return d;
  }

  // ---- search --------------------------------------------------------------
  function tokInv(t){ return t[1]==="'"?t[0]:t[1]==="2"?t:t[0]+"'"; }

  function solve(state, opts){
    buildTables(opts&&opts.log);
    const maxTime = (opts&&opts.maxTime)||800;
    const deadline = Date.now()+maxTime;
    const nM1=P1_MOVES.length, nM2=P2_MOVES.length;

    // phase-1 start coords
    const twist0=getTwist(state), flip0=getFlip(state), slice0=getSlice(state);
    let best=null, bestLen=Infinity;

    // phase-2 IDA*: returns array of P2 token-indices or null
    function phase2(cp,e8,ss, maxDepth, lastFace){
      function h(cp,e8,ss){ return Math.max(T.prCpSlice[cp*24+ss], T.prE8Slice[e8*24+ss]); }
      const path=[];
      function dfs(cp,e8,ss,depth,lastFace){
        if(cp===0&&e8===0&&ss===0) return true;
        if(depth===0) return false;
        if(h(cp,e8,ss)>depth) return false;
        for(let m=0;m<nM2;m++){
          const f=P2_MOVES[m][0];
          if(f===lastFace) continue;
          // axis canonical: avoid e.g. U then D ordering dup
          if(sameAxis(f,lastFace) && f>lastFace) continue;
          const ncp=T.cpMove[cp*nM2+m], ne8=T.e8Move[e8*nM2+m], nss=T.ssMove[ss*nM2+m];
          path.push(m);
          if(dfs(ncp,ne8,nss,depth-1,f)) return true;
          path.pop();
        }
        return false;
      }
      for(let d=h(cp,e8,ss); d<=maxDepth; d++){ path.length=0; if(dfs(cp,e8,ss,d,lastFace)) return path.slice(); }
      return null;
    }

    // phase-1 IDA*: enumerate solutions of increasing length, try phase 2 on each
    const seq1=[]; // token indices (P1)
    function ph1(twist,flip,slice,depth,lastFace,curState){
      if(Date.now()>deadline) return;
      if(twist===0&&flip===0&&slice===SLICE_SOLVED){
        // reached G1 -> phase 2
        const d1=seq1.length;
        if(d1>=bestLen) return;
        const cp=getCP(curState), e8=getEdge8(curState), ss=getSliceSort(curState);
        const lastFace=d1>0?P1_MOVES[seq1[d1-1]][0]:"";
        const p2=phase2(cp,e8,ss, bestLen-d1-1, lastFace);
        if(p2){
          const total=d1+p2.length;
          if(total<bestLen){
            bestLen=total;
            best=seq1.map(i=>P1_MOVES[i]).concat(p2.map(i=>P2_MOVES[i]));
          }
        }
        return;
      }
      if(depth===0) return;
      const hb=Math.max(T.prTwistSlice[twist*495+slice], T.prFlipSlice[flip*495+slice]);
      if(hb>depth) return;
      for(let m=0;m<nM1;m++){
        if(Date.now()>deadline) return;
        const f=P1_MOVES[m][0];
        if(f===lastFace) continue;
        if(sameAxis(f,lastFace) && f>lastFace) continue;
        const nt=T.twistMove[twist*nM1+m], nf=T.flipMove[flip*nM1+m], nsl=T.sliceMove[slice*nM1+m];
        seq1.push(m);
        const ns=applyTok(clone(curState),P1_MOVES[m]);
        ph1(nt,nf,nsl,depth-1,f,ns);
        seq1.pop();
      }
    }

    const lb1=Math.max(T.prTwistSlice[twist0*495+slice0], T.prFlipSlice[flip0*495+slice0]);
    for(let d1=lb1; d1<=20 && Date.now()<deadline; d1++){
      seq1.length=0;
      ph1(twist0,flip0,slice0,d1,"",clone(state));
      if(best && bestLen<=d1+1) break;        // good enough / can't do much better
      if(best && d1>=bestLen) break;
    }
    return best;
  }
  const OPP={U:"D",D:"U",R:"L",L:"R",F:"B",B:"F"};
  function sameAxis(a,b){ return b && (a===b || OPP[a]===b); }

  const api={ solve, buildTables, _coords:{getTwist,getFlip,getSlice,getCP,getEdge8,getSliceSort},
              _perm:{permRank,permUnrank} };
  if(typeof module!=="undefined"&&module.exports) module.exports=api;
  if(typeof self!=="undefined") self.Kociemba=api;        // browser window + worker
})(typeof self!=="undefined"?self:this);
