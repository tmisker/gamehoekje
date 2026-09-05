# 🎮 Spellenhoek

Een kleine verzameling spellen en speel-tools voor in de browser. De site
wordt geserveerd door een minimale Node-server (zonder dependencies) die ook
de scores van de kaartspellen bijhoudt; de overige spellen werken gewoon
offline als losse pagina's.

## Spellen

| Spel | Map | Wat |
|------|-----|-----|
| 🧩 **Kubus Solver** | `games/cube-solver/` | Kleur je Rubik's kubus in en los hem in ±20 zetten op (Kociemba two-phase), stap voor stap. |
| 🧇 **Wafelwoorden** | `games/wafelwoorden/` | Sleep de letters op hun plek en los de woordwafel op. |
| 🃏 **Boerenbridge** | `games/boerenbridge/` | Score bijhouden met twee apparaten: invoer op je telefoon, live scorebord op een tweede scherm. Met klassement over alle potjes. |
| 🂡 **Klaverjas** | `games/klaverjas/` | Een boompje van 16 rondes met twee teams: troef, punten, roem, nat en pit. Met live scorebord op een tweede scherm en klassement. |
| 🏓 **Tafeltennis** | `games/tafeltennis/` | Toernooitracker (4T): poule, poule + eindronde of knock-out, uitslagen per game met deuce-controle, live scorebord met stand, kruistabel en schema, en een klassement over toernooien heen. |

Elk spel is een zelfstandige pagina onder `games/<naam>/index.html` met een
link terug naar de homepage.

## Draaien

```
node server/server.js
```

De server (Node ≥ 18, geen npm-dependencies) serveert de hele site op
`http://localhost:3000` en biedt de spel-API's onder `/api/boerenbridge/`,
`/api/klaverjas/` en `/api/tafeltennis/`, elk met een eigen SSE-kanaal voor het
scorebord. Configuratie via omgevingsvariabelen:

- `PORT` – poort (standaard `3000`)
- `DATA_DIR` – map voor de databestanden `boerenbridge.json`,
  `klaverjas.json` en `tafeltennis.json` (standaard `./data`)

## Boerenbridge met twee apparaten

1. Open `games/boerenbridge/` op de telefoon van de scorebijhouder — hier
   start of hervat je een spel en voer je voorspellingen en slagen in.
   Aantallen tik je aan op knoppen (0 t/m het aantal kaarten). Bij de
   werkelijke slagen grijst de pagina onmogelijke aantallen uit: samen nooit
   meer dan het aantal kaarten, en de laatste speler kan alleen nog het
   exacte restant kiezen. Nogmaals tikken wist een keuze weer. Onder de
   slagen-invoer staat de tussenstand zoals die wordt als de ingetikte
   slagen kloppen; het scoreblok eronder toont per ronde de punten van die
   ronde én de stand op dat moment, met de plek in de stand onder het totaal.
2. Open `games/boerenbridge/display/` op een tweede apparaat (bijv. een iPad
   op tafel) — dit scorebord volgt het spel live via Server-Sent Events.
   Zonder actief spel toont het scherm het klassement. Tijdens een potje
   schakelt het vanzelf tussen vier weergaven: zodra de eerste voorspelling
   wordt aangetikt zie je live wie hoeveel vraagt en groot het totaal
   ("samen gevraagd"); tijdens het kaarten blijven ieders voorspelling en dat
   totaal groot in beeld (mét of er te veel of te weinig gevraagd is); na de
   telling komt de tussenstand met het scoreblok; en na de laatste ronde de
   eindstand. De tussenstand loopt door alle weergaven mee: elke spelerkaart
   toont zijn plek in de stand en zijn puntentotaal, tijdens het invoeren van
   de slagen met een pijl naar waar dat totaal op uitkomt. Naast het
   "samen gevraagd"-blok en naast het scoreblok staat een verloopgrafiek met
   één lijn per speler; loopt er slagen-invoer, dan wordt die lijn gestippeld
   doorgetrokken naar de verwachte stand. Op smalle schermen (< 900 px)
   vervalt de grafiek en blijven de cijfers.
3. Onder 🏆 Klassement op de telefoon kun je spelers aantikken om potjes
   waarin zij meededen weg te laten — handig als er af en toe kinderen
   meespelen. Je keuze blijft op dat toestel bewaard; het display toont
   altijd het volledige klassement.

Er is bewust geen authenticatie of koppelcode: dit is bedoeld voor een
vertrouwd thuisnetwerk. Zet het niet zonder extra maatregelen (reverse proxy
met auth) open naar internet.

Tip voor het display: zet automatische schermvergrendeling uit op het
apparaat, dat kan de pagina zelf niet regelen.

## Klaverjas met twee apparaten

1. Open `games/klaverjas/` op de telefoon van de scorebijhouder en vul vier
   namen in op zitvolgorde: speler 1 & 3 vormen samen een team, 2 & 4 ook.
2. Open `games/klaverjas/display/` op een tweede scherm — dat toont live de
   troef, wie er speelt, de standen en het scoreblok. Zonder actief potje
   staat daar het klassement.

Elke ronde gaat in twee stappen:

- **Vóór het spelen:** kies wie er speelt en wat troef is. Zodra je op
  *Ronde starten* drukt, staat de troef groot op het scorebord.
- **Na afloop:** vul de telling in. De punten zet je bij de partij die het
  snelst te tellen is — pakte de tegenpartij maar één slag, tik dan díe kant
  in; de andere kant vult zichzelf aan tot 162. Roem vul je per team in.

De server rekent de ronde uit:

- Haalt de spelende partij méér dan de tegenpartij, dan houdt elke partij
  haar eigen punten plus roem.
- Haalt ze het niet — ook bij precies gelijk — dan is ze **nat** en gaan alle
  kaartpunten én alle roem naar de tegenpartij. Weet je al dat ze nat zijn,
  druk dan gewoon op **Nat**: tellen hoeft dan niet meer, want de verdeling
  maakt voor de score toch niets uit.
- **Pit** (alle acht slagen) levert 100 punten bonus op. Huisregel hier: pit
  is voorbehouden aan de spelende partij — tegenpit bestaat niet. Wil je dat
  anders, dan zit die regel op één plek in `server/klaverjas.js`.

Na 16 rondes (elke speler heeft dan vier keer gedeeld) sluit het potje zichzelf
af en telt het mee voor het klassement. Een ronde verkeerd ingevoerd? Met
← Terug ga je stap voor stap terug — eerst de telling, dan de troefkeuze — ook
nadat het potje al is afgelopen. Net als bij boerenbridge kun je onder
🏆 Klassement spelers aantikken om potjes waarin zij meededen weg te laten.

## Tafeltennistoernooi met twee apparaten

1. Open `games/tafeltennis/` op de telefoon van de toernooileider. Vul de
   spelers in (3–16; bekende namen staan als tikbare suggesties klaar) en kies
   de toernooivorm:
   - **Poule** – iedereen tegen iedereen, de eindstand bepaalt de winnaar.
   - **Poule + eindronde** – na de poule gaan de beste 2, 4, 8 of 16 spelers
     naar een knock-outschema (1 tegen 4, 2 tegen 3, …), met optionele
     troostfinale om plek 3.
   - **Knock-out** – meteen een afvalschema; de invoervolgorde is de seeding
     en bij een aantal dat geen macht van twee is, krijgen de hoogste seeds
     een vrije ronde.
   Verder: best of 1/3/5/7, games tot 11 of 21 punten, invoer per game (punten)
   of alleen gewonnen games, en het aantal tafels (1–4).
2. Open `games/tafeltennis/display/` op een tweede scherm. Dat toont wie er nu
   aan welke tafel speelt en wie hierna komt, de poulestand met kruistabel
   (of de laatste uitslagen bij meer dan acht spelers), in de eindronde het
   schema, en na afloop het podium. Zonder toernooi staat er het klassement.

De poule is met de cirkelmethode ingedeeld, dus per ronde speelt iedereen
hooguit één keer. Uitslagen mag je in elke volgorde invoeren: tik een
wedstrijd aan onder *Nu aan tafel* of in de lijst. Bij invoer per game
verschijnt de volgende game vanzelf; met de knop **11 ▲** geef je een kant de
game (de andere kant vul je dan met de verliezende score aan). Terwijl je
typt gaat de tussenstand live naar het scorebord.

De server bewaakt de regels: een game win je met minstens 11 (of 21) punten
en twee verschil (boven de 11 dus precies twee, 12–10, 13–11, …), de
wedstrijd is uit zodra iemand de helft-plus-één van de best-of heeft, en
daarna volgen geen games meer. In de stand telt eerst het aantal gewonnen
wedstrijden; wie gelijk staat wordt onderling vergeleken (winst, dan game- en
puntensaldo in die onderlinge duels), daarna op game- en puntensaldo over de
hele poule. Wat dan nog gelijk is, deelt de plek (gemarkeerd met *); voor de
seeding van de eindronde geldt dan de invoervolgorde.

Met **← Laatste uitslag terugnemen** loop je de invoer stap voor stap terug,
ook over de fasegrens heen: neem je de laatste poulewedstrijd terug, dan
verdwijnt de (nog ongespeelde) eindronde en wordt die opnieuw ingedeeld zodra
de poule weer uit is. Het klassement telt per speler toernooien, titels,
podiumplaatsen en het winstpercentage over alle wedstrijden; ook hier kun je
spelers uitsluiten.

## Docker

```
docker build -t spellenhoek .
docker run -p 3000:3000 -v ./spellenhoek-data:/app/data spellenhoek
```

Voorbeeld voor een docker-compose homelab:

```yaml
spellenhoek:
  build: ./gamehoekje          # pad naar een checkout van deze repo
  container_name: spellenhoek
  restart: unless-stopped
  ports:
    - "3000:3000"
  volumes:
    - ./appdata/spellenhoek:/app/data
```

Achter een reverse proxy: zet response-buffering uit voor
`/api/boerenbridge/events`, `/api/klaverjas/events` en
`/api/tafeltennis/events` (SSE); de server stuurt
daarvoor zelf al `X-Accel-Buffering: no` en een heartbeat elke 25 s.

## Testen

```
node test/api.test.js
node test/klaverjas.test.js
node test/tafeltennis.test.js
node test/solver.test.js
```

`api.test.js` start de server op een vrije poort met een tijdelijke datamap
en test het volledige spelverloop, de scoreformule (tegen een onafhankelijke
herimplementatie), validatie en 409-guards, undo, het klassement, SSE,
path-traversal-bescherming en persistentie over een herstart.
`klaverjas.test.js` doet hetzelfde voor het klaverjas-API: de telling van
nat, roem en pit (opnieuw tegen een onafhankelijke herimplementatie), de twee
fasen per ronde, validatie, undo, het klassement per speler, SSE en de
gescheiden opslag naast boerenbridge.
`tafeltennis.test.js` speelt poules van 3–7 spelers uit in willekeurige
volgorde en vergelijkt stand en eindstand met een onafhankelijke
herimplementatie van de tiebreak-regels, en test verder de game-validatie
(deuce, best-of), seeding en doorschuiven in de eindronde, vrije rondes,
undo over de fasegrens, de live tussenstand, het klassement, SSE en
persistentie.
`solver.test.js` lost honderden willekeurige scrambles op met beide
oplossers en verifieert elke oplossing (aantallen instelbaar via
`N_KOCIEMBA` / `N_LBL`).

## Structuur

```
index.html                     # homepage / spellenoverzicht
server/
  server.js                    # statische site + spel-API's + SSE
  shared.js                    # gedeelde helpers (klassement, foutobjecten)
  logic.js                     # autoritatieve boerenbridge-logica
  klaverjas.js                 # autoritatieve klaverjas-logica
  tafeltennis.js               # autoritatieve toernooilogica (tafeltennis)
games/
  boerenbridge/index.html      # invoerpagina (telefoon)
  boerenbridge/display/        # live scorebord (tweede scherm)
  klaverjas/index.html         # klaverjas-invoerpagina (telefoon)
  klaverjas/display/           # live scorebord (tweede scherm)
  tafeltennis/index.html       # toernooi-invoerpagina (telefoon)
  tafeltennis/display/         # live scorebord: tafels, stand, schema
  cube-solver/index.html       # zelfstandige (gebouwde) solver-pagina
  wafelwoorden/index.html      # woordspel
src/
  cube-solver/                 # bron van de solver-pagina
    template.html  solver.js  kociemba.js  app.js
build.js                       # bouwt de cube-solver naar games/cube-solver/
test/api.test.js               # end-to-end API-test (boerenbridge)
test/klaverjas.test.js         # end-to-end API-test (klaverjas)
test/tafeltennis.test.js       # end-to-end API-test (tafeltennis)
data/                          # spelgegevens (niet in git; Docker-volume)
```

## Een spel toevoegen

1. Maak `games/<naam>/index.html` (zelfstandige pagina; voeg bovenin een
   `← Alle spellen` link toe naar `../../index.html`).
2. Voeg een kaartje toe in `index.html` (kopieer een bestaand `<a class="game">`).

## De Kubus Solver bouwen

De solver-pagina is één zelfstandig bestand, samengesteld uit losse bronnen:

```
node build.js   # src/cube-solver/*  ->  games/cube-solver/index.html
```

- `solver.js` – kubusmodel, facelet-conversie + laag-voor-laag fallback
- `kociemba.js` – Kociemba two-phase oplosser (±20 zetten, ~0,8 s tabel-build)
- `app.js` – de mobiele UI (draait de solver in een Web Worker)
- `template.html` – HTML + styling

De oplosser is getest op duizenden willekeurige scrambles: 0 fouten,
gemiddeld ~20 zetten. Elke oplossing wordt geverifieerd voor hij getoond wordt.
