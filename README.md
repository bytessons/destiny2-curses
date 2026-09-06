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

## Testa lokalt

Sidan hämtar `curses.json` med `fetch`, vilket kräver att filerna serveras över
http(s) — att bara dubbelklicka på `index.html` fungerar inte i alla webbläsare
(CORS-restriktion på `file://`). Kör t.ex.:

```bash
npx serve .
```
