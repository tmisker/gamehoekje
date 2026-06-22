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
- De oplosser gebruikt een **laag-voor-laag** methode:
  - onderste kruis en hoeken via een korte IDA\*-zoekactie met een
    admissible heuristiek (voorberekende afstandstabellen per stuk);
  - middelste laag met de klassieke insertie-algoritmes;
  - laatste laag via een **vooraf berekende BFS-tabel** over de hele
    last-layer groep (62 208 toestanden) — gegarandeerd correct.
- Elke oplossing wordt geverifieerd voordat hij getoond wordt.

## Ontwikkeling

`index.html` is één zelfstandig bestand en wordt samengesteld uit:

```
node build.js   # template.html + solver.js + app.js  ->  index.html
```

- `solver.js` – kubusmodel + oplosser (werkt in Node en in de browser)
- `app.js` – de mobiele UI
- `template.html` – HTML + styling
