# 🎮 Spellenhoek

Een kleine verzameling spellen en speel-tools die volledig **offline in de
browser** werken. Open `index.html` voor de homepage en kies een spel.

## Spellen

| Spel | Map | Wat |
|------|-----|-----|
| 🧩 **Kubus Solver** | `games/cube-solver/` | Kleur je Rubik's kubus in en los hem in ±20 zetten op (Kociemba two-phase), stap voor stap. |
| 🧇 **Wafelwoorden** | `games/wafelwoorden/` | Sleep de letters op hun plek en los de woordwafel op. |

Elk spel is een zelfstandige pagina onder `games/<naam>/index.html` met een
link terug naar de homepage.

## Structuur

```
index.html                     # homepage / spellenoverzicht
games/
  cube-solver/index.html       # zelfstandige (gebouwde) solver-pagina
  wafelwoorden/index.html      # woordspel
src/
  cube-solver/                 # bron van de solver-pagina
    template.html  solver.js  kociemba.js  app.js
build.js                       # bouwt de cube-solver naar games/cube-solver/
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
