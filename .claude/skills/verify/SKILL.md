---
name: verify
description: Verifieer wijzigingen aan de Spellenhoek-server of de spelpagina's (boerenbridge, klaverjas, tafeltennis) end-to-end (server draaien, browser aansturen, SSE checken).
---

# Spellenhoek verifiëren

## Server + API

```bash
node test/api.test.js        # end-to-end API-suite boerenbridge, spawnt zelf de server
node test/klaverjas.test.js  # idem voor klaverjas
node test/tafeltennis.test.js # idem voor het tafeltennistoernooi
```

Draai ze alle drie bij elke wijziging in `server/`: `shared.js` wordt door
alle spellen gebruikt.

Voor handmatig prikken: `PORT=3100 DATA_DIR=/tmp/bb-data node server/server.js`
en dan `curl localhost:3100/api/boerenbridge/current` of
`curl localhost:3100/api/klaverjas/leaderboard`.

## Pagina's in een echte browser (headless Chromium)

Playwright-browsers staan klaar in `/opt/pw-browsers`. Installeer alleen de
library: `npm install playwright-core --no-save` (in een scratch-map, niet in
de repo). Launch met een expliciet pad:

```js
const { chromium } = require('playwright-core');
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
});
```

Werkend recept: spawn `server/server.js` met een temp `DATA_DIR`, open
`games/boerenbridge/` in een 390×844-context (telefoon/invoer) en
`games/boerenbridge/display/` in een 1180×820-context (iPad/display), en
loop de flow: spel starten → voorspellingen → display checkt `.pcard`-totalen →
slagen → volgende ronde. Interessante probes: slagen die niet optellen tot het
kaartenaantal (foutmelding), server killen + herstarten (retry-banner op de
invoerpagina), tweede pagina die hetzelfde spel hervat en eerder indient
(409 → refetch + melding op de eerste).

Tafeltennis: open `games/tafeltennis/` (telefoon) en `games/tafeltennis/display/`
(scorebord). Flow: namen + toernooivorm kiezen (`[data-key="format"] [data-val=…]`)
→ starten → `.now-card` aantikken → per game `input[data-side]` vullen of
`[data-win]` tikken (de volgende `.game-row` verschijnt vanzelf) → het
scorebord toont de tussenstand in `.tcard .live .cur` → `#saveBtn` →
`.notice`. Probes: 11–10 (400 in `#formWarn .error`), dezelfde wedstrijd op
twee telefoons (409 → `.notice.bad`), poule uitspelen (scorebord wisselt naar
`.bracket`), eindronde uitspelen (`.podium`), undo vanuit `#winnerArea`.

## Valkuil (echt gebeurd)

Wacht in browsertests **nooit** op `document.body.textContent.includes(...)`
voor UI-teksten: de inline `<script>` in de pagina's staat in `<body>`, dus
alle meldingsteksten ("Spel is elders bijgewerkt", "Voorspeld:") staan al bij
paginalaad in `body.textContent`. Wacht op het concrete element, bijv.
`#predWarn .warn` of `.pcard .tot`.

## Wat hier niet kan

Er is geen Docker-daemon in de sandbox; `docker build` moet op de thuisserver
worden gecheckt. De Dockerfile is triviaal (COPY + `node server/server.js`).
