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
| 🎲 **Yahtzee** | `games/yahtzee/` | Digitaal scoreblok: 1–8 spelers, 1–6 rijtjes tegelijk, op één telefoon of op meerdere tegelijk, highscores per rijtje — en optioneel de camera die de stenen telt. |

Elk spel is een zelfstandige pagina onder `games/<naam>/index.html` met een
link terug naar de homepage.

## Draaien

```
node server/server.js
```

De server (Node ≥ 18, geen npm-dependencies) serveert de hele site op
`http://localhost:3000` en biedt de spel-API's onder `/api/boerenbridge/`,
`/api/klaverjas/`, `/api/tafeltennis/` en `/api/yahtzee/`, elk met een eigen
SSE-kanaal voor het scorebord (bij yahtzee luisteren de invoerpagina's zelf mee). Configuratie via omgevingsvariabelen:

- `PORT` – poort (standaard `3000`)
- `DATA_DIR` – map voor de databestanden `boerenbridge.json`,
  `klaverjas.json`, `tafeltennis.json` en `yahtzee.json` (standaard `./data`)

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
   vervalt de grafiek en blijven de cijfers. Tussen de rondes staat er een
   weetje over het potje ("Anne zit al 4 rondes op rij precies goed",
   "Tim is niet meer in te halen", "Halverwege!"); dat blijft de hele ronde
   staan. Zijn er al eerdere potjes gespeeld, dan komen daar weetjes uit de
   historie bij ("Piet vraagt bij 5 kaarten meestal 1", "het record aan deze
   tafel is 87"); nieuws uit dit potje en achtergrond wisselen elkaar af. De
   weetjes praten mee met de klok: wie 's middags kaart leest "vanmiddag".
   Terwijl er voorspeld wordt, reageert het scherm op de zojuist aangetikte
   keuze ("Anne vraagt nul; dat lukte 30 van de 42 keer") — diezelfde regel
   staat ook onder de invoer op de telefoon. Op de eindstand staan de
   hoogtepunten van het potje: comeback, het kantelpunt, wie het langst aan kop
   stond, wie het vaakst goed zat, de beste ronde, de zwaarste klap en de
   nulletjes-koning.
   Staat er geen potje op het scherm, dan wisselt onder het klassement elke
   negen seconden een weetje over de tafel (records, het lastigste ronde-type).
3. Onder ⚙️ **Spelbeheer** op de telefoon staan twee dingen voor als het
   anders loopt dan gepland. **Speler wisselen** zet een andere naam op een
   stoel: de rondes die al gespeeld zijn blijven van de vorige speler, dus
   trefzekerheid, nulletjes en reeksen kloppen voor allebei, en het potje zelf
   — gespeeld, gewonnen, eindscore — telt voor wie het uitspeelt. Was er in die
   ronde al voorspeld, dan gaat de wissel pas de ronde erna in. **Meetellen**
   zet het hele potje buiten de telling: het blijft bewaard en op het scorebord
   te zien, maar klassement, statistiek en weetjes slaan het over. Dat kan ook
   nog na afloop.
4. Onder 🏆 Klassement op de telefoon kun je spelers aantikken om potjes
   waarin zij meededen weg te laten — handig als er af en toe kinderen
   meespelen. Je keuze blijft op dat toestel bewaard; het display toont
   altijd het volledige klassement. Naast potjes, winst en gemiddelde staat
   per speler hoe vaak hij precies goed zat, hoeveel nulletjes hij haalde en
   zijn langste reeks; daaronder de eretitels (Scherpschutter,
   Nulletjes-koning, Langste reeks, Optimist, Pessimist).
5. 📊 **Statistieken** (link op de telefoon, of `games/boerenbridge/stats/`)
   gaat dieper. Iedereen staat op één regel met het aantal potjes en een balkje
   precies / te weinig gevraagd / te veel gevraagd; tik een naam aan voor het
   volledige profiel met durf, wisselvalligheid, eerste tegen tweede helft en
   trefzekerheid per kaartaantal. Tik er meer aan om ze naast elkaar te
   vergelijken; die keuze blijft op dat toestel bewaard. Daarnaast records, welk ronde-type
   het lastigst is, per troef, de onderlinge standen en wat opvalt aan de tafel
   (bijvoorbeeld hoe vaak de koploper na de 1-kaartronde uiteindelijk wint).
   Hetzelfde filter als bij het klassement, en die keuze wordt gedeeld.

Er is bewust geen authenticatie of koppelcode: dit is bedoeld voor een
vertrouwd thuisnetwerk. Zet het niet zonder extra maatregelen (reverse proxy
met auth) open naar internet.

Tip voor het display: tik ☕ rechtsboven aan, dan blijft het scherm aan (zie
"Op de telefoon of tablet"). Lukt dat niet — bijvoorbeeld op een oud iPad of
via een `http://`-adres — zet dan automatische schermvergrendeling uit op het
apparaat.

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

## Yahtzee

1. Open `games/yahtzee/`, vul de spelers in op volgorde van gooien (1–8) en
   kies het aantal **rijtjes** per speler (1–6). Met meer rijtjes kies je elke
   beurt zelf in welk rijtje je worp komt; elk rijtje heeft zijn eigen bonus.
2. **Eén telefoon voor iedereen:** het blok volgt de beurt vanzelf. Tik een
   leeg vakje aan en kies de score (bij de bovenste vakjes "3× ⚃ = 12", bij
   drie/vier gelijk en kans de som, anders de vaste waarde of een streep).
3. **Meerdere telefoons:** kies op de andere telefoon hetzelfde potje onder
   *Verder spelen of meedoen*. Alles loopt live mee; iedereen mag invullen.
4. **Stenen intikken** (optioneel): tik de vijf stenen in, dan staat in elk
   leeg vakje van wie aan de beurt is wat die worp oplevert, en is één tik op
   het vakje genoeg. Dat scheelt rekenwerk bij kans en drie/vier gelijk.
5. **Camera** (optioneel, experimenteel): hang een telefoon recht boven de
   bak en zet de camera aan. Ligt de worp stil, dan telt de pagina de ogen en
   verschijnen de stenen op alle schermen — dan hoef je alleen het vakje nog aan
   te tikken. Klopt een steen niet, tik hem aan en verbeter hem. De herkenning
   draait helemaal op de telefoon (er gaan geen beelden over de lijn) en werkt
   het best met witte stenen met zwarte ogen op een donkere ondergrond, met
   alle vijf stenen in het vierkant (alleen dat stuk uit het midden van het
   camerabeeld telt mee). De camera werkt alleen via het **https**-adres;
   op een kaal `http://`-adres in huis staat de browser hem niet toe.

De regels zijn de officiële: 35 bonus bij 63 of meer in het bovenste deel
(onder de bovenste vakjes staat hoeveel je voor of achter ligt op "drie van
elk"), +100 per extra Yahtzee als het Yahtzee-vakje van dat rijtje 50 heeft,
en de jokerregel (vijf gelijk telt als full house of straat zodra het
Yahtzee-vakje vol is). Vul je in met de stenen, dan rekent de server dat
allemaal zelf uit; met de hand vink je een extra Yahtzee aan in het
keuzevenster. **↶ Ongedaan** neemt de laatste zet terug, ook na afloop — en
kwam die zet uit een worp, dan liggen die stenen weer op tafel.

De **highscores** zijn de tien beste rijtjes ooit (dus eerlijk tussen potjes
met één of meer rijtjes); het klassement telt per speler potjes, winst (alleen
met tegenstanders), het gemiddelde per rijtje, de beste, het aantal Yahtzees en
hoe vaak de bonus binnenkwam.

## Twee spelers met dezelfde voornaam

Alles gaat op voornaam, en het klassement houdt spelers uit elkaar op naam.
Heten twee mensen hetzelfde, zet ze dan op de pagina **Spelers** (onderaan de
homepage) onder één voornaam met elk een eigen volledige naam, bijvoorbeeld
*Ilse* → *Ilse B.* en *Ilse de V.*. Dat geldt voor alle spellen tegelijk.

- **Bij de start** staan ze allebei voluit tussen de naamsuggesties. Typt
  iemand toch alleen "Ilse", dan vraagt de pagina welke Ilse het is.
- **Aan tafel** (invoer, scorebord, weetjes) heet ieder gewoon bij de
  voornaam, behalve als ze allebei meedoen.
- **In het klassement en de statistiek** staan ze voluit.
- **Oude potjes** met alleen "Ilse" erin staan op dezelfde pagina; tik aan wie
  het was. Vergist? Tik de andere naam.

## Op de telefoon of tablet

**Geen zoom.** Knijpen en dubbeltikken zoomen niet meer; teksten en knoppen
blijven staan waar je ze verwacht. Scrollen en slepen (wafelwoorden) werken
gewoon.

**Scherm wakker.** Tik ☕ rechtsboven aan en het scherm gaat niet meer op
slot zolang de pagina openstaat. Dat onthoudt het toestel, voor alle spellen;
nog een tik zet het weer uit. Het knopje verdwijnt na een paar tellen — tik
ergens op het scherm en het is er weer. Werkt alleen via het https-adres.

Zet je de site op je beginscherm (*Deel → Zet op beginscherm*), dan start hij
zonder Safari-balken, als een app. Stond hij er al vóór deze wijziging op?
Haal hem er dan één keer af en zet hem er opnieuw op — iOS onthoudt de oude
instelling.

## Docker

De Spellenhoek thuis wordt uitgerold vanuit de `manor`-repo
(`stacks/spellenhoek/NOTES.md`); daar staat hoe. Zelf draaien kan zo:

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
`/api/boerenbridge/events`, `/api/klaverjas/events`,
`/api/tafeltennis/events` en `/api/yahtzee/events` (SSE); de server stuurt
daarvoor zelf al `X-Accel-Buffering: no` en een heartbeat elke 25 s.

## Testen

```
node test/api.test.js
node test/klaverjas.test.js
node test/tafeltennis.test.js
node test/yahtzee.test.js
node test/yahtzee-vision.test.js
node test/spelers.test.js
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
`yahtzee.test.js` speelt een heel potje (3 spelers × 2 rijtjes) met
willekeurige worpen en vergelijkt elke tussenstand met een onafhankelijke
herimplementatie van de telling (bonus, Yahtzee-bonus, jokerregel), en test
verder de invoer per waarde, de 409-guards, undo, het klassement en de
highscores, SSE en persistentie.
`yahtzee-vision.test.js` haalt de dobbelsteenherkenning uit de pagina en
laat hem synthetische camerabeelden tellen: onscherp, schaduw, glimlicht,
stenen tegen elkaar, een lamp aan één kant, enzovoort (aantal per scenario
via `N_VISION`). Dat test het rekenwerk, niet een echte camera.
`spelers.test.js` test de dubbele voornamen: de vraag bij de start, de
voornaam aan tafel, de suggesties en het toewijzen van oude potjes, voor alle
vier de spellen.
`solver.test.js` lost honderden willekeurige scrambles op met beide
oplossers en verifieert elke oplossing (aantallen instelbaar via
`N_KOCIEMBA` / `N_LBL`).

## Structuur

```
index.html                     # homepage / spellenoverzicht
spelers/index.html             # beheer: twee spelers met dezelfde voornaam
server/
  server.js                    # statische site + spel-API's + SSE
  shared.js                    # gedeelde helpers (klassement, foutobjecten)
  spelers.js                   # dubbele voornamen (voor alle spellen)
  logic.js                     # autoritatieve boerenbridge-logica
  klaverjas.js                 # autoritatieve klaverjas-logica
  tafeltennis.js               # autoritatieve toernooilogica (tafeltennis)
  yahtzee.js                   # autoritatieve yahtzee-telling
games/
  boerenbridge/index.html      # invoerpagina (telefoon)
  boerenbridge/display/        # live scorebord (tweede scherm)
  klaverjas/index.html         # klaverjas-invoerpagina (telefoon)
  klaverjas/display/           # live scorebord (tweede scherm)
  tafeltennis/index.html       # toernooi-invoerpagina (telefoon)
  tafeltennis/display/         # live scorebord: tafels, stand, schema
  yahtzee/index.html           # scoreblok + stenen + camera (telefoon)
  cube-solver/index.html       # zelfstandige (gebouwde) solver-pagina
  wafelwoorden/index.html      # woordspel
src/
  cube-solver/                 # bron van de solver-pagina
    template.html  solver.js  kociemba.js  app.js
build.js                       # bouwt de cube-solver naar games/cube-solver/
test/api.test.js               # end-to-end API-test (boerenbridge)
test/klaverjas.test.js         # end-to-end API-test (klaverjas)
test/tafeltennis.test.js       # end-to-end API-test (tafeltennis)
test/yahtzee.test.js           # end-to-end API-test (yahtzee)
test/yahtzee-vision.test.js    # dobbelsteenherkenning op synthetische beelden
test/spelers.test.js           # dubbele voornamen (alle spellen)
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
