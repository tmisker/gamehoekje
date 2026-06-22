# 🧩 Kubus Solver

Een Rubik's Cube oplosser die volledig in de browser draait en gemaakt is voor
mobiel gebruik. Kleur je eigen kubus in en de app laat je stap voor stap zien
hoe je hem oplost.

## Gebruik

Open **`index.html`** in een browser (werkt offline, ook op je telefoon).

1. Kies een kleur en tik op de vlakjes om je kubus na te maken (de middens
   staan vast). Of druk op **Door elkaar** voor een willekeurige kubus.
2. Druk op **Los op!**.
3. Loop met de pijltjes door de zetten of druk op **Speel af**. Het
   gemarkeerde vlak laat zien welke kant je moet draaien.

## Hoe het werkt

- De kubus wordt intern als een *cubie*-model bijgehouden (hoek- en
  randstukken met positie + oriëntatie).
- De oplosser gebruikt **Kociemba's two-phase algoritme** (dezelfde aanpak
  als de bekende online solvers) en geeft oplossingen van **±20 zetten**:
  - fase 1 brengt de kubus naar de groep ⟨U,D,R,L,F2,B2⟩ via coördinaten
    voor hoek-/rand-oriëntatie en de equator-slice;
  - fase 2 lost daarbinnen volledig op met halve draaien;
  - beide fases gebruiken **vooraf berekende pruning-tabellen** (BFS) en
    IDA\*-zoekacties. De tabellen worden in ~1 s opgebouwd en gecachet.
- Er is ook een laag-voor-laag oplosser (`solveCube` in `solver.js`) als
  fallback; die wordt nog gebruikt als reservemethode.
- Elke oplossing wordt geverifieerd voordat hij getoond wordt; getest op
  duizenden willekeurige scrambles zonder fouten.

## Ontwikkeling

`index.html` is één zelfstandig bestand en wordt samengesteld uit:

```
node build.js   # template.html + solver.js + kociemba.js + app.js  ->  index.html
```

- `solver.js` – kubusmodel, facelet-conversie + laag-voor-laag fallback
- `kociemba.js` – Kociemba two-phase oplosser (±20 zetten)
- `app.js` – de mobiele UI (draait de solver in een Web Worker)
- `template.html` – HTML + styling
