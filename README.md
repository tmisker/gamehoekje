# 🎮 Spellenhoek

Een kleine verzameling spellen en speel-tools voor in de browser. De site
wordt geserveerd door een minimale Node-server (zonder dependencies) die ook
de boerenbridge-scores synchroniseert; de overige spellen werken gewoon
offline als losse pagina's.

## Spellen

| Spel | Map | Wat |
|------|-----|-----|
| 🧩 **Kubus Solver** | `games/cube-solver/` | Kleur je Rubik's kubus in en los hem in ±20 zetten op (Kociemba two-phase), stap voor stap. |
| 🧇 **Wafelwoorden** | `games/wafelwoorden/` | Sleep de letters op hun plek en los de woordwafel op. |
| 🃏 **Boerenbridge** | `games/boerenbridge/` | Score bijhouden met twee apparaten: invoer op je telefoon, live scorebord op een tweede scherm. Met klassement over alle potjes. |

Elk spel is een zelfstandige pagina onder `games/<naam>/index.html` met een
link terug naar de homepage.

## Draaien

```
node server/server.js
```

De server (Node ≥ 18, geen npm-dependencies) serveert de hele site op
`http://localhost:3000` en biedt het boerenbridge-API onder
`/api/boerenbridge/`. Configuratie via omgevingsvariabelen:

- `PORT` – poort (standaard `3000`)
- `DATA_DIR` – map voor het databestand `boerenbridge.json` (standaard `./data`)

## Boerenbridge met twee apparaten

1. Open `games/boerenbridge/` op de telefoon van de scorebijhouder — hier
   start of hervat je een spel en voer je voorspellingen en slagen in.
2. Open `games/boerenbridge/display/` op een tweede apparaat (bijv. een iPad
   op tafel) — dit scorebord volgt het spel live via Server-Sent Events.
   Zonder actief spel toont het scherm het klassement.

Er is bewust geen authenticatie of koppelcode: dit is bedoeld voor een
vertrouwd thuisnetwerk. Zet het niet zonder extra maatregelen (reverse proxy
met auth) open naar internet.

Tip voor het display: zet automatische schermvergrendeling uit op het
apparaat, dat kan de pagina zelf niet regelen.

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
`/api/boerenbridge/events` (SSE); de server stuurt daarvoor zelf al
`X-Accel-Buffering: no` en een heartbeat elke 25 s.

## Testen

```
node test/api.test.js
```

Start de server op een testpoort met een tijdelijke datamap en test het
volledige spelverloop, de scoreformule (tegen een onafhankelijke
herimplementatie), validatie en 409-guards, undo, het klassement, SSE,
path-traversal-bescherming en persistentie over een herstart.

## Structuur

```
index.html                     # homepage / spellenoverzicht
server/
  server.js                    # statische site + boerenbridge-API + SSE
  logic.js                     # autoritatieve spellogica (ook testbaar in Node)
games/
  boerenbridge/index.html      # invoerpagina (telefoon)
  boerenbridge/display/        # live scorebord (tweede scherm)
  cube-solver/index.html       # zelfstandige (gebouwde) solver-pagina
  wafelwoorden/index.html      # woordspel
src/
  cube-solver/                 # bron van de solver-pagina
    template.html  solver.js  kociemba.js  app.js
build.js                       # bouwt de cube-solver naar games/cube-solver/
test/api.test.js               # end-to-end API-test
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
