// ============================================================================
//  Rubik's Cube Solver – UI logic (mobile first, 3D view)
//  Relies on global `CubeSolver` (see solver.js).
// ============================================================================
(function(){
  const CS = window.CubeSolver;

  // colour index: 0=U(wit) 1=R(rood) 2=F(groen) 3=D(geel) 4=L(oranje) 5=B(blauw)
  const COLORS = ["#f7f7f7","#c41e3a","#1faa47","#ffd500","#ff7a1a","#0051ba"];
  const COLOR_NAMES = ["Wit","Rood","Groen","Geel","Oranje","Blauw"];
  const FACE_KEYS = ["U","R","F","D","L","B"];
  const FACE_NAMES = {U:"Boven",R:"Rechts",F:"Voor",D:"Onder",L:"Links",B:"Achter"};

  // Human-readable move descriptions — consistent "klok"-logica for every face.
  // A turn is "met de klok mee" / "tegen de klok in" gezien als je RECHT naar
  // dat vlak kijkt (de cube draait daar vanzelf naartoe tijdens het afspelen).
  const MOVE_TEXT = {
    "U":"Bovenkant met de klok mee","U'":"Bovenkant tegen de klok in","U2":"Bovenkant halve draai",
    "D":"Onderkant met de klok mee","D'":"Onderkant tegen de klok in","D2":"Onderkant halve draai",
    "R":"Rechterkant met de klok mee","R'":"Rechterkant tegen de klok in","R2":"Rechterkant halve draai",
    "L":"Linkerkant met de klok mee","L'":"Linkerkant tegen de klok in","L2":"Linkerkant halve draai",
    "F":"Voorkant met de klok mee","F'":"Voorkant tegen de klok in","F2":"Voorkant halve draai",
    "B":"Achterkant met de klok mee","B'":"Achterkant tegen de klok in","B2":"Achterkant halve draai",
  };

  // Cube-rotation (rx,ry in degrees) that brings a given face to the front,
  // so the player looks straight at the turning face. Derived from the CSS
  // face transforms; combined with the constant iso-tilt of the .tilt wrapper.
  const FACE_VIEW = {
    F:[0,0], B:[0,180], R:[0,-90], L:[0,90], U:[-90,0], D:[90,0],
  };

  // state -------------------------------------------------------------------
  let inputColors = CS.stateToFacelets(CS.solvedState()); // 54 colour indices
  let selectedColor = 0;
  let mode = "edit";          // "edit" | "solve"
  let frames = [];            // array of 54-colour arrays, one per step
  let solution = [];          // move tokens
  let stepIndex = 0;          // current playback frame
  let playing = false, playTimer = null;
  let viewRX = 0, viewRY = 0; // current cube rotation (degrees)

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

  // Build the 3D cube: six faces, each a row-major 3x3 grid of stickers. The
  // CSS face transforms place them so the layout matches the solver's facelet
  // model exactly (so colouring corresponds 1:1 with a real cube).
  function buildCube(){
    const cube = $("cube");
    cube.innerHTML = "";
    for(const key of FACE_KEYS){
      const face = document.createElement("div");
      face.className = "cubeface face-"+key;
      face.dataset.face = key;
      const base = faceBase(key);
      for(let i=0;i<9;i++){
        const cell = document.createElement("div");
        cell.className = "sticker";
        cell.dataset.idx = base+i;
        if(i===4) cell.classList.add("center"); // centre fixed
        cell.onclick = ()=>onSticker(base+i);
        face.appendChild(cell);
      }
      cube.appendChild(face);
    }
    applyView();
    paintCube();
  }

  function colorsForRender(){
    return mode==="edit" ? inputColors : frames[stepIndex];
  }
  function paintCube(){
    const cols = colorsForRender();
    document.querySelectorAll(".sticker").forEach(cell=>{
      const idx = +cell.dataset.idx;
      cell.style.background = COLORS[cols[idx]] || "#2a2a2d";
    });
    // highlight the face that the current move turns
    document.querySelectorAll(".cubeface").forEach(f=>f.classList.remove("turn"));
    if(mode==="solve" && stepIndex < solution.length){
      const f = solution[stepIndex][0];
      const el = document.querySelector('.cubeface[data-face="'+f+'"]');
      if(el) el.classList.add("turn");
    }
  }

  // view rotation -----------------------------------------------------------
  function applyView(){
    const cube = $("cube");
    cube.style.setProperty("--rx", viewRX+"deg");
    cube.style.setProperty("--ry", viewRY+"deg");
  }
  function rotateView(dx,dy){ viewRX+=dx; viewRY+=dy; applyView(); }
  // turn the cube so `face` looks straight at the viewer, taking the short way
  function faceToFront(face){
    const [tx,ty] = FACE_VIEW[face] || [0,0];
    viewRX = nearestAngle(viewRX, tx);
    viewRY = nearestAngle(viewRY, ty);
    applyView();
  }
  // pick the multiple-of-360 representation of `target` closest to `current`
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
      chip.onclick = ()=>{ stopPlay(); stepIndex=i; afterStep(); };
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
                       '<span class="bigsub">(de kubus draait dat vlak naar je toe)</span>'+
                       '<span class="counter">Zet '+(stepIndex+1)+' / '+solution.length+'</span>';
    } else {
      info.innerHTML = '<span class="bignote">✓</span><span class="bigtext">Klaar! De kubus is opgelost.</span>';
    }
  }
  function afterStep(){
    updateChips(); updateMoveInfo();
    // turn the cube so the face we're about to move looks straight at us
    if(mode==="solve" && stepIndex<solution.length) faceToFront(solution[stepIndex][0]);
    paintCube();
  }

  function step(d){
    stopPlay();
    stepIndex = Math.max(0, Math.min(frames.length-1, stepIndex+d));
    afterStep();
  }
  function gotoStart(){ stopPlay(); stepIndex=0; afterStep(); }
  function gotoEnd(){ stopPlay(); stepIndex=frames.length-1; afterStep(); }

  function play(){
    if(playing){ stopPlay(); return; }
    if(stepIndex>=frames.length-1) stepIndex=0;
    playing=true; $("playBtn").textContent="⏸ Pauze";
    playTimer = setInterval(()=>{
      if(stepIndex>=frames.length-1){ stopPlay(); afterStep(); return; }
      stepIndex++; afterStep();
    }, 900);
  }
  function stopPlay(){
    playing=false; if(playTimer){ clearInterval(playTimer); playTimer=null; }
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
