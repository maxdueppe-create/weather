// weather.js — data layer: location (GPS / city) and Open-Meteo calls.
// Knows nothing about the DOM. Every failure is turned into a WeatherError
// with a stable `code`, so the UI can map it to one localized line + a fix.

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const TIMEOUT_MS = 12000;

export const POLLEN_TYPES = ['alder', 'birch', 'grass', 'mugwort', 'olive', 'ragweed'];

export class WeatherError extends Error {
  /** @param {'offline'|'timeout'|'city-not-found'|'api'|'geo-denied'|'geo-unavailable'|'geo-unsupported'} code */
  constructor(code, detail = '') {
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.code = code;
    this.detail = detail;
  }
}

async function getJSON(url) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new WeatherError('offline');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch (err) {
    // fetch only rejects for network-level failures (no connection, DNS, CORS, abort).
    throw new WeatherError(err.name === 'AbortError' ? 'timeout' : 'offline');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let reason = `HTTP ${res.status}`;
    try { reason = (await res.json()).reason || reason; } catch { /* not JSON */ }
    throw new WeatherError('api', reason);
  }
  return res.json();
}

// ---------- Location ----------

/** Resolve a typed city name. Throws WeatherError('city-not-found'). */
export async function geocode(name, lang = 'en') {
  const url = `${GEOCODE_URL}?${new URLSearchParams({ name: name.trim(), count: '1', language: lang, format: 'json' })}`;
  const data = await getJSON(url);
  const hit = data.results?.[0];
  if (!hit) throw new WeatherError('city-not-found', name.trim());
  return {
    lat: hit.latitude,
    lon: hit.longitude,
    label: [hit.name, hit.admin1 !== hit.name ? hit.admin1 : null, hit.country].filter(Boolean).join(', '),
  };
}

/** Ask the browser for the position. Only call this after the user tapped "Use my location". */
export function getGpsPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new WeatherError('geo-unsupported'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: null }),
      (err) => reject(new WeatherError(err.code === err.PERMISSION_DENIED ? 'geo-denied' : 'geo-unavailable')),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

/**
 * The typed city wins over GPS: typing is the more deliberate choice.
 * Returns null when there is no location at all.
 */
export async function resolveLocation({ city, gps }, lang) {
  if (city && city.trim()) return geocode(city, lang);
  if (gps) return gps;
  return null;
}

// ---------- Weather ----------

// Only ask the API for what the selected fields need: smaller responses,
// and nothing is fetched "for convenience".
export function buildForecastUrl({ lat, lon }, fields) {
  const has = (f) => fields.includes(f);
  const hourly = new Set();
  const daily = new Set();
  const current = new Set();
  // Metrics shown in a forecast table: the selected ones, or temperature if none.
  const metrics = forecastMetrics(fields);
  const needsTables = has('hourly') || has('daily');

  if (has('temperature') || (needsTables && metrics.includes('temperature'))) {
    current.add('temperature_2m'); hourly.add('temperature_2m');
    daily.add('temperature_2m_max'); daily.add('temperature_2m_min');
  }
  if (has('rain') || (needsTables && metrics.includes('rain'))) {
    hourly.add('precipitation_probability'); daily.add('precipitation_probability_max');
  }
  if (has('wind') || (needsTables && metrics.includes('wind'))) {
    current.add('wind_speed_10m'); current.add('wind_direction_10m'); current.add('wind_gusts_10m');
    hourly.add('wind_speed_10m'); daily.add('wind_speed_10m_max');
  }
  if (has('humidity') || (needsTables && metrics.includes('humidity'))) {
    current.add('relative_humidity_2m'); hourly.add('relative_humidity_2m');
  }
  if (has('uv') || (needsTables && metrics.includes('uv'))) {
    hourly.add('uv_index'); daily.add('uv_index_max');
  }
  if (has('sun')) { daily.add('sunrise'); daily.add('sunset'); }
  if (needsTables) { hourly.add('weather_code'); daily.add('weather_code'); }

  // Open-Meteo requires at least one variable; temperature is cheap and never displayed unless asked.
  if (!current.size) current.add('temperature_2m');

  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    timezone: 'auto',
    forecast_days: has('daily') ? '7' : '2', // 2 days so "next 24 h" works late in the evening
    current: [...current].join(','),
  });
  if (hourly.size) params.set('hourly', [...hourly].join(','));
  if (daily.size) params.set('daily', [...daily].join(','));
  return `${FORECAST_URL}?${params}`;
}

export function buildAirUrl({ lat, lon }) {
  return `${AIR_URL}?${new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    timezone: 'auto',
    forecast_days: '1',
    hourly: POLLEN_TYPES.map((t) => `${t}_pollen`).join(','),
  })}`;
}

/** Metrics a forecast table should show: the selected metric fields, else temperature. */
export function forecastMetrics(fields) {
  const m = ['temperature', 'rain', 'wind', 'humidity', 'uv'].filter((f) => fields.includes(f));
  return m.length ? m : ['temperature'];
}

const hourKey = (iso) => iso.slice(0, 13); // "2026-11-09T22"

/** Fetch everything the selected fields need and return a display-ready model. */
export async function fetchWeather(location, fields) {
  const wantPollen = fields.includes('pollen');
  const [fc, air] = await Promise.all([
    getJSON(buildForecastUrl(location, fields)),
    wantPollen ? getJSON(buildAirUrl(location)).catch((e) => {
      if (e.code === 'offline' || e.code === 'timeout') throw e;
      return null; // API refused the location → treat as "not available here"
    }) : null,
  ]);
  return toModel(fc, air, fields);
}

// Pure transformation, exported for tests.
export function toModel(fc, air, fields) {
  const nowIso = fc.current?.time ?? fc.hourly?.time?.[0];
  const today = nowIso.slice(0, 10);
  const H = fc.hourly ?? {};
  const times = H.time ?? [];
  const nowIdx = Math.max(0, times.findIndex((t) => hourKey(t) === hourKey(nowIso)));

  const hourRow = (i) => ({
    time: times[i],
    temperature: H.temperature_2m?.[i],
    rain: H.precipitation_probability?.[i],
    wind: H.wind_speed_10m?.[i],
    humidity: H.relative_humidity_2m?.[i],
    uv: H.uv_index?.[i],
    code: H.weather_code?.[i],
  });

  // Default time range: now + the rest of today, hour by hour.
  const todayHours = [];
  for (let i = nowIdx; i < times.length && times[i].startsWith(today); i++) todayHours.push(hourRow(i));
  // "Hourly forecast" field: the next 24 hours.
  const next24 = [];
  for (let i = nowIdx; i < Math.min(times.length, nowIdx + 24); i++) next24.push(hourRow(i));

  const D = fc.daily ?? {};
  const days = (D.time ?? []).map((date, i) => ({
    date,
    tMax: D.temperature_2m_max?.[i], tMin: D.temperature_2m_min?.[i],
    rain: D.precipitation_probability_max?.[i],
    wind: D.wind_speed_10m_max?.[i],
    uv: D.uv_index_max?.[i],
    code: D.weather_code?.[i],
    sunrise: D.sunrise?.[i], sunset: D.sunset?.[i],
  }));
  const todayDaily = days.find((d) => d.date === today) ?? days[0];

  let pollen = null;
  if (fields.includes('pollen')) {
    const A = air?.hourly;
    const aIdx = A ? Math.max(0, (A.time ?? []).findIndex((t) => hourKey(t) === hourKey(nowIso))) : -1;
    const values = Object.fromEntries(POLLEN_TYPES.map((t) => [t, A?.[`${t}_pollen`]?.[aIdx] ?? null]));
    // Open-Meteo pollen comes from CAMS Europe: elsewhere every value is null.
    const available = Object.values(values).some((v) => v !== null && v !== undefined);
    pollen = { available, values };
  }

  return {
    timezone: fc.timezone,
    nowIso,
    current: {
      temperature: fc.current?.temperature_2m,
      humidity: fc.current?.relative_humidity_2m,
      windSpeed: fc.current?.wind_speed_10m,
      windDir: fc.current?.wind_direction_10m,
      windGusts: fc.current?.wind_gusts_10m,
      rain: H.precipitation_probability?.[nowIdx],
      uv: H.uv_index?.[nowIdx],
    },
    today: { tMax: todayDaily?.tMax, tMin: todayDaily?.tMin, uvMax: todayDaily?.uv, sunrise: todayDaily?.sunrise, sunset: todayDaily?.sunset },
    todayHours,
    next24,
    days,
    pollen,
    alerts: { available: false }, // Open-Meteo has no alerts feed. Never invented.
  };
}
