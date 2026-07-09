# CLAUDE.md — gids voor de volgende agent

Korte, praktische uitleg over hoe deze repo werkt. Lees dit eerst.

## Wat is dit?

**Spellenhoek** — een verzameling kleine spellen / speel-tools voor in de
browser. Geen framework, geen npm-dependencies. Elke spelpagina is
zelfstandige HTML/CSS/JS. Er is één minimale **Node-server**
(`server/server.js`, alleen ingebouwde modules) die de site serveert én het
boerenbridge-API + SSE levert; de overige spellen doen geen enkele request en
werken ook als los bestand. Deploy = Docker op de thuisserver (zie README;
de compose-service staat in de aparte `manor`-repo). GitHub Pages wordt
**niet** meer gebruikt.

UI-teksten zijn in het **Nederlands**. Houd dat zo.

## Structuur

```
index.html                     # homepage: overzicht met een kaartje per spel
server/
  server.js                    # statische site + /api/boerenbridge/* + SSE
  logic.js                     # autoritatieve boerenbridge-logica (pure functies)
games/
  boerenbridge/index.html      # invoerpagina (telefoon) — praat met het API
  boerenbridge/display/        # live scorebord (iPad/tweede scherm) — SSE
  cube-solver/index.html       # GEBOUWD bestand — NIET met de hand bewerken
  wafelwoorden/index.html      # los, zelfstandig spel (met de hand bewerkbaar)
src/
  cube-solver/                 # BRON van de cube-solver
    template.html              #   HTML + CSS, met /*__SOLVER__*/ etc. placeholders
    solver.js                  #   kubusmodel + facelet-conversie + LBL-fallback
    kociemba.js                #   Kociemba two-phase oplosser (±20 zetten)
    app.js                     #   mobiele UI-logica (Web Worker)
build.js                       # bouwt src/cube-solver/* -> games/cube-solver/index.html
test/api.test.js               # end-to-end test van server + API (node test/api.test.js)
data/                          # spelgegevens (gitignored; Docker-volume)
README.md                      # gebruikersgerichte uitleg
Dockerfile                     # node:22-alpine, geen npm install
```

## De server / boerenbridge-sync

- **Zero dependencies is een harde regel**, ook voor de server: alleen
  `node:http`, `node:fs`, `node:path`, `node:crypto`. Start: `node server/server.js`
  (env: `PORT`, `DATA_DIR`).
- **De server is autoritatief.** Alle spelregels (rondeschema 8→1→8,
  scoreformule, deler/beurtvolgorde, validatie) staan in `server/logic.js`.
  De pagina's zijn pure renderers van het "verrijkte" game-object dat elke
  mutatie-POST teruggeeft en dat ook via SSE wordt gebroadcast. Dupliceer
  spelregels nooit in de clients.
- **Concurrency-guard:** mutaties sturen `round` mee; klopt die niet met
  `currentRound`/`phase` op de server → 409, en de client refetcht. Geen
  client-side reconciliatie.
- **SSE** (`/api/boerenbridge/events`): bij connect en na elke mutatie gaat
  de **volledige snapshot** over de lijn (nooit deltas), plus een
  `ping`-event elke 25 s. `server.requestTimeout = 0` staat bewust aan —
  Node ≥18 kapt anders long-lived responses na 5 min af.
- **Persistentie:** `data/boerenbridge.json`, synchrone save via tmp-bestand
  + atomische rename. Corrupt bestand bij startup wordt gequarantained
  (hernoemd), nooit crash-loopen.
- Nieuw server-backed spel? Namespace het API onder `/api/<spel>/` en houd
  de logica in een eigen pure module naast `logic.js`.

## Build

De cube-solver is één self-contained bestand dat wordt **samengesteld**:

```
node build.js
```

`build.js` leest `template.html` en vervangt de placeholders
`/*__SOLVER__*/`, `/*__KOCIEMBA__*/`, `/*__APP__*/` door de inhoud van
`solver.js`, `kociemba.js` en `app.js` (elk in een eigen `<script>`).

> **Belangrijk:** bewerk nooit `games/cube-solver/index.html` direct — die wordt
> overschreven. Wijzig de bestanden in `src/cube-solver/` en draai `node build.js`.

De andere spellen (zoals `wafelwoorden`) zijn losse self-contained bestanden;
die hebben geen build-stap.

## De cube-solver van binnen

Cubie-model (in `solver.js`), gedeeld door beide solvers:
- Hoeken `URF UFL ULB UBR DFR DLF DBL DRB` = 0..7, met oriëntatie `co` (mod 3).
- Randen `UR UF UL UB DR DF DL DB FR FL BL BR` = 0..11, met oriëntatie `eo` (mod 2).
- E-slice (equator) randen = FR,FL,BL,BR = indices 8..11.
- State = `{cp, co, ep, eo}`. De 6 basisdraaiingen staan in `MOVES`.
- Facelet-layout = Kociemba (U=0..8 R=9..17 F=18..26 D=27..35 L=36..44 B=45..53);
  `stateToFacelets` / `faceletsToState` met validatie (ongeldige kubus → foutmelding).

Twee oplossers:
1. **`kociemba.js` (primair, ±20 zetten).** Two-phase met coördinaten
   (twist/flip/slice → fase 1; hoekperm/randperm/sliceperm → fase 2),
   vooraf berekende **pruning-tabellen** (BFS) en IDA\*. `Kociemba.buildTables()`
   duurt ~0,8 s en wordt gecachet. `Kociemba.solve(state, {maxTime})`.
2. **`solver.js` `solveCube` (fallback, laag-voor-laag).** Onderlaag via korte
   IDA\*-zoek, middenlaag deterministisch, laatste laag via een complete
   BFS-tabel (62 208 toestanden). Langer (~90 zetten) maar simpel.

De UI (`app.js`) draait de solve in een **Web Worker** (gebouwd uit de
ingebedde `<script id="solver-src">` + `<script id="kociemba-src">` via een
Blob). Bij geen Worker valt hij terug op de main thread. Worker → Kociemba,
en als die `null` geeft → `solveCube`.

## Testen (doe dit, er is geen CI)

**Server/boerenbridge:** `node test/api.test.js` — spawnt de echte server met
een tijdelijke datamap en test spelverloop, scoreformule (tegen een
onafhankelijke herimplementatie), 409-guards, undo, klassement, SSE,
path-traversal en persistentie. Draai dit na elke server- of logica-wijziging.

`solver.js` en `kociemba.js` draaien ook in **Node** (ze exporteren via
`module.exports`). Test solver-logica direct:

```js
const S = require('./src/cube-solver/solver.js');
const K = require('./src/cube-solver/kociemba.js');
K.buildTables();
const s = S.applySeq(S.solvedState(), S.randomScramble(25));
const sol = K.solve(S.clone(s), {maxTime:500});
console.log(S.isSolved(S.applySeq(S.clone(s), sol)), sol.length);
```

Verifieer altijd door duizenden willekeurige scrambles op te lossen en
`isSolved` te checken — niet door een paar voorbeelden te bekijken.

UI end-to-end: `jsdom` is beschikbaar (`npm install jsdom --no-save`). Laad het
**gebouwde** `games/cube-solver/index.html` met `runScripts:"dangerously"`. In
jsdom bestaat er geen `Worker`, dus dan loopt de **main-thread fallback** — dat
test de solver-integratie maar niet de worker zelf.

## Valkuilen (echt gebeurd)

- **Slice-coördinaat:** voor de opgeloste kubus is `getSlice` = **494** (niet 0),
  want de comb-index van posities {8,9,10,11} is de hoogste. De pruning-BFS start
  daarom op `SLICE_SOLVED`, en de fase-1 goal checkt `slice === SLICE_SOLVED`.
- **Worker scope:** in de Worker bestaat `window` niet. `solver.js` zet
  `CubeSolver` als top-level `const`; `kociemba.js` pakt die via de gedeelde
  lexicale scope (solver-script staat eerst in de Blob). Verbreek die volgorde niet.
- **Tabellen snel bouwen:** bouw move-tabellen met lichte array-rekenkunde op de
  coördinaatvectoren, NIET met `clone()` + `applyMove()` per entry (dat was ~50×
  trager). Zie de `buildTables`-aanpak in `kociemba.js`.
- **`node_modules/`** staat in `.gitignore` (alleen `jsdom` voor tests). Niet committen.

## Een spel toevoegen

1. Maak `games/<naam>/index.html` als zelfstandige pagina. Zet bovenin een
   `<a class="backlink" href="../../index.html">← Alle spellen</a>`.
2. Voeg in `index.html` een kaartje toe (kopieer een bestaand
   `<a class="game">`-blok: icoon, naam, omschrijving, tag).
3. Heeft het een build-stap nodig? Volg het `src/` + `build.js`-patroon van de
   cube-solver.

## Conventies

- Nederlands in de UI; commit-berichten mogen Nederlands of Engels.
- Self-contained pagina's, geen externe requests of CDN's. Requests naar de
  eigen server (relatieve `/api/...`-paden) zijn de enige uitzondering.
- Mobiel-eerst, donker thema. Homepage-accent `#5b8cff`; spel-accent groen.
- Geen auth: bedoeld voor een vertrouwd thuisnetwerk (staat ook in README).
- Commit & push alleen wanneer de gebruiker erom vraagt; ontwikkel op de
  feature-branch (geen `main`). Maak geen PR tenzij gevraagd.
