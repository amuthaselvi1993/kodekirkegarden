# KillSwitch webklient for Kodekirkegården

Kopier innholdet i denne mappa oppå repoet (samme stier). Endrer to filer og legger til fem.

| Fil | Endring |
|---|---|
| `src/verktoy.js` | Implementerer `les_fil`, `finn_referanser`, `hent_git_historikk`. Nytt verktøy `rapporter_funn`. Systemprompten ber agenten melde inn funn. |
| `src/index.js` | Skriver `data/rapport.json` etter kjøring. |
| `src/rapport.js` (ny) | Gjør funnene om til rapporten klienten leser. |
| `src/server.js` (ny) | Serverer `web/`, starter agenten fra «Start scan», leverer `/report.json`. |
| `web/index.html`, `web/config.json` (nye) | KillSwitch-klienten. |
| `package.json` | Nytt script `web`. |

```bash
npm install
cp .env.example .env     # ANTHROPIC_API_KEY fra Hekserådet
npm run web              # http://localhost:3000
```

Trykk **Start scan**. Agenten graver, og klienten laster rapporten når den er ferdig.
`npm start` fungerer som før og skriver også `data/rapport.json`.

Agenten sletter ingenting. «Trygt» betyr: agenten sier det, sikkerhet ≥ 90 og lav risiko.
Alt annet havner under «Needs review». Legg `data/rapport.json` i `.gitignore`.
