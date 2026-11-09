# Learning notes: how Only Weather is built, and why

This document assumes you know JavaScript, the DOM and `fetch`. It focuses on the
architecture and on the reasoning behind each decision — including the ones that
changed during development because a test proved the first idea wrong.

---

## 1. The one rule everything serves

> Show only the fields the user asked for. Never guess.

Almost every design decision below is this rule applied to a different layer:
the parser refuses to guess, the data layer refuses to fetch extras, the renderer
refuses to add "helpful" cards, and the coverage-gap cards refuse to invent data.
When two goals conflicted, this rule decided.

---

## 2. Architecture

```
            ┌──────────────┐   text    ┌────────────┐
 user ──►   │   app.js     │ ────────► │ parser.js  │  pure, no DOM, no network
 (input,    │  (UI + i18n) │ ◄──────── │            │  → { ok, fields } | { ok:false }
 checkboxes,│              │  fields   └────────────┘
 GPS tap)   │              │
            │              │  location ┌────────────┐
            │              │  + fields │ weather.js │  network, no DOM
            │              │ ────────► │            │ ──► Open-Meteo (3 endpoints)
            │              │ ◄──────── │            │
            │              │  model or └────────────┘
            │              │  WeatherError(code)
            └──────────────┘
                   │ render(): one card per selected field, fixed order
                   ▼
                  DOM
 sw.js: caches the app shell only (never API responses)
```

**Why three modules with hard boundaries?**

- `parser.js` has no DOM and no network, so it runs unchanged in Node. That is
  what made it possible to build and test the parser *before any UI existed*
  (the process the spec required) and keeps its tests fast and dependency-free.
- `weather.js` has no DOM. It converts every failure into a `WeatherError` with a
  small, stable set of codes (`offline`, `timeout`, `api`, `city-not-found`,
  `geo-denied`, …). The UI owns the *wording*; the data layer owns the *meaning*.
  This is what makes four languages cheap: one code → four strings.
- `app.js` is the only file that knows about the page. It holds state in memory
  only.

No framework and no build step: the app is small, a framework would dominate the
download on a phone, and "open the folder with a static server" is the easiest
possible way for an open-source contributor to start.

---

## 3. The parser

### 3.1 Why not an AI model?

An LLM would understand more phrasings, but it is non-deterministic, costs money
per request, needs a network connection, sends user text to a third party and is
hard to test exhaustively. A dictionary + typo matcher is free, offline, private,
and gives the *same answer every time* — so a test that passes today passes
tomorrow. For a vocabulary of ten fields, that trade is clearly worth it.

### 3.2 Pipeline

```
"Nur Regen, und Wind!"
  │ normalize: lowercase, ß→ss, strip accents (NFD), punctuation→space
  ▼
["nur", "regen", "und", "wind"]
  │ scan left→right: longest multi-word phrase first ("lever du soleil")
  │ else classify the single token
  ▼
nur:stop  regen:field(rain)  und:stop  wind:field(wind)
  │ combine: include / exclude / "everything" mode
  ▼
{ ok: true, fields: ["rain", "wind"] }
```

Normalizing accents away means the dictionary is written once without accents,
and "humidite", "humidité" and "HUMIDITÉ" all match. Punctuation becomes spaces,
so "7-day", "UV-Index" and "rain/wind" become ordinary multi-word phrases.

All four languages share one dictionary. The parser does not need to know which
language the user typed — "nur rain and Wind" works — and there is no language
detection step that could itself be wrong.

### 3.3 Token classes

| Class | Examples | Effect |
|---|---|---|
| field synonym | `rain`, `regen`, `pluie`, `lluvia`, `temp` | adds the field |
| stopword | `only`, `nur`, `et`, `y`, `the`, `today` | ignored (exact match only) |
| all-word | `everything`, `alles`, `tout`, `todo` | switches to "all minus exclusions" |
| except-word | `except`, `außer`, `sauf`, `excepto`, `not` | following fields are excluded |
| forecast-word | `forecast`, `Vorhersage` | allowed only next to hourly/7-day |
| vague word | `weather`, `sun`, `temps` | always an error |
| anything else | `jacket`, `stock` | typo matcher, else error |

### 3.4 "Every word must be understood"

The key rule: **if any word is unknown, vague or ambiguous, the whole request is
rejected**. "rain and stock prices" does not show rain — it shows the error.

Why so strict? The alternative — keep what you recognise, drop the rest — fails
silently in exactly the cases the spec cares about. "should I bring a jacket?"
contains no field word, so the lenient version would show nothing *and say
nothing*, or worse, a fuzzy match on some word would show a random field. With
the strict rule, every word the app did not understand is a visible error that
opens the checkbox list, so the user always has a way forward.

Some words are deliberately classified as **vague** instead of being given a
meaning: "sun" could mean sunrise/sunset or UV; French "temps" means *weather*,
not *temperature*; "forecast" alone does not say hourly or 7-day. Making these an
error is the "show an error whenever it is unclear WHICH field was meant" rule
from the spec, encoded as data rather than as special-case `if`s.

### 3.5 The typo matcher — and how the first version was wrong

The matcher uses the *optimal string alignment* distance: Levenshtein plus
adjacent transpositions. Plain Levenshtein scores "rian" → "rain" as 2 (two
substitutions); with transpositions it is 1, which is how humans experience a
swapped pair of letters.

The first version allowed one edit for words of 4–6 letters and two for 7+.
All spec tests passed. Then a probe with ordinary words showed:

```
train → rain    pain → rain    wine → wind    wild → wind    weak → 7-day
```

"pain" is French for *bread*. Every one of these would have shown a field nobody
asked for — the exact failure the core policy forbids, and one the spec's test
table would never have caught. The fix is three rules, each with a reason:

1. **The first letter must match.** People rarely mistype the first letter; most
   real-word collisions differ exactly there (train/rain, pain/rain).
2. **Short words (4–6 letters) allow only a swapped, missing or extra letter —
   not a substituted one.** In short words a substitution usually produces
   another real word (wine/wind, wild/wind). Implemented by giving substitution
   cost 2 in the distance function for short words.
3. **A tiny `NOT_TYPOS` list** for the few real words that still slip through
   (e.g. Spanish "venta" = sale, Italian/English "tempo").

Words shorter than 4 letters get no typo tolerance at all: "uv", "sol" and "day"
are one edit away from too many things.

If a typo is equally close to synonyms of **two different fields**, the result is
`ambiguous` → error, never a coin flip.

Lesson: tests derived from the spec prove the features work. You also need tests
that try to make the system *do something it shouldn't* — here, a list of real
words that must not become fields (see `parser.test.js`).

### 3.6 Output order

Fields are returned in a fixed canonical order (temperature, rain, wind, …), not
in the order typed. The layout then always looks the same for the same
selection, the checkbox list mirrors it naturally, and screen-reader users learn
where things are.

---

## 4. The data layer

### 4.1 Fetch only what was asked for

`buildForecastUrl()` builds the Open-Meteo `current`, `hourly` and `daily`
parameters from the selected fields. "Humidity" requests humidity; it does not
also download wind and UV "in case". The air-quality endpoint is called *only* if
pollen was requested. Smaller responses help on mobile data, and it is the core
policy applied to the network: the app does not even *have* data it was not
asked for, so it cannot accidentally show it.

The e2e stub enforces this: it returns only the variables in the URL, so if the
renderer ever displays something the URL did not request, a test shows `–` or fails.

### 4.2 Location: typed city beats GPS, GPS only after a tap

`resolveLocation()` is three lines because the policy is simple: if the city box
has text, geocode it; else use GPS coordinates if the user granted them this
session; else return `null` (→ "No location yet" error). Typing is the more
deliberate act — someone with GPS on who types "Lisbon" is planning a trip.

`navigator.geolocation` is never touched until the user taps "Use my location".
Browsers show the permission prompt at the first call, so calling it on load
would mean prompting before the user asked. The e2e test wraps
`getCurrentPosition` and asserts it was called zero times before the tap.

### 4.3 Errors as a small vocabulary

Every failure maps to one code. `fetch()` only rejects for network-level
problems, so a rejection → `offline`; an `AbortController` timeout → `timeout`;
a non-2xx response → `api`; a geocoding response without `results` →
`city-not-found` (Open-Meteo returns 200 with no `results` key, not a 404).
`offline`, `timeout` and `api` are *retryable* and get a Retry button; the
others need the user to change something (spelling, permission), so instead the
relevant input gets focus.

Every message follows the spec's format: one line saying what went wrong, then
how to fix it.

### 4.4 Coverage gaps: detect from data, don't guess from geography

Pollen comes from CAMS Europe. One could hard-code a bounding box around Europe,
but that would drift from the provider's real coverage. Instead the app looks at
the response: if every pollen value is `null`, it says "Not available here."
The source of truth is the data provider itself.

Weather alerts are not offered by Open-Meteo at all. The field still exists
(the spec lists it, and a user may ask for it), so it renders as an honest
"Not available here — the weather source has no alerts feed." It never pretends.

### 4.5 Time zones without a date library

With `timezone=auto`, Open-Meteo returns times as *local wall-clock strings
without an offset* ("2026-11-09T22:00"). Parsing that with `new Date()` would
interpret it in the *phone's* zone — wrong if you look up Tokyo from Berlin.
The trick: append `Z`, treat it as UTC, and format with `timeZone: 'UTC'`. The
printed digits are exactly the location's wall-clock time, regardless of where
the phone is.

The forecast always fetches at least 2 days so "next 24 hours" still works at
10 pm.

---

## 5. The UI

### 5.1 Text vs. checkboxes: one source of truth at a time

Two inputs can disagree, so the rule is explicit:

- If the text box has content, the text wins. After a successful parse, the
  checkboxes are set to what was understood — the user can *see* how their words
  were interpreted (a cheap form of explainability).
- Ticking a checkbox clears the text box, so the list becomes the source of truth.

### 5.2 Time range

Metric cards show **now + the rest of today, hour by hour** (the spec's default).
The full 24-hour table and the 7-day table appear only when those fields are
requested. If someone asks *only* for "hourly" or "7-day", the table needs at
least one column; it uses temperature. That is the one place the app adds a
value the user did not name, and it is a deliberate reading: a forecast with no
values is empty, and temperature is what "forecast" means to most people.
It is documented here so it can be revisited.

### 5.3 Formatting is the platform's job

`Intl.NumberFormat` with `style: 'unit'` produces `12,5 °C` in German and
`12.5°C` in English, `18 km/h`, `75 %` vs `75%`, and correct 12/24-hour clocks
through `Intl.DateTimeFormat`. `Intl.ListFormat` builds "Temperature, Rain chance,
and Wind" / "Temperatur, Regenwahrscheinlichkeit und Wind". Hand-written string
concatenation gets at least one of these wrong in at least one language.

### 5.4 Accessibility decisions

- Every card is an `<article>` labelled by its heading; errors use `role="alert"`;
  results are an `aria-live` region with `aria-busy` during loading.
- Hourly strips are `<ol>` lists; tables use `<th scope>`. Weather icons are emoji
  with `aria-hidden`, and the condition is given as visually hidden text.
- On narrow screens, table headers are abbreviated ("Temp", "Rain"), with the full
  field name in visually hidden text, so the 7-day table fits a 390px screen
  without losing meaning for screen readers.
- Tap targets: all buttons/inputs ≥ 44 px; checkbox *labels* are the 44 px targets;
  footer links get invisible padding with negative margins so the text doesn't move.
- Scrollable regions (hourly strips, wide tables) have `tabindex="0"` so keyboard
  users can scroll them — found by the axe-core audit in the e2e suite.
- Contrast was chosen with numbers (see comments in `styles.css`) and checked by
  axe in light and dark mode.

### 5.5 A CSS bug worth remembering

`.message { display: flex }` silently overrode the `hidden` attribute, so after an
error was cleared an empty red box stayed on screen. The `hidden` attribute is
just `display: none` in the browser's stylesheet, and *any* author `display`
rule beats it. Fix: `[hidden] { display: none !important; }`. The e2e helper was
changed to check visibility, not the attribute, which is what exposed it.

---

## 6. PWA and privacy

- **Service worker**: stale-while-revalidate for the app's own files — instant
  start, offline launch, and updates arrive on the next visit.
- **API responses are never cached.** Their URLs contain the user's coordinates;
  caching them would be stored user data. Offline, the app opens and shows
  "No connection" + Retry instead of stale weather.
- **No storage at all**: no `localStorage`, cookies or IndexedDB. Language comes
  from `navigator.languages` on each launch. The e2e suite asserts storage is empty.
- **No third-party requests** except Open-Meteo: system fonts instead of web
  fonts, no CDN, no analytics.

---

## 7. Testing strategy

| Layer | Tool | What it proves |
|---|---|---|
| Parser | `node --test` | Spec cases, 4 languages, typos, strictness, real-word false positives |
| App | Playwright + stubbed API | All 10 spec cases end to end, plus GPS/permission, offline shell, storage, tap targets, i18n formatting |
| Accessibility | axe-core in the e2e run | WCAG 2 A/AA + best practices, light and dark |

Stubbing the API makes tests deterministic (weather changes; tests shouldn't) and
lets them run without network. The stub mimics Open-Meteo's real contract,
including returning only requested variables and the "200 with no results" shape
for unknown cities.

---

## 8. Known limitations / next steps

- The parser understands field words, not intent: "rain tomorrow", "is it cold"
  or "do I need sunscreen" are rejected rather than interpreted. That is by
  design, but a future version could map a few unambiguous intents
  (e.g. "sunscreen" → UV) after user testing.
- No weather alerts (data-source limitation). A regional source such as DWD
  (Germany) or MeteoAlarm (EU) could be added per country.
- Geocoding takes the first match ("Paris" → France, not Texas). A "Did you
  mean…" list would fix this.
- "Today" for the hourly strip ends at midnight, so late at night it is short.
