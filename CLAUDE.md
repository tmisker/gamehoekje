# CLAUDE.md — gids voor de volgende agent

Korte, praktische uitleg over hoe deze repo werkt. Lees dit eerst.

## Wat is dit?

**Spellenhoek** — een verzameling kleine spellen / speel-tools voor in de
browser. Geen framework, geen npm-dependencies. Elke spelpagina is
zelfstandige HTML/CSS/JS. Er is één minimale **Node-server**
(`server/server.js`, alleen ingebouwde modules) die de site serveert én de
spel-API's + SSE levert (boerenbridge, klaverjas, tafeltennis); de overige spellen doen
geen enkele request en werken ook als los bestand. Deploy = Docker op de thuisserver (zie README;
de compose-service staat in de aparte `manor`-repo). GitHub Pages wordt
**niet** meer gebruikt.

UI-teksten zijn in het **Nederlands**. Houd dat zo.

## Structuur

```
index.html                     # homepage: overzicht met een kaartje per spel
server/
  server.js                    # statische site + /api/{boerenbridge,klaverjas,tafeltennis}/* + SSE
  shared.js                    # gedeelde, spel-onafhankelijke helpers (klassement, httpError)
  logic.js                     # autoritatieve boerenbridge-logica (pure functies)
  klaverjas.js                 # autoritatieve klaverjas-logica (pure functies)
  tafeltennis.js               # autoritatieve toernooilogica tafeltennis (pure functies)
games/
  boerenbridge/index.html      # invoerpagina (telefoon) — praat met het API
  boerenbridge/display/        # live scorebord (iPad/tweede scherm) — SSE
  klaverjas/index.html         # klaverjas-invoerpagina (telefoon) — praat met het API
  klaverjas/display/           # live scorebord (iPad/tweede scherm) — SSE
  tafeltennis/index.html       # toernooi-invoerpagina (telefoon) — praat met het API
  tafeltennis/display/         # live scorebord: tafels, stand/kruistabel, schema — SSE
  cube-solver/index.html       # GEBOUWD bestand — NIET met de hand bewerken
  wafelwoorden/index.html      # los, zelfstandig spel (met de hand bewerkbaar)
src/
  cube-solver/                 # BRON van de cube-solver
    template.html              #   HTML + CSS, met /*__SOLVER__*/ etc. placeholders
    solver.js                  #   kubusmodel + facelet-conversie + LBL-fallback
    kociemba.js                #   Kociemba two-phase oplosser (±20 zetten)
    app.js                     #   mobiele UI-logica (Web Worker)
build.js                       # bouwt src/cube-solver/* -> games/cube-solver/index.html
test/api.test.js               # end-to-end test van server + boerenbridge-API
test/klaverjas.test.js         # end-to-end test van het klaverjas-API
test/tafeltennis.test.js       # end-to-end test van het tafeltennis-API
test/solver.test.js            # cube-solver op honderden scrambles (node test/solver.test.js)
data/                          # spelgegevens (gitignored; Docker-volume)
README.md                      # gebruikersgerichte uitleg
Dockerfile                     # node:22-alpine, geen npm install
```

## De server / spel-API's

- **Zero dependencies is een harde regel**, ook voor de server: alleen
  `node:http`, `node:fs`, `node:path`, `node:crypto`. Start: `node server/server.js`
  (env: `PORT`, `DATA_DIR`).
- **De server is autoritatief.** Alle spelregels (boerenbridge: rondeschema
  8→1→8, scoreformule, deler/beurtvolgorde; klaverjas: nat, roem, pit,
  16 rondes, twee fasen; tafeltennis: poule-indeling, game-validatie,
  tiebreaks, schema/seeding) staan in `server/logic.js`, `server/klaverjas.js`
  en `server/tafeltennis.js`.
  De pagina's zijn pure renderers van het "verrijkte" game-object dat elke
  mutatie-POST teruggeeft (en bij boerenbridge ook via SSE wordt gebroadcast).
  Dupliceer spelregels nooit in de clients — de klaverjaspagina rekent
  bewust géén score vooruit, ze toont wat de server terugstuurt.
- **Eén store per spel.** `createStore(bestand)` in `server.js` geeft elke
  spel-API zijn eigen `games`-lijst en databestand; `server/shared.js` bevat
  wat écht spel-onafhankelijk is (het klassement-filter, `httpError`).
  `createChannel(snapshotFn)` doet hetzelfde voor SSE: één live-kanaal per
  spel, met een eigen clientlijst en winnaarscherm-timer.
- **Klaverjas telt in twee fasen per ronde.** `POST .../start` legt aan het
  begin van de ronde troef + spelende partij vast (`game.pending`), zodat het
  scorebord tijdens het spelen al weet wat troef is; `POST .../round` voegt na
  afloop de telling toe. `undo` loopt die twee stappen terug in omgekeerde
  volgorde.
- **Concurrency-guard:** mutaties sturen `round` mee; klopt die niet met
  `currentRound`/`phase` op de server → 409, en de client refetcht. Geen
  client-side reconciliatie. Bij tafeltennis is de wedstrijd zelf de guard
  (uitslag al ingevoerd / spelers nog onbekend → 409) en stuurt `undo` de
  `revision` (= aantal ingevoerde uitslagen) mee.
- **Tafeltennis (4T) in het kort:** `createGame` maakt álle wedstrijden vooraf
  aan (`game.matches`, in speelvolgorde): de poule via de cirkelmethode
  (`pouleSchedule`), een knock-outschema via `buildBracket` met standaard
  seeding (`seedOrder`: 1–8, 4–5, 2–7, 3–6) en `NOBODY` (-1) voor lege plekken.
  Eindronde-wedstrijden kennen hun bronnen (`from: [{match, take}]`);
  `propagate` vult plekken door en beslist vrije rondes (byes) automatisch, ook
  terug na undo. Uitslagen mogen in elke volgorde (`POST .../result` met
  `matchId`); `game.history` is de invoervolgorde, undo = LIFO. `settle` bouwt
  de eindronde zodra de poule uit is en sluit/heropent het toernooi. Undo van
  een poulewedstrijd bij poule+eindronde gooit de (dan nog ongespeelde)
  eindronde weg. De stand (`standings`) rangschikt recursief: winst → onderling
  (winst, game-, puntensaldo) → saldo over de hele poule → gedeelde plek.
  `.../draft` is de live tussenstand van één wedstrijd (niet-autoritatief).
- **Boerenbridge kent concept-invoer ("draft"):** de invoerpagina POST elke
  aangetikte keuze naar `.../draft` (`{round, phase, values}` met `null` voor
  "nog niet gekozen"). Dat is niet-autoritatief — het telt nergens in mee —
  maar komt wel in `game.draft` en dus in de SSE-snapshot, zodat het scorebord
  live kan tonen wie hoeveel vraagt/haalt. Elke echte mutatie
  (predictions/actuals/undo/abandon) wist de draft. Het display kiest op basis
  van `phase` + `draft` tussen vier schermen: voorspellen (draft-invoer
  loopt), spelen, tussenstand, eindstand.
- **De tussenstand komt van de server.** `enrich` levert naast `totals` ook
  `cumulative` (`[ronde][speler]` = stand t/m die ronde; `getTotals` is de
  laatste rij), `positions` (plek in de stand, gelijke totalen delen een plek
  en de volgende plek slaat over) en `projection` (alleen in de slagen-fase
  mét draft: `{deltas, totals, positions}` — de stand als de concept-invoer
  klopt). Beide pagina's renderen die velden alleen; `scoreRound` mag niet
  in een client terechtkomen. De invoerpagina pakt de projectie uit het
  antwoord op de draft-POST en werkt daarmee alléén `#projLine` bij — niet
  het formulier, want dan zou de invoer onder je vingers opnieuw opbouwen.
  De verloopgrafiek op het display wordt ná het invoegen getekend
  (`drawTrend`), op de gemeten pixelmaat van zijn paneel; daarom ook een
  resize-listener.
- **SSE** (`/api/<spel>/events`): bij connect en na elke mutatie gaat
  de **volledige snapshot** over de lijn (nooit deltas), plus een
  `ping`-event elke 25 s. `server.requestTimeout = 0` staat bewust aan —
  Node ≥18 kapt anders long-lived responses na 5 min af.
- **Persistentie:** `data/boerenbridge.json` en `data/klaverjas.json`, synchrone save via tmp-bestand
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

**Server:** `node test/api.test.js` (boerenbridge), `node test/klaverjas.test.js`
en `node test/tafeltennis.test.js` — alle drie spawnen de echte server met een
tijdelijke datamap en testen spelverloop, de scoreformule/stand (tegen een
onafhankelijke herimplementatie in de test zelf), 409-guards, undo,
klassement, SSE en persistentie; de boerenbridge-suite doet ook
path-traversal. Draai **alle drie** na elke wijziging in `server/` —
`shared.js` wordt door alle spellen gebruikt.

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
`node test/solver.test.js` doet precies dat (aantallen via `N_KOCIEMBA`/`N_LBL`).

UI end-to-end: `jsdom` is beschikbaar (`npm install jsdom --no-save`). Laad het
**gebouwde** `games/cube-solver/index.html` met `runScripts:"dangerously"`. In
jsdom bestaat er geen `Worker`, dus dan loopt de **main-thread fallback** — dat
test de solver-integratie maar niet de worker zelf.

## Valkuilen (echt gebeurd)

- **Klaverjas is nat bij gelijkspel:** de spelende partij moet *méér* halen dan
  de tegenpartij; 81–81 (roem meegerekend) is dus nat. En bij nat gaat óók de
  roem van de spelende partij naar de tegenpartij.
- **Pit is alleen voor de spelende partij** (huisregel; tegenpit bestaat hier
  niet). Wie geen slag pakt kan bovendien geen roem hebben gemaakt, dus
  `applyRound` weigert pit zonder alle 162 punten, pit met roem bij de
  tegenpartij, en pit samen met nat.
- **Nat mag zonder telling:** `points: null` (via `nat: true`) betekent "nat
  verklaard". Dat kan omdat bij nat de puntenverdeling voor de score niet
  uitmaakt — de tegenpartij krijgt sowieso 162 + alle roem.
- **Tafeltennis-poule met oneven aantal:** de cirkelmethode werkt met een lege
  plek (`NOBODY`); paren met die plek worden overgeslagen, dus rondes hebben
  dan `floor(n/2)` wedstrijden en er zijn `n` rondes i.p.v. `n-1`.
- **Wie "nu aan tafel" is** (`upNow`) is greedy: de eerste speelbare wedstrijden
  in schema-volgorde waarvan geen speler al bezig is, één per tafel. Dat wijkt
  bewust af van de strikte rondevolgorde zodra een tafel eerder klaar is.
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
