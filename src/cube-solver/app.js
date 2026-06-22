// ============================================================================
//  Rubik's Cube Solver – UI logic (mobile first, animated 3D view)
//  Relies on global `CubeSolver` (see solver.js).
//
//  The cube is drawn as 26 small cubies at fixed positions. A move is shown by
//  rotating the 9 cubies of that layer in the correct direction, then "baking"
//  the result (cubies snap back, stickers recolour to the new state). This way
//  the on-screen turn always matches the move you have to make.
// ============================================================================
(function(){
  const CS = window.CubeSolver;

  // colour index: 0=U(wit) 1=R(rood) 2=F(groen) 3=D(geel) 4=L(oranje) 5=B(blauw)
  const COLORS = ["#f7f7f7","#c41e3a","#1faa47","#ffd500","#ff7a1a","#0051ba"];
  const COLOR_NAMES = ["Wit","Rood","Groen","Geel","Oranje","Blauw"];
  const FACE_KEYS = ["U","R","F","D","L","B"];
  const FACE_NAMES = {U:"Boven",R:"Rechts",F:"Voor",D:"Onder",L:"Links",B:"Achter"};

  // Human-readable move descriptions — consistent "klok"-logica for every face.
  // "met de klok mee" / "tegen de klok in" gezien als je recht naar dat vlak
  // kijkt. De animatie laat de echte draairichting zien, dus volg gewoon mee.
  const MOVE_TEXT = {
    "U":"Bovenkant met de klok mee","U'":"Bovenkant tegen de klok in","U2":"Bovenkant halve draai",
    "D":"Onderkant met de klok mee","D'":"Onderkant tegen de klok in","D2":"Onderkant halve draai",
    "R":"Rechterkant met de klok mee","R'":"Rechterkant tegen de klok in","R2":"Rechterkant halve draai",
    "L":"Linkerkant met de klok mee","L'":"Linkerkant tegen de klok in","L2":"Linkerkant halve draai",
    "F":"Voorkant met de klok mee","F'":"Voorkant tegen de klok in","F2":"Voorkant halve draai",
    "B":"Achterkant met de klok mee","B'":"Achterkant tegen de klok in","B2":"Achterkant halve draai",
  };

  // Cube-rotation (rx,ry deg) that brings a given face straight to the viewer.
  const FACE_VIEW = { F:[0,0], B:[0,180], R:[0,-90], L:[0,90], U:[-90,0], D:[90,0] };

  // Per-move animation: which layer rotates and around which CSS axis/angle.
  // Coordinates are CSS (x right, y DOWN, z toward viewer). Derived so the
  // animation reproduces the solver's MOVES permutation exactly.
  //   sel(x,y,z) -> true if a cubie is in the turning layer
  //   axis: "X"|"Y"|"Z" ; deg: base clockwise angle for the plain move
  const MOVE_ANIM = {
    U:{sel:(x,y,z)=>y===-1, axis:"Y", deg:-90},
    D:{sel:(x,y,z)=>y=== 1, axis:"Y", deg:-90},
    R:{sel:(x,y,z)=>x=== 1, axis:"X", deg: 90},
    L:{sel:(x,y,z)=>x===-1, axis:"X", deg:-90},
    F:{sel:(x,y,z)=>z=== 1, axis:"Z", deg: 90},
    B:{sel:(x,y,z)=>z===-1, axis:"Z", deg:-90},
  };
  const TURN_MS = 450;

  // state -------------------------------------------------------------------
  let inputColors = CS.stateToFacelets(CS.solvedState()); // 54 colour indices
  let selectedColor = 0;
  let mode = "edit";          // "edit" | "solve"
  let frames = [];            // array of 54-colour arrays, one per step
  let solution = [];          // move tokens
  let stepIndex = 0;          // current playback frame
  let playing = false, playTimer = null;
  let animating = false;      // a layer turn is in progress
  let viewRX = 0, viewRY = 0; // current whole-cube rotation (degrees)

  // cubie bookkeeping
  const cubies = {};          // "x,y,z" -> cubie element
  const padRef = new Array(54);  // facelet index -> coloured pad element

  // DOM ----------------------------------------------------------------------
  const $ = id => document.getElementById(id);

  function buildPalette(){
    const wrap = $("palette");
    wrap.innerHTML = "";
    COLORS.forEach((c,i)=>{
      const b = document.createElement("button");
      b.className = "swatch"+(i===selectedColor?" sel":"");
      b.style.background = c;
      b.title = COLOR_NAMES[i];
      b.onclick = ()=>{ selectedColor=i; buildPalette(); };
      wrap.appendChild(b);
    });
  }

  function faceBase(key){ return FACE_KEYS.indexOf(key)*9; }

  // map a facelet (face,row,col) to a cubie position (CSS coords) — matches the
  // solver's facelet layout so colouring corresponds 1:1 with a real cube.
  function faceletCubie(key,r,c){
    switch(key){
      case "U": return [c-1, -1, r-1];
      case "D": return [c-1,  1, 1-r];
      case "F": return [c-1, r-1,  1];
      case "B": return [1-c, r-1, -1];
      case "R": return [ 1, r-1, 1-c];
      case "L": return [-1, r-1, c-1];
    }
  }

  // Build the 26 cubies and the facelet->pad lookup.
  function buildCube(){
    const cube = $("cube");
    cube.innerHTML = "";
    for(const k in cubies) delete cubies[k];
    const outward = { // for cubie (x,y,z): is the <dir> side outward?
      U:(x,y,z)=>y===-1, D:(x,y,z)=>y===1, F:(x,y,z)=>z===1,
      B:(x,y,z)=>z===-1, R:(x,y,z)=>x===1, L:(x,y,z)=>x===-1,
    };
    for(let x=-1;x<=1;x++) for(let y=-1;y<=1;y++) for(let z=-1;z<=1;z++){
      if(x===0&&y===0&&z===0) continue;
      const cubie = document.createElement("div");
      cubie.className = "cubie";
      cubie.style.transform = cubieTransform(x,y,z);
      for(const dir of FACE_KEYS){
        const cf = document.createElement("div");
        cf.className = "cf cf-"+dir;
        if(outward[dir](x,y,z)){
          const pad = document.createElement("div");
          pad.className = "pad";
          cf.appendChild(pad);
        }
        cubie.appendChild(cf);
      }
      cubies[x+","+y+","+z] = cubie;
      cube.appendChild(cubie);
    }
    // link each facelet to its coloured pad + wire up editing
    for(const key of FACE_KEYS){
      const base = faceBase(key);
      for(let i=0;i<9;i++){
        const r=(i/3)|0, c=i%3;
        const [x,y,z] = faceletCubie(key,r,c);
        const pad = cubies[x+","+y+","+z].querySelector(".cf-"+key+" .pad");
        const idx = base+i;
        padRef[idx] = pad;
        pad.dataset.idx = idx;
        if(i===4) pad.classList.add("fixed");
        else pad.onclick = ()=>onSticker(idx);
      }
    }
    applyView();
    paintCube();
  }

  function cubieTransform(x,y,z){
    return "translate3d(calc(var(--cu)*"+x+"),calc(var(--cu)*"+y+"),calc(var(--cu)*"+z+"))";
  }

  function colorsForRender(){
    return mode==="edit" ? inputColors : frames[stepIndex];
  }
  function paintCube(){
    const cols = colorsForRender();
    for(let i=0;i<54;i++){ if(padRef[i]) padRef[i].style.background = COLORS[cols[i]] || "#2a2a2d"; }
    // highlight the stickers of the face the current move turns
    for(let i=0;i<54;i++){ if(padRef[i]) padRef[i].classList.remove("turn"); }
    if(mode==="solve" && stepIndex < solution.length){
      const key = solution[stepIndex][0];
      const base = faceBase(key);
      for(let i=0;i<9;i++){ if(padRef[base+i]) padRef[base+i].classList.add("turn"); }
    }
  }

  // view rotation -----------------------------------------------------------
  function applyView(){
    const cube = $("cube");
    cube.style.setProperty("--rx", viewRX+"deg");
    cube.style.setProperty("--ry", viewRY+"deg");
  }
  function rotateView(dx,dy){ viewRX+=dx; viewRY+=dy; applyView(); }
  function faceToFront(face){
    const [tx,ty] = FACE_VIEW[face] || [0,0];
    viewRX = nearestAngle(viewRX, tx);
    viewRY = nearestAngle(viewRY, ty);
    applyView();
  }
  function nearestAngle(current, target){
    let t = target;
    while(t - current > 180) t -= 360;
    while(t - current < -180) t += 360;
    return t;
  }

  function onSticker(idx){
    if(mode!=="edit") return;
    if(idx%9===4) return;       // centre is fixed
    inputColors[idx]=selectedColor;
    paintCube();
  }

  // ---- animated layer turn -------------------------------------------------
  // Rotate the cubies of `mv`'s layer, then bake (snap back + recolour) by
  // calling done(). Cubies stay at fixed positions; we only animate the visual
  // turn and then repaint to the next state.
  function animateTurn(mv, done){
    const face = mv[0];
    const a = MOVE_ANIM[face];
    const amt = mv[1]==="'" ? -1 : mv[1]==="2" ? 2 : 1;
    const deg = a.deg*amt;
    const cube = $("cube");
    const layer = document.createElement("div");
    layer.className = "layer";
    cube.appendChild(layer);
    const moved = [];
    for(const k in cubies){
      const [x,y,z] = k.split(",").map(Number);
      if(a.sel(x,y,z)){ layer.appendChild(cubies[k]); moved.push(cubies[k]); }
    }
    // force a reflow so the starting transform is registered before we animate
    void layer.offsetWidth;
    layer.style.transform = "rotate"+a.axis+"("+deg+"deg)";
    let finished = false;
    const finish = ()=>{
      if(finished) return; finished = true;
      // move cubies back to the cube (their per-cubie transforms are unchanged)
      for(const c of moved) cube.appendChild(c);
      layer.remove();
      done();
    };
    layer.addEventListener("transitionend", finish, {once:true});
    setTimeout(finish, TURN_MS+120);  // safety net if transitionend doesn't fire
  }

  // actions ------------------------------------------------------------------
  function reset(){
    stopPlay();
    inputColors = CS.stateToFacelets(CS.solvedState());
    setMode("edit");
    setStatus("");
    paintCube();
  }
  function scramble(){
    stopPlay();
    const scr = CS.randomScramble(25);
    const st = CS.applySeq(CS.solvedState(), scr);
    inputColors = CS.stateToFacelets(st);
    setMode("edit");
    setStatus("Door elkaar gegooid – druk op Los op!");
    paintCube();
  }

  // Run the (heavy) solve off the main thread when possible so the page never
  // freezes. The worker uses the Kociemba two-phase solver (~20-move solutions)
  // and falls back to the layer-by-layer solver if needed.
  let worker, solveCallback=null;
  function getWorker(){
    if(worker!==undefined) return worker;
    try{
      const src = document.getElementById("solver-src").textContent + "\n" +
                  document.getElementById("kociemba-src").textContent +
        "\nonmessage=function(e){var d=e.data;" +
        "if(d.type==='warmup'){try{Kociemba.buildTables();}catch(_){};postMessage({type:'warmup'});return;}" +
        "var sol;try{Kociemba.buildTables();sol=Kociemba.solve(d.state,{maxTime:500});if(!sol)sol=solveCube(d.state);}" +
        "catch(err){try{sol=solveCube(d.state);}catch(e2){sol=null;}}" +
        "postMessage({type:'solve',sol:sol});};";
      const url = URL.createObjectURL(new Blob([src],{type:"application/javascript"}));
      worker = new Worker(url);
      worker.onmessage = (e)=>{
        if(e.data.type==="solve" && solveCallback){ const cb=solveCallback; solveCallback=null; cb(e.data.sol); }
      };
    }catch(e){ worker = null; }
    return worker;
  }

  // main-thread solve (fallback when Workers are unavailable)
  function solveLocal(state){
    let sol=null;
    try{ if(window.Kociemba){ window.Kociemba.buildTables(); sol=window.Kociemba.solve(state,{maxTime:500}); } }catch(e){}
    if(!sol){ try{ sol=CS.solveCube(state); }catch(e){ sol=null; } }
    return sol;
  }

  function solve(){
    const res = CS.faceletsToState(inputColors);
    if(res.error){ setStatus("⚠ "+res.error, true); return; }
    setStatus("Bezig met oplossen…");
    const onSolved = (sol)=>{
      if(sol===null||sol===undefined){ setStatus("⚠ Deze kubus kan niet opgelost worden.", true); return; }
      solution = sol;
      frames = [inputColors.slice()];
      let st = CS.clone(res.state);
      for(const mv of sol){ st = CS.applySeq(st, [mv]); frames.push(CS.stateToFacelets(st)); }
      stepIndex = 0;
      setMode("solve");
      renderSolution();
      setStatus(sol.length===0 ? "Deze kubus is al opgelost! 🎉"
                               : "Opgelost in "+sol.length+" zetten 🎉");
      if(solution.length) faceToFront(solution[0][0]);
      afterStep();
    };
    const w = getWorker();
    if(w){
      solveCallback = onSolved;
      w.postMessage({type:"solve", state:res.state});
    } else {
      setTimeout(()=>onSolved(solveLocal(res.state)), 30);
    }
  }

  // solution rendering -------------------------------------------------------
  function renderSolution(){
    const list = $("movelist");
    list.innerHTML = "";
    solution.forEach((mv,i)=>{
      const chip = document.createElement("span");
      chip.className = "movechip";
      chip.textContent = mv;
      chip.dataset.i = i;
      chip.onclick = ()=>{ if(animating) return; stopPlay(); snapTo(i); };
      list.appendChild(chip);
    });
    updateChips();
    updateMoveInfo();
  }
  function updateChips(){
    document.querySelectorAll(".movechip").forEach(c=>{
      const i=+c.dataset.i;
      c.classList.toggle("done", i<stepIndex);
      c.classList.toggle("current", i===stepIndex);
    });
  }
  function updateMoveInfo(){
    const info = $("moveinfo");
    if(stepIndex<solution.length){
      const mv = solution[stepIndex];
      info.innerHTML = '<span class="bignote">'+mv+'</span>'+
                       '<span class="bigtext">'+(MOVE_TEXT[mv]||"")+'</span>'+
                       '<span class="bigsub">Druk op ▶ en draai precies mee met de kubus</span>'+
                       '<span class="counter">Zet '+(stepIndex+1)+' / '+solution.length+'</span>';
    } else {
      info.innerHTML = '<span class="bignote">✓</span><span class="bigtext">Klaar! De kubus is opgelost.</span>';
    }
  }
  // settle on a step without animating the turn (used for prev / jumps)
  function afterStep(){
    updateChips(); updateMoveInfo();
    if(mode==="solve" && stepIndex<solution.length) faceToFront(solution[stepIndex][0]);
    paintCube();
  }
  function snapTo(i){
    stepIndex = Math.max(0, Math.min(frames.length-1, i));
    afterStep();
  }

  // advance one move WITH animation
  function advance(){
    if(animating) return;
    if(stepIndex>=solution.length){ return; }
    const mv = solution[stepIndex];
    faceToFront(mv[0]);                       // make sure the layer faces us
    // give the cube a moment to rotate into view, then turn the layer
    animating = true;
    setTimeout(()=>{
      animateTurn(mv, ()=>{
        animating = false;
        stepIndex++;
        afterStep();
        if(playing){
          if(stepIndex>=solution.length){ stopPlay(); }
          else { playTimer = setTimeout(advance, 350); }
        }
      });
    }, 220);
  }

  function step(d){
    stopPlay();
    if(animating) return;
    if(d>0){ advance(); return; }            // forward = animated turn
    snapTo(stepIndex+d);                      // backward = snap
  }
  function gotoStart(){ stopPlay(); if(animating) return; snapTo(0); }
  function gotoEnd(){ stopPlay(); if(animating) return; snapTo(frames.length-1); }

  function play(){
    if(playing){ stopPlay(); return; }
    if(stepIndex>=solution.length) snapTo(0);
    playing=true; $("playBtn").textContent="⏸ Pauze";
    advance();
  }
  function stopPlay(){
    playing=false; if(playTimer){ clearTimeout(playTimer); playTimer=null; }
    const pb=$("playBtn"); if(pb) pb.textContent="▶ Speel af";
  }

  // mode / ui ----------------------------------------------------------------
  function setMode(m){
    mode=m;
    $("editControls").style.display = m==="edit"?"flex":"none";
    $("solvePanel").style.display = m==="solve"?"block":"none";
    $("paletteWrap").style.display = m==="edit"?"block":"none";
    document.body.classList.toggle("solving", m==="solve");
  }
  function setStatus(t, warn){
    const s=$("status"); s.textContent=t||""; s.classList.toggle("warn", !!warn);
  }

  // init ---------------------------------------------------------------------
  function init(){
    buildPalette();
    buildCube();
    setMode("edit");
    $("scrambleBtn").onclick = scramble;
    $("resetBtn").onclick = reset;
    $("solveBtn").onclick = solve;
    $("rotSide").onclick = ()=>rotateView(0,-90);
    $("rotUp").onclick = ()=>rotateView(90,0);
    $("editBtn").onclick = ()=>{ stopPlay(); setMode("edit"); setStatus(""); paintCube(); };
    $("firstBtn").onclick = gotoStart;
    $("prevBtn").onclick = ()=>step(-1);
    $("nextBtn").onclick = ()=>step(1);
    $("lastBtn").onclick = gotoEnd;
    $("playBtn").onclick = play;
    // warm up the heavy solver tables in the background so the first solve is fast
    setTimeout(()=>{
      const w = getWorker();
      if(w){ w.postMessage({type:"warmup"}); }
      else { try{ if(window.Kociemba) window.Kociemba.buildTables(); }catch(e){} }
    }, 200);
  }
  if(document.readyState!=="loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
