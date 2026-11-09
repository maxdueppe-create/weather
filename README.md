# Only Weather

A mobile-first weather PWA that shows **only the weather data you ask for**.
Type "only rain and wind", "nur Regen und Wind", "tout sauf le pollen" or tick boxes in a list,
and the app shows exactly those fields — nothing added "for convenience".

- English, German, French and Spanish (interface and typed requests)
- GPS (only after you tap "Use my location") or a typed city — the typed city wins
- Metric units, formatted per language (`12,5 °C` in German, `12.5°C` in English)
- No account, no tracking, no ads, nothing stored — every launch starts fresh
- Works offline as an app shell; weather data itself needs a connection
- Data: [Open-Meteo](https://open-meteo.com/) (free, no API key), CC BY 4.0

## Run locally

There is no build step. Any static file server works:

```bash
cd weather-pwa
python3 -m http.server 8080      # or: npx serve -l 8080
```

Open <http://localhost:8080>.

`localhost` counts as a secure context, so the service worker and GPS work there.
To try it **on your phone**, the page must be served over HTTPS (e.g. GitHub Pages,
Netlify, or a tunnel such as `cloudflared tunnel --url http://localhost:8080`);
over plain `http://192.168.x.x` the browser blocks GPS and the service worker.

## Tests

```bash
# Parser unit tests (Node 18+, no dependencies)
node --test

# End-to-end tests in a real browser, with Open-Meteo stubbed
pip install playwright && python -m playwright install chromium
python e2e/run_e2e.py
# optional: --chrome /path/to/chrome   --axe /path/to/axe.min.js  (WCAG audit via axe-core)
```

The end-to-end suite serves the app, drives Chromium, and replaces the three
Open-Meteo endpoints with a stub that returns the same JSON shape and **only the
variables the app requested**, so it also catches "displayed but never fetched" bugs.
It writes `e2e/screenshot-light.png` and `e2e/screenshot-dark.png`.

## Files

| File | Role |
|---|---|
| `index.html` | Static shell and form markup |
| `app.js` | UI: strings for 4 languages, input handling, rendering, SW registration |
| `parser.js` | Free text → field list. Deterministic dictionary + typo matcher |
| `weather.js` | Location (GPS/city) and Open-Meteo calls, error codes, data model |
| `styles.css` | Mobile-first styles, light/dark |
| `manifest.json`, `sw.js`, `icons/` | PWA install + offline shell |
| `parser.test.js` | Parser tests incl. the spec's parser cases |
| `e2e/run_e2e.py` | Browser tests for all spec cases + extras |
| `LEARNING.md` | Why the app is built the way it is |

## Coverage gaps

- **Pollen**: Open-Meteo's pollen data (from CAMS) covers Europe only. Elsewhere the card says "Not available here."
- **Weather alerts**: Open-Meteo has no alerts feed, so this field always says "Not available here." No data is invented.

## License

MIT — see [LICENSE](LICENSE).
