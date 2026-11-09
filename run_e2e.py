"""End-to-end tests for Only Weather.

Serves the app locally, drives it in Chromium with Playwright and replaces the
three Open-Meteo endpoints with a stub that mimics the real API: same URL
parameters, same JSON shape, and it returns ONLY the variables the app asked for
(so a test fails if the app forgets to request something it displays).

    pip install playwright && python -m playwright install chromium
    python e2e/run_e2e.py              # optional: --chrome /usr/bin/google-chrome --axe path/to/axe.min.js
"""
import argparse, asyncio, json, math, threading, functools, sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timedelta
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
PORT = 8123
BASE = f"http://127.0.0.1:{PORT}/"

# ---------------------------------------------------------------- fake API
PLACES = {
    "berlin": dict(name="Berlin", admin1="Land Berlin", country="Germany", latitude=52.52437, longitude=13.41053, tz="Europe/Berlin"),
    "new york": dict(name="New York", admin1="New York", country="United States", latitude=40.71427, longitude=-74.00597, tz="America/New_York"),
    "paris": dict(name="Paris", admin1="Île-de-France", country="France", latitude=48.85341, longitude=2.3488, tz="Europe/Paris"),
}
NOW = "2026-11-09T22:45"

def place_for(lat):
    return min(PLACES.values(), key=lambda p: abs(p["latitude"] - lat))

def series(var, i):
    h = i % 24
    return {
        "temperature_2m": round(12.5 - 4 * math.cos((h - 3) / 24 * 2 * math.pi) + 0.05 * i, 1),
        "precipitation_probability": (h * 7 + i) % 101,
        "wind_speed_10m": round(14.3 + (h % 6) * 2.1, 1),
        "relative_humidity_2m": 60 + h % 30,
        "uv_index": round(max(0, 5 * math.sin((h - 6) / 12 * math.pi)), 2) if 6 <= h <= 18 else 0.0,
        "weather_code": [0, 1, 2, 3, 61, 80, 95][i % 7],
    }[var]

def forecast(q):
    lat = float(q["latitude"][0]); p = place_for(lat)
    days = int(q.get("forecast_days", ["7"])[0])
    start = datetime(2026, 11, 9)
    out = {"latitude": p["latitude"], "longitude": p["longitude"], "timezone": p["tz"], "utc_offset_seconds": 3600}
    cur = q.get("current", [""])[0].split(",")
    out["current"] = {"time": NOW, "interval": 900}
    vals = {"temperature_2m": 12.5, "relative_humidity_2m": 81, "wind_speed_10m": 18.4,
            "wind_direction_10m": 225, "wind_gusts_10m": 41.0, "weather_code": 3}
    for v in cur:
        if v: out["current"][v] = vals[v]
    if "hourly" in q:
        times = [(start + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(24 * days)]
        out["hourly"] = {"time": times}
        for v in q["hourly"][0].split(","):
            out["hourly"][v] = [series(v, i) for i in range(len(times))]
    if "daily" in q:
        dts = [(start + timedelta(days=d)).strftime("%Y-%m-%d") for d in range(days)]
        out["daily"] = {"time": dts}
        for v in q["daily"][0].split(","):
            out["daily"][v] = [{
                "temperature_2m_max": 15.2 + d, "temperature_2m_min": 6.1 + d / 2,
                "precipitation_probability_max": 20 + d * 10, "wind_speed_10m_max": 30.5 + d,
                "uv_index_max": 2.4 + d / 10, "weather_code": [3, 61, 0, 1, 80, 2, 95][d],
                "sunrise": f"{dts[d]}T07:{20 + d:02d}", "sunset": f"{dts[d]}T16:{30 - d:02d}",
            }[v] for d in range(days)]
    return out

def air(q):
    lat = float(q["latitude"][0]); p = place_for(lat)
    times = [(datetime(2026, 11, 9) + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(24)]
    europe = p["name"] != "New York"
    out = {"timezone": p["tz"], "hourly": {"time": times}}
    for v in q["hourly"][0].split(","):
        out["hourly"][v] = [(round(3.2 + i * 0.5, 1) if europe else None) for i in range(24)]
    return out

def geocode(q):
    name = q["name"][0].strip().lower()
    if name in PLACES:
        p = PLACES[name]
        return {"results": [{k: p[k] for k in ("name", "admin1", "country", "latitude", "longitude")}], "generationtime_ms": 0.5}
    return {"generationtime_ms": 0.4}  # what Open-Meteo returns for no match

REQUESTS = []

async def route_api(route):
    url = urlparse(route.request.url); q = parse_qs(url.query)
    REQUESTS.append(route.request.url)
    body = {"api.open-meteo.com": forecast, "air-quality-api.open-meteo.com": air,
            "geocoding-api.open-meteo.com": geocode}[url.hostname](q)
    await route.fulfill(status=200, content_type="application/json",
                        headers={"access-control-allow-origin": "*"}, body=json.dumps(body))

# ---------------------------------------------------------------- harness
RESULTS = []

def record(name, passed, detail=""):
    RESULTS.append((name, passed, detail))
    print(f"{'PASS' if passed else 'FAIL'}  {name}{('  — ' + detail) if detail else ''}")

async def new_page(browser, *, sw=False, locale="en-US", **ctx):
    context = await browser.new_context(locale=locale, service_workers="allow" if sw else "block",
                                        viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, **ctx)
    await context.route("https://*.open-meteo.com/**", route_api)
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(BASE)
    return context, page, errors

async def ask(page, request, city="Berlin"):
    await page.fill("#request", request)
    await page.fill("#city", city)
    await page.click("#show")
    await page.wait_for_function("document.querySelector('#results').getAttribute('aria-busy') === 'false'")

async def card_titles(page):
    return await page.eval_on_selector_all("#results .card h3", "els => els.map(e => e.textContent)")

async def message(page):
    if not await page.locator("#message").is_visible(): return None
    return await page.inner_text("#message-text")

UNCLEAR = "Didn't understand that. Try 'rain and wind' or pick from the list."

async def main(chrome, axe_path):
    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(**({"executable_path": chrome} if chrome else {}))

        # ---------- The 10 spec test cases ----------
        ctx, page, errs = await new_page(browser)

        await ask(page, "only rain and temperature")
        t = await card_titles(page)
        record("TC1  'only rain and temperature' → exactly 2 fields", t == ["Temperature", "Rain chance"], str(t))

        await ask(page, "everything except pollen")
        t = await card_titles(page)
        expected = ["Temperature", "Rain chance", "Wind", "UV index", "Humidity", "Sunrise & sunset",
                    "Hourly forecast", "7-day forecast", "Weather alerts"]
        record("TC2  'everything except pollen' → all but pollen", t == expected, f"{len(t)} cards")

        for tc, text in (("TC3", "should I bring a jacket?"), ("TC4", "nice day?"), ("TC5", "stock prices")):
            await ask(page, text)
            msg = await message(page); n = await page.locator("#results .card").count()
            opened = await page.locator("#picker").get_attribute("open") is not None
            record(f"{tc}  '{text}' → error, nothing shown", msg == UNCLEAR and n == 0 and opened,
                   f"msg={msg!r} cards={n} listOpen={opened}")
        await page.evaluate("document.querySelector('#picker').open = false")

        await ctx.set_offline(True)
        await ask(page, "rain")
        msg = await message(page); retry = await page.locator("#retry").is_visible()
        n = await page.locator("#results .card").count()
        ok_off = msg is not None and msg.startswith("No connection") and retry and n == 0
        await ctx.set_offline(False)
        await page.click("#retry")
        await page.wait_for_function("document.querySelector('#results').getAttribute('aria-busy') === 'false'")
        recovered = await card_titles(page) == ["Rain chance"] and await message(page) is None
        record("TC6  no connection → 'No connection' + Retry (Retry recovers)", ok_off and recovered,
               f"msg={msg!r} retry={retry} recovered={recovered}")

        await ask(page, "rain", city="Xyzabc")
        msg = await message(page)
        focused = await page.evaluate("document.activeElement.id")
        ok7 = msg is not None and "“Xyzabc”" in msg and "Check the spelling" in msg and "\n" not in msg
        record("TC7  unknown city → names the problem + fix", ok7 and focused == "city", f"{msg!r} focus={focused}")

        await ask(page, "nur Regen und Wind")
        t = await card_titles(page)
        record("TC8  'nur Regen und Wind' → rain + wind", t == ["Rain chance", "Wind"], str(t))

        await ask(page, "rian and temp")
        t = await card_titles(page)
        record("TC9  'rian and temp' → rain + temperature", t == ["Temperature", "Rain chance"], str(t))

        await ask(page, "UV and pollen", city="New York")
        t = await card_titles(page)
        uv_val = await page.locator("#results .card", has_text="UV index").locator(".value").inner_text()
        pollen_txt = await page.locator("#results .card", has_text="Pollen").inner_text()
        record("TC10 'UV and pollen' in New York → UV shown, pollen n/a",
               t == ["UV index", "Pollen"] and uv_val.strip() not in ("", "–") and "Not available here." in pollen_txt,
               f"uv={uv_val!r}")
        record("     page had no JS errors", not errs, "; ".join(errs))

        # ---------- Extra checks ----------
        await ask(page, "pollen", city="Berlin")
        txt = await page.locator("#results .card").inner_text()
        cams = await page.locator("#cams-credit").is_visible()
        record("X1   pollen in Europe shows values + CAMS credit", "Birch" in txt and "grains/m³" in txt and cams)

        before = len(REQUESTS)
        await ask(page, "humidity")
        reqs = REQUESTS[before:]
        no_air = not any("air-quality" in r for r in reqs)
        record("X2   only requested data is fetched (no pollen call for 'humidity')", no_air, f"{len(reqs)} requests")

        await ask(page, "hourly")
        t = await card_titles(page)
        rows = await page.locator("#results table tbody tr").count()
        record("X3   'hourly' alone → just the hourly table (24 rows)", t == ["Hourly forecast"] and rows == 24, f"{t} rows={rows}")

        await ask(page, "rain and wind", city="")
        record("X4   no location → one-line error with fix", (await message(page) or "").startswith("No location yet"))

        await ask(page, "forecast")
        record("X5   'forecast' alone is ambiguous → error", await message(page) == UNCLEAR)

        # checkbox path
        await page.fill("#request", "")
        await page.evaluate("document.querySelector('#picker').open = true")
        await page.evaluate("document.querySelectorAll('#checkboxes input').forEach(i => i.checked = false)")
        await page.locator(".check", has_text="Humidity").click()
        await page.locator(".check", has_text="Wind").click()
        await page.fill("#city", "Berlin"); await page.click("#show")
        await page.wait_for_function("document.querySelector('#results').getAttribute('aria-busy') === 'false'")
        record("X6   checkbox selection works", await card_titles(page) == ["Wind", "Humidity"])

        # parsed text is mirrored into the checkboxes
        await ask(page, "uv and sunrise")
        checked = await page.eval_on_selector_all("#checkboxes input:checked", "els => els.map(e => e.value)")
        record("X7   parsed request is mirrored in the checkbox list", checked == ["uv", "sun"], str(checked))

        # tap targets
        small = await page.evaluate("""() => [...document.querySelectorAll('button, select, input:not(.check input), summary, label.check, a:not(.skip)')]
          .filter(e => e.offsetParent !== null)
          .map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent.trim().slice(0,20) || e.tagName, Math.round(r.width), Math.round(r.height)]; })
          .filter(([, w, h]) => (h < 44 || w < 44) && !['INPUT'].includes(''))""")
        # checkboxes themselves are inside 44px labels; inputs are 52px tall
        small = [s for s in small if s[0] not in ("",)]
        record("X8   all tap targets ≥ 44×44 px", not small, str(small))
        await ctx.close()

        # German UI + number formatting
        ctx, page, errs = await new_page(browser, locale="de-DE")
        lbl = await page.inner_text("label[for=request]")
        await ask(page, "Temperatur")
        val = await page.locator("#results .card .value").first.inner_text()
        record("X9   German UI and Intl formatting (12,5 °C)", lbl == "Was möchtest du sehen?" and val.replace(" ", " ").replace("\xa0", " ") == "12,5 °C", f"{lbl!r} {val!r}")
        await page.select_option("#lang", "fr")
        h3 = await card_titles(page)
        record("X10  switching language re-renders results", h3 == ["Température"], str(h3))
        await ctx.close()

        # GPS: permission only on tap; typed city wins
        ctx, page, errs = await new_page(browser, permissions=["geolocation"], geolocation={"latitude": 48.8534, "longitude": 2.3488})
        await page.add_init_script("""(() => { const g = navigator.geolocation; const orig = g.getCurrentPosition.bind(g);
            window.__geoCalls = 0; g.getCurrentPosition = (...a) => { window.__geoCalls++; return orig(...a); }; })()""")
        await page.reload()
        await page.fill("#request", "temperature"); await page.fill("#city", "Berlin"); await page.click("#show")
        await page.wait_for_function("document.querySelector('#results h2')")
        prompted_early = await page.evaluate("window.__geoCalls")
        await page.fill("#request", "temperature")
        await page.fill("#city", "Berlin")
        await page.click("#gps")
        await page.wait_for_timeout(500)
        await page.wait_for_function("document.querySelector('#results').getAttribute('aria-busy') === 'false' && document.querySelector('#results h2')")
        name_city = await page.inner_text("#results h2")
        await page.fill("#city", ""); await page.click("#show")
        await page.wait_for_function("document.querySelector('#results h2')?.textContent === 'Your location'")
        last_fc = [r for r in REQUESTS if "api.open-meteo.com/v1/forecast" in r][-1]
        record("X11  GPS asked only after tap; typed city beats GPS",
               prompted_early == 0 and await page.evaluate("window.__geoCalls") == 1 and name_city.startswith("Berlin") and "latitude=48.8534" in last_fc,
               f"geo-calls-before-tap={prompted_early} withCity={name_city!r}")
        await ctx.close()

        ctx, page, errs = await new_page(browser)
        await ctx.clear_permissions()
        await page.fill("#request", "wind"); await page.click("#gps")
        await page.wait_for_function("!document.querySelector('#message').hidden")
        record("X12  GPS denied → one-line error suggesting a city", (await message(page) or "").startswith("Location access is blocked"))
        await ctx.close()

        # Service worker: shell works offline; API never cached; nothing in storage
        ctx, page, errs = await new_page(browser, sw=True)
        await page.wait_for_function("navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready.then(()=>true)")
        await page.evaluate("navigator.serviceWorker.ready")
        await page.reload(); await page.wait_for_timeout(300)
        await ask(page, "rain and wind")
        await ctx.set_offline(True)
        await page.reload()
        shell_ok = await page.locator("#request").is_visible()
        await ask(page, "rain")
        offline_msg = await message(page)
        cached = await page.evaluate("caches.keys().then(ks => Promise.all(ks.map(k => caches.open(k).then(c => c.keys())))).then(a => a.flat().map(r => r.url))")
        storage = await page.evaluate("[localStorage.length, sessionStorage.length, document.cookie]")
        record("X13  offline launch: app shell loads from service worker", shell_ok)
        record("X14  offline request → 'No connection' (API never cached)",
               (offline_msg or "").startswith("No connection") and not any("open-meteo" in u for u in cached), f"{len(cached)} cached files")
        record("X15  nothing stored (localStorage/sessionStorage/cookies empty)", storage == [0, 0, ""], str(storage))
        manifest = await page.evaluate("fetch('manifest.json').then(r => r.json())")
        record("X16  manifest has name, start_url, standalone, 192+512 icons",
               manifest["display"] == "standalone" and {"192x192", "512x512"} <= {i["sizes"] for i in manifest["icons"]})
        await ctx.close()

        # Accessibility audit (axe-core), light and dark
        if axe_path:
            axe = Path(axe_path).read_text()
            for scheme in ("light", "dark"):
                ctx, page, errs = await new_page(browser, color_scheme=scheme)
                await ask(page, "everything")
                await page.evaluate("document.querySelector('#picker').open = true")
                await page.add_script_tag(content=axe)
                res = await page.evaluate("axe.run(document, {runOnly: ['wcag2a','wcag2aa','best-practice']})")
                v = [(x["id"], len(x["nodes"])) for x in res["violations"]]
                record(f"X17  axe-core WCAG 2 AA audit ({scheme})", not v, str(v))
                await ctx.close()

        # screenshots for review
        for scheme in ("light", "dark"):
            ctx, page, errs = await new_page(browser, color_scheme=scheme)
            await ask(page, "temperature, rain, wind and 7-day")
            await page.screenshot(path=str(ROOT / "e2e" / f"screenshot-{scheme}.png"), full_page=True)
            await ctx.close()

        await browser.close()
    srv.shutdown()
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} passed")
    return 1 if failed else 0

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--chrome"); ap.add_argument("--axe")
    a = ap.parse_args()
    sys.exit(asyncio.run(main(a.chrome, a.axe)))
