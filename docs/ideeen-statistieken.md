# Ideeën: statistieken en weetjes voor boerenbridge

Parkeerplaats voor wat er uit de gespeelde potjes te halen valt. Bedoeld om
later op terug te komen — kies een selectie en bouw die uit in
`server/logic.js` naast `leaderboard` (de pagina's tonen alleen).

## Stand van zaken (september 2026)

Gebouwd, allemaal in `server/logic.js`:

- **Klassement**: trefzekerheid (`exactPct`), te veel/te weinig gevraagd,
  nulletjes, langste reeks; plus **eretitels** (`awards`): Scherpschutter,
  Nulletjes-koning, Langste reeks, Optimist, Pessimist. Telefoon: extra
  kolommen + eretitels onder de tabel; display: kolom "Precies" + eretitels
  op het idle-scherm.
- **Eindscherm** (`highlights`): comeback (vanaf 5 punten), langst aan kop,
  kopwisselingen, vaakst goed/mis, beste ronde, zwaarste klap (vanaf −3),
  nulletjes-koning, duur (5 min–6 uur).
- **Weetjes soort 1** (`fact`): reeksen, gedeelde kop, achtervolger binnen
  bereik, niet meer in te halen, hele avond aan kop, kopwisselingen,
  halverwege, vorige ronde, uitschieters, tafel-percentage, nulletjes,
  spiegelronde. Vastgepind per ronde, getoond op tussen-, voorspel- en
  speelscherm van het display.

Nog niet: soort 2 en 3 (historie, reactie op een voorspelling), de rest van de
klassement-ideeën hieronder, en het taalmodel.

## Welke data er is

## Welke data er is

Per potje in `data/boerenbridge.json`:

- `players`, `createdAt`, `finishedAt`, `status` (alleen `finished` telt mee).
- `rounds[r]` = `{cards, suitIdx}` (8→1→8, troef rouleert ♣ ♥ ♦ ♠ Sans).
- `predictions[r][i]`, `actuals[r][i]`, `roundScores[r][i]`.
- Afleidbaar: `dealerIdx`/`playerOrder` per ronde (wie voorspelt eerst/laatst),
  `cumulative` (stand na elke ronde), `positions`, `roundKinds`
  (`exact`/`over`/`under`).

Wat er **niet** is: tijd per ronde (alleen begin/eind van het potje) en welke
kaarten er lagen. Wil je tempo-weetjes ("langste denkpauze", "snelste ronde"),
dan moet de server per ronde een tijdstempel gaan bewaren — en `undo` moet die
weer weggooien.

Spelers koppelen op naam, case-insensitief (`shared.nameKey`), net als het
klassement. Afgebroken potjes tellen nergens mee.

## Per speler, over alle potjes (uitbreiding klassement)

- **Trefzekerheid** — % rondes precies voorspeld. Dé vaardigheid van het spel.
- **Optimist / pessimist** — bij een misser: te veel gevraagd (`under`,
  minpunten) of te weinig (`over`, pluspunten zonder bonus)? Ieder heeft een
  profiel.
- **Nulletjes-koning** — hoe vaak 0 gevraagd, hoe vaak gehaald.
- **Durfal** — gemiddelde voorspelling als aandeel van het aantal kaarten.
- **Langste reeks** — meeste rondes op rij exact; langste droogte.
- **Beste / slechtste ronde ooit** — max 13 (8 gevraagd, 8 gehaald), min −8.
- **Starter / finisher** — punten in de eerste helft (8→1) vs de tweede (1→8).
- **Wisselvalligheid** — spreiding van eindscores.
- **Onderlinge stand** — wie wint vaker als A en B allebei meedoen.
- **Vroeg of laat voorspellen** — trefzekerheid als eerste vs als laatste
  voorspeller (deler voorspelt als laatste).
- **Per kaartaantal** — trefzekerheid bij 1, 2, … 8 kaarten.
- **Per troef** — gemiddelde score bij ♥, ♠, … (leuk, maar snel ruis).

## Per potje (eindscherm op het display)

- **Langst aan kop** — aantal rondes op plek 1 (uit `cumulative`).
- **Grootste comeback** — grootste achterstand die nog winst werd.
- **Kantelpunt** — de ronde waarin de kop wisselde, of de ronde met de meeste
  minpunten aan tafel.
- **Trefzekerheid van de avond** — wie zat het vaakst goed / mis.
- **Duur** van het potje, en of dat sneller of langzamer was dan gemiddeld.
- **Beste ronde van de avond**, grootste blunder.

## Tafel-weetjes (over alle potjes samen)

- **Moeilijkste ronde** — trefzekerheid per kaartaantal. Verwachting: de
  1-kaartronde is een muntje, de 8-kaartrondes zijn het lastigst.
- **Voorspelt de koploper halverwege de winst?** — hoe vaak wint wie na de
  1-kaartronde bovenaan staat.
- **Overvraagd / ondervraagd** — som voorspellingen vs aantal kaarten, per
  ronde-type. Vraagt de tafel structureel te veel?
- **Wanneer wordt er gespeeld** — dag van de week, tijdstip, wie zit het vaakst
  samen aan tafel.
- **Records** — hoogste eindscore, grootste en kleinste winstmarge, gedeelde
  winsten, snelste potje.

## Weetjes op het display tussen de rondes

Het display heeft tussen twee rondes twee schermen: **tussenstand**
(`renderStandings`: ronde geteld, kaarten worden geschud, nog geen invoer) en
**voorspellen** (`renderBidding`: de draft-invoer loopt). Op beide past één
regel "weetje". Drie soorten, van sterk naar zwak:

### 1. Uit dit potje (werkt ook bij het allereerste potje)

- Reeksen: "Anne zit al 4 rondes op rij goed." / "Piet miste de laatste 3."
- Kopwisselingen: "De kop is vanavond al 3× gewisseld."
- Bereikbaarheid: "Tim staat 9 achter — in één ronde te overbruggen" (max per
  ronde = kaarten + 5). En omgekeerd: "Anne is niet meer in te halen" zodra
  de voorsprong groter is dan wat er in de resterende rondes nog te halen is.
- Wie kan aan kop komen: "Piet komt aan kop als hij exact zit."
- Vorige ronde: "3 van de 4 goed, de tafel vroeg 2 te veel."
- Tafel vanavond: "Vanavond zit 55% van de voorspellingen goed." /
  "Al 6 nulletjes gevraagd, 5 gehaald."
- Halverwege-moment na de 1-kaartronde: "Halverwege! Kop: Tim."
- Spiegelronde: ronde r in de tweede helft heeft evenveel kaarten als ronde
  14−r in de eerste. "Eerder vanavond met 6 kaarten: Tim vroeg 2, haalde 2."

### 2. Uit de historie (afgeronde potjes, liefst met dezelfde spelers)

- Per ronde-type: "Bij 7 kaarten zit gemiddeld 35% van de tafel goed — de
  moeilijkste ronde."
- Persoonlijk per kaartaantal: "Tim zat bij 3 kaarten 7 van de 10 keer goed."
  / "Anne heeft bij 8 kaarten nog nooit exact gezeten."
- Gewoontes: "Piet vraagt bij 5 kaarten meestal 1."
- Nul-koning: "Anne vroeg al 42× nul en haalde het 30×."
- Laatste voorspeller: "Piet voorspelt als laatste; als laatste zit hij 48%
  goed, als eerste 35%."
- Onderling: "Tim en Anne speelden 12 potjes samen; Tim won er 7."
- Koploper halverwege: "De koploper na de 1-kaartronde won 6 van de 9 potjes."
- Op koers: "Record aan deze tafel: 87 (Anne). Tim ligt op koers voor 90"
  (huidige stand + eigen gemiddelde per resterende ronde).
- Boven/onder eigen gemiddelde: "Tim staat 8 punten boven zijn gemiddelde na
  ronde 6."
- Troef: "Bij harten scoort Piet gemiddeld het hoogst." (alleen bij genoeg
  potjes)

### 3. Reactie op een aangetikte voorspelling (alleen voorspel-scherm)

- "Tim vraagt 3 — dat haalde hij bij 6 kaarten 4 van de 9 keer."
- "Anne vraagt 0 — haar 3e nulletje vanavond."
- "Piet vraagt 5 van 7: zijn hoogste vraag ooit."
- "Exact zitten levert Tim 8 punten op — genoeg voor de kop."
- "Bij 4 kaarten vraagt de tafel meestal 1 te veel."

### Ontwerpnotities

- **Server rekent, client toont.** Alleen de server heeft de historie. Een
  `facts(game, games)` in `logic.js` levert kandidaten (`{text, weight}`),
  meegestuurd in de SSE-snapshot; het display kiest er één.
- **Vastpinnen per ronde.** De snapshot komt bij elke draft-POST opnieuw; kies
  het weetje deterministisch op `(game.id, ronde, fase)` zodat de tekst niet
  flikkert terwijl de voorspellingen binnenkomen. Reactie-weetjes (soort 3)
  mogen wél per nieuwe voorspelling wisselen.
- **Nieuws boven achtergrond.** Reeksen, kopwisselingen, "niet meer in te
  halen" en het halverwege-moment gaan vóór historische percentages.
- **Minimum steekproef.** Geen percentages onder ±5 rondes of ±3 potjes; zeg
  dan "2 van de 3 keer". Toon bij percentages altijd het aantal.
- **Eén regel, kort.** Past onder de topbar of naast de "samen gevraagd"-balk.
  Geen weetje is beter dan een gezocht weetje.
- Namen in de tekst zijn de schrijfwijze uit het huidige potje.

## Eerste selectie (als we beginnen)

1. Klassement: trefzekerheid + optimist/pessimist, nulletjes-koning, langste
   reeks.
2. Eindscherm: langst aan kop, grootste comeback.
3. Tussenscherm-weetjes van soort 1 (reeksen, bereikbaarheid, kopwisselingen)
   — die werken vanaf dag één en hebben geen historie nodig.
4. Daarna soort 2 en 3 zodra er genoeg potjes zijn.

## Lokaal taalmodel (Ollama op porter)

Plan: spellenhoek verhuist rond oktober 2026 naar porter (128 GB unified
memory, Ollama via brew). Een taalmodel is dan bereikbaar — maar alleen nuttig
voor **taal**, niet voor de statistiek. Alle getallen komen deterministisch uit
`logic.js`; het model krijgt een lijst feiten en mag die alleen verwoorden.

Wat het kan toevoegen:

- **Avondverslag op het eindscherm** — vier, vijf zinnen in
  sportverslaggever-stijl uit de feiten (comeback, langst aan kop, blunder,
  duur). Het leukste gebruik.
- **Variatie in de weetjes** op het schud-scherm: één feit, één zin, telkens
  anders verwoord. Geen vijftig sjablonen nodig.
- Eventueel een vaste commentator-persona voor het display.

Niet: reacties op het voorspel-scherm (moeten instant), en niets waar cijfers
in berekend moeten worden.

Proefje op 2026-09-07 (deze Mac, feitenlijst van een fictief potje):

| Model | Verslag | Eén-zins-weetje |
|---|---|---|
| qwen3.5 9B (mlx) | 12 s, redelijk Nederlands, cijfers klopten, één verzonnen bijzin | 1 s, bruikbaar |
| qwen3.5 9B (Q4) | 11 s, verzon getallen en rondes | 1 s, matig |
| llama3.2 3B | 5 s, onbruikbaar Nederlands | 0,3 s, fout |

Les: korte output is veilig, lange verslagen driften. Op porter een groter
model nemen (±27–32B) en de output toetsen: elk getal uit de feiten moet
letterlijk terugkomen, anders sjabloontekst.

Ontwerp als het ooit komt:

- Optioneel via env (`LLM_URL`, `LLM_MODEL`); zonder env gewoon sjablonen.
  Alleen `node:http`, geen dependency.
- Nooit blokkerend: mutatie opslaan en broadcasten, dán asynchroon genereren,
  resultaat in `game` bewaren (`commentary[r]`, `recap`) en opnieuw
  broadcasten. `undo` gooit het weg.
- Per ronde één keer genereren (vastgepind, zie boven); temperatuur laag.
- Netwerk: de spellenhoek-container zit op een internal netwerk zonder LAN
  (manor `stacks/spellenhoek`). Ollama's API is ongeauthenticeerd en kan ook
  modellen pullen/wissen — dus niet de hele API openzetten, maar via Caddy
  alleen `/api/chat` doorlaten naar de host.
