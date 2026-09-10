# Förbannelsedragningen

Ett litet statiskt verktyg för att dra Destiny-"curses" åt hela fireteamet innan en
raid- eller dungeon-encounter. Ren HTML/CSS/JS, ingen build-process, inget backend.

## Använda det

1. Lägg till spelarnamn.
2. Välj Raid/Dungeon och tier.
3. Klicka "Dra förbannelser" — varje spelare får en unik förbannelse ur poolen,
   ingen får en de redan haft, och ingen förbannelse delas ut till två spelare
   i samma dragning.
4. Historik sparas i webbläsarens `localStorage` och listas längst ner.
   "Rensa historik" nollställer allt (med bekräftelse).

## Redigera förbannelser

Alla förbannelser bor i `curses.json`. Varje objekt:

```json
{
  "id": "unikt-och-stabilt-id",
  "name": "Visningsnamn",
  "description": "Vad förbannelsen faktiskt innebär.",
  "imageURL": "https://.../din-bild.png",
  "tier": 1,
  "type": "raid"
}
```

- `type` kan vara `"raid"`, `"dungeon"` eller `"both"` (gäller för bägge).
- `id` måste vara stabilt — ändra det inte i efterhand, då tappar historiken
  kopplingen till redan utdelade curses.

## Delad lobby (valfritt)

Appen fungerar helt utan detta — allt nedan är ett tillval ovanpå det lokala
läget. Om `firebase-config.js` inte är ifylld syns ingen lobbypanel och inget
förändras.

**Så här slår du på det:**

1. Skapa ett Firebase-projekt (Spark-planen, gratis) och lägg till en webbapp.
2. Klistra in värdena från "SDK setup and configuration" i `firebase-config.js`.
3. Aktivera Firestore (produktionsläge) och publicera reglerna i `firestore.rules`:
   ```bash
   firebase deploy --only firestore:rules
   ```
   eller klistra in dem i konsolen under Firestore → Rules.
4. (Valfritt) Aktivera App Check med reCAPTCHA v3 och lägg site-nyckeln i
   `recaptchaV3SiteKey` i `firebase-config.js`.

**Så funkar det:**

- Den som klickar "Skapa lobby" blir **värd**. Bara värden styr fireteam, typ och
  tier och kör dragningen.
- Övriga skriver in den 6 tecken långa koden, får ett låst UI och ser värdens
  setup och dragning i realtid.
- Historik sparas fortfarande lokalt per webbläsare (`localStorage`) — lobbyn delar
  bara den aktuella dragningen, inte historiken.
- Lobbies får rensas av vem som helst efter 24 timmar (se reglerna).

Webb-konfigurationen i `firebase-config.js` är inte hemlig; det är
`firestore.rules` och App Check som skyddar datan.

## Testa lokalt

Sidan hämtar `curses.json` med `fetch`, vilket kräver att filerna serveras över
http(s) — att bara dubbelklicka på `index.html` fungerar inte i alla webbläsare
(CORS-restriktion på `file://`). Kör t.ex.:

```bash
npx serve .
```
