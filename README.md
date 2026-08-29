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

Elk spel is een zelfstandige pagina onder `games/<naam>/index.html` met een
link terug naar de homepage.

## Draaien

```
node server/server.js
```

De server (Node ≥ 18, geen npm-dependencies) serveert de hele site op
`http://localhost:3000` en biedt de spel-API's onder `/api/boerenbridge/` en
`/api/klaverjas/`, elk met een eigen SSE-kanaal voor het scorebord. Configuratie via omgevingsvariabelen:

- `PORT` – poort (standaard `3000`)
- `DATA_DIR` – map voor de databestanden `boerenbridge.json` en
  `klaverjas.json` (standaard `./data`)

## Boerenbridge met twee apparaten

1. Open `games/boerenbridge/` op de telefoon van de scorebijhouder — hier
   start of hervat je een spel en voer je voorspellingen en slagen in.
   Aantallen tik je aan op knoppen (0 t/m het aantal kaarten). Bij de
   werkelijke slagen grijst de pagina onmogelijke aantallen uit: samen nooit
   meer dan het aantal kaarten, en de laatste speler kan alleen nog het
   exacte restant kiezen. Nogmaals tikken wist een keuze weer.
2. Open `games/boerenbridge/display/` op een tweede apparaat (bijv. een iPad
   op tafel) — dit scorebord volgt het spel live via Server-Sent Events.
   Zonder actief spel toont het scherm het klassement. Tijdens een potje
   schakelt het vanzelf tussen vier weergaven: zodra de eerste voorspelling
   wordt aangetikt zie je live wie hoeveel vraagt en groot het totaal
   ("samen gevraagd"); tijdens het kaarten blijven ieders voorspelling en dat
   totaal groot in beeld (mét of er te veel of te weinig gevraagd is); na de
   telling komt de tussenstand met het scoreblok; en na de laatste ronde de
   eindstand.
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
`/api/boerenbridge/events` en `/api/klaverjas/events` (SSE); de server stuurt
daarvoor zelf al `X-Accel-Buffering: no` en een heartbeat elke 25 s.

## Testen

```
node test/api.test.js
node test/klaverjas.test.js
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
games/
  boerenbridge/index.html      # invoerpagina (telefoon)
  boerenbridge/display/        # live scorebord (tweede scherm)
  klaverjas/index.html         # klaverjas-invoerpagina (telefoon)
  klaverjas/display/           # live scorebord (tweede scherm)
  cube-solver/index.html       # zelfstandige (gebouwde) solver-pagina
  wafelwoorden/index.html      # woordspel
src/
  cube-solver/                 # bron van de solver-pagina
    template.html  solver.js  kociemba.js  app.js
build.js                       # bouwt de cube-solver naar games/cube-solver/
test/api.test.js               # end-to-end API-test (boerenbridge)
test/klaverjas.test.js         # end-to-end API-test (klaverjas)
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
