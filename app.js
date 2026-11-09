// app.js — UI glue: i18n, input handling, rendering, PWA registration.
// State lives only in memory; nothing is written to storage, so every launch starts fresh.

import { FIELDS, parseRequest } from './parser.js';
import {
  WeatherError, resolveLocation, getGpsPosition, fetchWeather, forecastMetrics, POLLEN_TYPES,
} from './weather.js';

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------
const T = {
  en: {
    appName: 'Only Weather', language: 'Language', skip: 'Skip to results',
    requestLabel: 'What do you want to see?', requestPlaceholder: 'e.g. rain and wind',
    pickFromList: 'Or pick from the list',
    cityLabel: 'Where?', cityPlaceholder: 'City, e.g. Lisbon', useLocation: 'Use my location',
    gpsAsking: 'Asking for your location…', gpsOn: 'Using your current location.',
    gpsCityWins: 'Using the city you typed (it takes priority over your location).',
    show: 'Show weather', loading: 'Loading…', retry: 'Retry',
    dataBy: 'Weather data by', camsCredit: 'Pollen data generated using Copernicus Atmosphere Monitoring Service information.',
    privacy: 'No tracking. Nothing is stored.',
    fields: {
      temperature: 'Temperature', rain: 'Rain chance', wind: 'Wind', uv: 'UV index', pollen: 'Pollen',
      humidity: 'Humidity', sun: 'Sunrise & sunset', hourly: 'Hourly forecast', daily: '7-day forecast', alerts: 'Weather alerts',
    },
    err: {
      unclear: "Didn't understand that. Try 'rain and wind' or pick from the list.",
      noFields: "Nothing selected. Type something like 'rain and wind' or pick from the list.",
      noLocation: "No location yet. Type a city or tap 'Use my location'.",
      offline: 'No connection. Check your internet, then tap Retry.',
      timeout: 'The weather service took too long to answer. Tap Retry.',
      api: 'The weather service returned an error. Tap Retry or try again later.',
      cityNotFound: "Couldn't find a place called “{city}”. Check the spelling or try a nearby larger town.",
      geoDenied: 'Location access is blocked. Type a city instead, or allow location in your browser settings.',
      geoUnavailable: "Couldn't get your location. Type a city instead.",
      geoUnsupported: "This browser can't share your location. Type a city instead.",
    },
    yourLocation: 'Your location', asOf: 'Local time {time}', showing: 'Showing: {list}',
    now: 'Now', todayRange: 'Today {min} to {max}', gusts: 'Gusts {v}', todayMax: 'Today’s max {v}',
    sunrise: 'Sunrise', sunset: 'Sunset', notAvailable: 'Not available here.',
    pollenWhy: 'Pollen data covers Europe only.', alertsWhy: 'The weather source has no alerts feed.',
    pollenUnit: 'grains/m³', time: 'Time', day: 'Day', minMax: 'Min / max',
    todayHourly: 'Today, hour by hour',
    short: { temperature: 'Temp', rain: 'Rain', wind: 'Wind', humidity: 'Humid.', uv: 'UV' },
    uvLevel: ['Low', 'Moderate', 'High', 'Very high', 'Extreme'],
    pollenTypes: { alder: 'Alder', birch: 'Birch', grass: 'Grass', mugwort: 'Mugwort', olive: 'Olive', ragweed: 'Ragweed' },
    compass: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], from: 'from {dir}',
    wmo: { clear: 'Clear', mainlyClear: 'Mainly clear', partly: 'Partly cloudy', overcast: 'Overcast', fog: 'Fog', drizzle: 'Drizzle', rain: 'Rain', freezing: 'Freezing rain', snow: 'Snow', showers: 'Showers', snowShowers: 'Snow showers', thunder: 'Thunderstorm' },
  },
  de: {
    appName: 'Nur Wetter', language: 'Sprache', skip: 'Zu den Ergebnissen springen',
    requestLabel: 'Was möchtest du sehen?', requestPlaceholder: 'z. B. Regen und Wind',
    pickFromList: 'Oder aus der Liste wählen',
    cityLabel: 'Wo?', cityPlaceholder: 'Stadt, z. B. Lissabon', useLocation: 'Meinen Standort verwenden',
    gpsAsking: 'Standort wird abgefragt…', gpsOn: 'Dein aktueller Standort wird verwendet.',
    gpsCityWins: 'Die eingegebene Stadt wird verwendet (sie hat Vorrang vor deinem Standort).',
    show: 'Wetter anzeigen', loading: 'Lädt…', retry: 'Erneut versuchen',
    dataBy: 'Wetterdaten von', camsCredit: 'Pollendaten erstellt mit Informationen des Copernicus Atmosphere Monitoring Service.',
    privacy: 'Kein Tracking. Nichts wird gespeichert.',
    fields: {
      temperature: 'Temperatur', rain: 'Regenwahrscheinlichkeit', wind: 'Wind', uv: 'UV-Index', pollen: 'Pollen',
      humidity: 'Luftfeuchtigkeit', sun: 'Sonnenauf- & -untergang', hourly: 'Stündliche Vorhersage', daily: '7-Tage-Vorhersage', alerts: 'Unwetterwarnungen',
    },
    err: {
      unclear: "Das habe ich nicht verstanden. Versuch 'Regen und Wind' oder wähle aus der Liste.",
      noFields: "Nichts ausgewählt. Schreib z. B. 'Regen und Wind' oder wähle aus der Liste.",
      noLocation: "Noch kein Ort. Gib eine Stadt ein oder tippe auf 'Meinen Standort verwenden'.",
      offline: 'Keine Verbindung. Prüfe dein Internet und tippe dann auf „Erneut versuchen“.',
      timeout: 'Der Wetterdienst hat zu lange gebraucht. Tippe auf „Erneut versuchen“.',
      api: 'Der Wetterdienst meldet einen Fehler. Tippe auf „Erneut versuchen“ oder versuch es später.',
      cityNotFound: 'Kein Ort namens „{city}“ gefunden. Prüfe die Schreibweise oder nimm eine größere Stadt in der Nähe.',
      geoDenied: 'Standortzugriff ist blockiert. Gib eine Stadt ein oder erlaube den Standort in den Browser-Einstellungen.',
      geoUnavailable: 'Standort konnte nicht ermittelt werden. Gib stattdessen eine Stadt ein.',
      geoUnsupported: 'Dieser Browser kann keinen Standort teilen. Gib stattdessen eine Stadt ein.',
    },
    yourLocation: 'Dein Standort', asOf: 'Ortszeit {time}', showing: 'Angezeigt: {list}',
    now: 'Jetzt', todayRange: 'Heute {min} bis {max}', gusts: 'Böen {v}', todayMax: 'Heute max. {v}',
    sunrise: 'Aufgang', sunset: 'Untergang', notAvailable: 'Hier nicht verfügbar.',
    pollenWhy: 'Pollendaten gibt es nur für Europa.', alertsWhy: 'Die Wetterquelle liefert keine Warnungen.',
    pollenUnit: 'Körner/m³', time: 'Zeit', day: 'Tag', minMax: 'Min. / max.',
    todayHourly: 'Heute, Stunde für Stunde',
    short: { temperature: 'Temp.', rain: 'Regen', wind: 'Wind', humidity: 'Feuchte', uv: 'UV' },
    uvLevel: ['Niedrig', 'Mäßig', 'Hoch', 'Sehr hoch', 'Extrem'],
    pollenTypes: { alder: 'Erle', birch: 'Birke', grass: 'Gräser', mugwort: 'Beifuß', olive: 'Olive', ragweed: 'Ambrosia' },
    compass: ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'], from: 'aus {dir}',
    wmo: { clear: 'Klar', mainlyClear: 'Überwiegend klar', partly: 'Teils bewölkt', overcast: 'Bedeckt', fog: 'Nebel', drizzle: 'Nieselregen', rain: 'Regen', freezing: 'Gefrierender Regen', snow: 'Schnee', showers: 'Schauer', snowShowers: 'Schneeschauer', thunder: 'Gewitter' },
  },
  fr: {
    appName: 'Juste la météo', language: 'Langue', skip: 'Aller aux résultats',
    requestLabel: 'Que voulez-vous voir ?', requestPlaceholder: 'ex. pluie et vent',
    pickFromList: 'Ou choisir dans la liste',
    cityLabel: 'Où ?', cityPlaceholder: 'Ville, ex. Lisbonne', useLocation: 'Utiliser ma position',
    gpsAsking: 'Demande de votre position…', gpsOn: 'Votre position actuelle est utilisée.',
    gpsCityWins: 'La ville saisie est utilisée (elle est prioritaire sur votre position).',
    show: 'Afficher la météo', loading: 'Chargement…', retry: 'Réessayer',
    dataBy: 'Données météo par', camsCredit: 'Données polliniques générées à partir d’informations du Copernicus Atmosphere Monitoring Service.',
    privacy: 'Aucun suivi. Rien n’est enregistré.',
    fields: {
      temperature: 'Température', rain: 'Risque de pluie', wind: 'Vent', uv: 'Indice UV', pollen: 'Pollen',
      humidity: 'Humidité', sun: 'Lever & coucher du soleil', hourly: 'Prévisions horaires', daily: 'Prévisions sur 7 jours', alerts: 'Alertes météo',
    },
    err: {
      unclear: "Je n’ai pas compris. Essayez 'pluie et vent' ou choisissez dans la liste.",
      noFields: "Rien de sélectionné. Écrivez par ex. 'pluie et vent' ou choisissez dans la liste.",
      noLocation: "Pas encore de lieu. Saisissez une ville ou touchez 'Utiliser ma position'.",
      offline: 'Pas de connexion. Vérifiez Internet, puis touchez Réessayer.',
      timeout: 'Le service météo a mis trop de temps à répondre. Touchez Réessayer.',
      api: 'Le service météo a renvoyé une erreur. Touchez Réessayer ou réessayez plus tard.',
      cityNotFound: 'Aucun lieu nommé « {city} ». Vérifiez l’orthographe ou essayez une ville plus grande à proximité.',
      geoDenied: 'L’accès à la position est bloqué. Saisissez une ville ou autorisez la position dans le navigateur.',
      geoUnavailable: 'Impossible d’obtenir votre position. Saisissez plutôt une ville.',
      geoUnsupported: 'Ce navigateur ne peut pas partager votre position. Saisissez plutôt une ville.',
    },
    yourLocation: 'Votre position', asOf: 'Heure locale {time}', showing: 'Affiché : {list}',
    now: 'Maintenant', todayRange: 'Aujourd’hui de {min} à {max}', gusts: 'Rafales {v}', todayMax: 'Max. aujourd’hui {v}',
    sunrise: 'Lever', sunset: 'Coucher', notAvailable: 'Non disponible ici.',
    pollenWhy: 'Les données polliniques couvrent uniquement l’Europe.', alertsWhy: 'La source météo ne fournit pas d’alertes.',
    pollenUnit: 'grains/m³', time: 'Heure', day: 'Jour', minMax: 'Min / max',
    todayHourly: 'Aujourd’hui, heure par heure',
    short: { temperature: 'Temp.', rain: 'Pluie', wind: 'Vent', humidity: 'Humid.', uv: 'UV' },
    uvLevel: ['Faible', 'Modéré', 'Élevé', 'Très élevé', 'Extrême'],
    pollenTypes: { alder: 'Aulne', birch: 'Bouleau', grass: 'Graminées', mugwort: 'Armoise', olive: 'Olivier', ragweed: 'Ambroisie' },
    compass: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'], from: 'du {dir}',
    wmo: { clear: 'Dégagé', mainlyClear: 'Plutôt dégagé', partly: 'Partiellement nuageux', overcast: 'Couvert', fog: 'Brouillard', drizzle: 'Bruine', rain: 'Pluie', freezing: 'Pluie verglaçante', snow: 'Neige', showers: 'Averses', snowShowers: 'Averses de neige', thunder: 'Orage' },
  },
  es: {
    appName: 'Solo el tiempo', language: 'Idioma', skip: 'Ir a los resultados',
    requestLabel: '¿Qué quieres ver?', requestPlaceholder: 'p. ej. lluvia y viento',
    pickFromList: 'O elige de la lista',
    cityLabel: '¿Dónde?', cityPlaceholder: 'Ciudad, p. ej. Lisboa', useLocation: 'Usar mi ubicación',
    gpsAsking: 'Pidiendo tu ubicación…', gpsOn: 'Usando tu ubicación actual.',
    gpsCityWins: 'Se usa la ciudad escrita (tiene prioridad sobre tu ubicación).',
    show: 'Ver el tiempo', loading: 'Cargando…', retry: 'Reintentar',
    dataBy: 'Datos meteorológicos de', camsCredit: 'Datos de polen generados con información del Copernicus Atmosphere Monitoring Service.',
    privacy: 'Sin rastreo. No se guarda nada.',
    fields: {
      temperature: 'Temperatura', rain: 'Probabilidad de lluvia', wind: 'Viento', uv: 'Índice UV', pollen: 'Polen',
      humidity: 'Humedad', sun: 'Amanecer y atardecer', hourly: 'Pronóstico por horas', daily: 'Pronóstico de 7 días', alerts: 'Alertas meteorológicas',
    },
    err: {
      unclear: "No lo he entendido. Prueba 'lluvia y viento' o elige de la lista.",
      noFields: "No hay nada seleccionado. Escribe p. ej. 'lluvia y viento' o elige de la lista.",
      noLocation: "Aún no hay lugar. Escribe una ciudad o toca 'Usar mi ubicación'.",
      offline: 'Sin conexión. Revisa tu internet y toca Reintentar.',
      timeout: 'El servicio meteorológico tardó demasiado. Toca Reintentar.',
      api: 'El servicio meteorológico devolvió un error. Toca Reintentar o prueba más tarde.',
      cityNotFound: 'No se encontró ningún lugar llamado «{city}». Revisa la ortografía o prueba una ciudad cercana más grande.',
      geoDenied: 'El acceso a la ubicación está bloqueado. Escribe una ciudad o permite la ubicación en el navegador.',
      geoUnavailable: 'No se pudo obtener tu ubicación. Escribe una ciudad.',
      geoUnsupported: 'Este navegador no puede compartir tu ubicación. Escribe una ciudad.',
    },
    yourLocation: 'Tu ubicación', asOf: 'Hora local {time}', showing: 'Mostrando: {list}',
    now: 'Ahora', todayRange: 'Hoy de {min} a {max}', gusts: 'Ráfagas {v}', todayMax: 'Máx. hoy {v}',
    sunrise: 'Amanecer', sunset: 'Atardecer', notAvailable: 'No disponible aquí.',
    pollenWhy: 'Los datos de polen solo cubren Europa.', alertsWhy: 'La fuente meteorológica no ofrece alertas.',
    pollenUnit: 'granos/m³', time: 'Hora', day: 'Día', minMax: 'Mín. / máx.',
    todayHourly: 'Hoy, hora a hora',
    short: { temperature: 'Temp.', rain: 'Lluvia', wind: 'Viento', humidity: 'Humedad', uv: 'UV' },
    uvLevel: ['Bajo', 'Moderado', 'Alto', 'Muy alto', 'Extremo'],
    pollenTypes: { alder: 'Aliso', birch: 'Abedul', grass: 'Gramíneas', mugwort: 'Artemisa', olive: 'Olivo', ragweed: 'Ambrosía' },
    compass: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'], from: 'del {dir}',
    wmo: { clear: 'Despejado', mainlyClear: 'Mayormente despejado', partly: 'Parcialmente nublado', overcast: 'Cubierto', fog: 'Niebla', drizzle: 'Llovizna', rain: 'Lluvia', freezing: 'Lluvia helada', snow: 'Nieve', showers: 'Chubascos', snowShowers: 'Chubascos de nieve', thunder: 'Tormenta' },
  },
};

const ERROR_KEYS = {
  offline: 'offline', timeout: 'timeout', api: 'api', 'city-not-found': 'cityNotFound',
  'geo-denied': 'geoDenied', 'geo-unavailable': 'geoUnavailable', 'geo-unsupported': 'geoUnsupported',
};
const RETRYABLE = new Set(['offline', 'timeout', 'api']);

// ---------------------------------------------------------------------------
// State (memory only)
// ---------------------------------------------------------------------------
const state = {
  lang: pickLanguage(),
  gps: null,          // { lat, lon } once the user granted it in this session
  fields: [],
  place: null,
  model: null,
};

function pickLanguage() {
  const supported = Object.keys(T);
  for (const l of navigator.languages ?? [navigator.language]) {
    const base = String(l).slice(0, 2).toLowerCase();
    if (supported.includes(base)) return base;
  }
  return 'en';
}

const t = (key) => key.split('.').reduce((o, k) => o?.[k], T[state.lang]) ?? key;
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

// ---------------------------------------------------------------------------
// Formatting — Intl does decimal separators, unit spacing and 12/24 h per locale.
// ---------------------------------------------------------------------------
const nf = (opts) => new Intl.NumberFormat(state.lang, opts);
const fmt = {
  temp: (v) => (v == null ? '–' : nf({ style: 'unit', unit: 'celsius', maximumFractionDigits: 1 }).format(v)),
  temp0: (v) => (v == null ? '–' : nf({ style: 'unit', unit: 'celsius', maximumFractionDigits: 0 }).format(v)), // tables: whole degrees
  pct: (v) => (v == null ? '–' : nf({ style: 'percent', maximumFractionDigits: 0 }).format(v / 100)),
  kmh: (v) => (v == null ? '–' : nf({ style: 'unit', unit: 'kilometer-per-hour', maximumFractionDigits: 0 }).format(v)),
  num: (v, d = 1) => (v == null ? '–' : nf({ maximumFractionDigits: d }).format(v)),
  // Open-Meteo returns local wall-clock times without offset ("2026-11-09T22:00").
  // Reading them as UTC and formatting in UTC prints exactly that wall-clock time,
  // whatever the phone's own time zone is.
  time: (iso) => new Intl.DateTimeFormat(state.lang, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(`${iso}Z`)),
  hour: (iso) => new Intl.DateTimeFormat(state.lang, { hour: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}Z`)),
  day: (date) => new Intl.DateTimeFormat(state.lang, { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00Z`)),
  list: (items) => new Intl.ListFormat(state.lang, { style: 'long', type: 'conjunction' }).format(items),
};

function uvLevel(v) {
  if (v == null) return '';
  const i = v < 3 ? 0 : v < 6 ? 1 : v < 8 ? 2 : v < 11 ? 3 : 4; // WHO UV index bands
  return t('uvLevel')[i];
}

function compass(deg) {
  return t('compass')[Math.round(deg / 45) % 8];
}

function weatherCode(code) {
  const map = [
    [[0], 'clear', '☀️'], [[1], 'mainlyClear', '🌤️'], [[2], 'partly', '⛅'], [[3], 'overcast', '☁️'],
    [[45, 48], 'fog', '🌫️'], [[51, 53, 55, 56, 57], 'drizzle', '🌦️'], [[61, 63, 65], 'rain', '🌧️'],
    [[66, 67], 'freezing', '🌧️'], [[71, 73, 75, 77], 'snow', '🌨️'], [[80, 81, 82], 'showers', '🌦️'],
    [[85, 86], 'snowShowers', '🌨️'], [[95, 96, 99], 'thunder', '⛈️'],
  ];
  const hit = map.find(([codes]) => codes.includes(code));
  return hit ? { label: t(`wmo.${hit[1]}`), icon: hit[2] } : { label: '', icon: '' };
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const els = {
  lang: $('lang'), form: $('ask'), request: $('request'), picker: $('picker'), checks: $('checkboxes'),
  city: $('city'), gps: $('gps'), gpsStatus: $('gps-status'), show: $('show'),
  message: $('message'), messageText: $('message-text'), retry: $('retry'), results: $('results'),
  cams: $('cams-credit'),
};

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

function applyStaticStrings() {
  document.documentElement.lang = state.lang;
  document.title = t('appName');
  els.lang.value = state.lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  // Rebuild checkboxes, keeping their checked state.
  const checked = new Set(selectedCheckboxes());
  els.checks.replaceChildren(...FIELDS.map((f) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', name: 'field', value: f, checked: checked.has(f) }),
    h('span', {}, t(`fields.${f}`)))));
  updateGpsStatus();
}

const selectedCheckboxes = () => [...els.checks.querySelectorAll('input:checked')].map((i) => i.value);
function setCheckboxes(fields) {
  els.checks.querySelectorAll('input').forEach((i) => { i.checked = fields.includes(i.value); });
}

function showMessage(text, { retry = false } = {}) {
  els.messageText.textContent = text;
  els.retry.hidden = !retry;
  els.message.hidden = false;
}
function clearMessage() { els.message.hidden = true; els.messageText.textContent = ''; }
function clearResults() { els.results.replaceChildren(); state.model = null; els.cams.hidden = true; }

function setBusy(busy) {
  els.show.disabled = busy;
  els.show.textContent = busy ? t('loading') : t('show');
  els.results.setAttribute('aria-busy', String(busy));
}

function updateGpsStatus() {
  let s = '';
  if (els.gps.dataset.asking === '1') s = t('gpsAsking');
  else if (state.gps) s = els.city.value.trim() ? t('gpsCityWins') : t('gpsOn');
  els.gpsStatus.textContent = s;
  els.gps.setAttribute('aria-pressed', String(Boolean(state.gps)));
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

/** Which fields? Typed text wins if present; otherwise the checkboxes. */
function readFields() {
  const text = els.request.value;
  if (text.trim()) {
    const r = parseRequest(text);
    if (!r.ok) return { error: 'unclear' };
    setCheckboxes(r.fields); // show the user exactly what was understood
    return { fields: r.fields };
  }
  const boxes = selectedCheckboxes();
  return boxes.length ? { fields: boxes } : { error: 'noFields' };
}

let lastRun = null;

async function run() {
  clearMessage();
  const { fields, error } = readFields();
  if (error) {
    clearResults();
    showMessage(t(`err.${error}`));
    els.picker.open = true;
    return;
  }

  setBusy(true);
  lastRun = run;
  try {
    const place = await resolveLocation({ city: els.city.value, gps: state.gps }, state.lang);
    if (!place) {
      clearResults();
      showMessage(t('err.noLocation'));
      els.city.focus();
      return;
    }
    const model = await fetchWeather(place, fields);
    Object.assign(state, { fields, place, model });
    render();
    updateGpsStatus();
  } catch (e) {
    clearResults();
    const code = e instanceof WeatherError ? e.code : 'api';
    if (!(e instanceof WeatherError)) console.error(e);
    const msg = fill(t(`err.${ERROR_KEYS[code] ?? 'api'}`), { city: e.detail ?? '' });
    showMessage(msg, { retry: RETRYABLE.has(code) });
    if (code === 'city-not-found') els.city.focus();
  } finally {
    setBusy(false);
  }
}

async function useGps() {
  clearMessage();
  els.gps.dataset.asking = '1';
  updateGpsStatus();
  try {
    state.gps = await getGpsPosition(); // the browser's permission prompt appears here, never earlier
  } catch (e) {
    state.gps = null;
    showMessage(t(`err.${ERROR_KEYS[e.code] ?? 'geoUnavailable'}`));
  } finally {
    delete els.gps.dataset.asking;
    updateGpsStatus();
  }
  if (state.gps && (els.request.value.trim() || selectedCheckboxes().length)) run();
}

// ---------------------------------------------------------------------------
// Rendering — only the selected fields, in a fixed order.
// ---------------------------------------------------------------------------
function render() {
  const { model: m, fields, place } = state;
  if (!m) return;
  const has = (f) => fields.includes(f);
  const cards = [];

  // Today, hour by hour: the default time range for metric fields.
  const strip = (key, format, max) => h('ol', { class: 'strip', tabindex: '0', 'aria-label': t('todayHourly') },
    m.todayHours.map((r) => h('li', {},
      h('span', { class: 't' }, fmt.hour(r.time)),
      h('span', { class: 'v' }, format(r[key])),
      max ? h('span', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.min(100, ((r[key] ?? 0) / max) * 100)}%` })) : null)));

  const card = (field, ...body) => h('article', { class: 'card', 'aria-labelledby': `h-${field}` },
    h('h3', { id: `h-${field}` }, t(`fields.${field}`)), ...body);
  const naCard = (field, why) => h('article', { class: 'card muted', 'aria-labelledby': `h-${field}` },
    h('h3', { id: `h-${field}` }, t(`fields.${field}`)),
    h('p', { class: 'na' }, t('notAvailable')), h('p', { class: 'sub' }, why));

  if (has('temperature')) {
    cards.push(card('temperature',
      h('p', { class: 'value' }, fmt.temp(m.current.temperature)),
      m.today.tMin != null ? h('p', { class: 'sub' }, fill(t('todayRange'), { min: fmt.temp(m.today.tMin), max: fmt.temp(m.today.tMax) })) : null,
      strip('temperature', fmt.temp)));
  }
  if (has('rain')) {
    cards.push(card('rain', h('p', { class: 'value' }, fmt.pct(m.current.rain)), strip('rain', fmt.pct, 100)));
  }
  if (has('wind')) {
    const dir = m.current.windDir;
    cards.push(card('wind',
      h('p', { class: 'value' }, fmt.kmh(m.current.windSpeed)),
      h('p', { class: 'sub' },
        dir != null ? h('span', { class: 'arrow', 'aria-hidden': 'true', style: `transform:rotate(${dir + 180}deg)` }, '↑') : null,
        dir != null ? ` ${fill(t('from'), { dir: compass(dir) })} · ` : '',
        fill(t('gusts'), { v: fmt.kmh(m.current.windGusts) })),
      strip('wind', fmt.kmh)));
  }
  if (has('uv')) {
    cards.push(card('uv',
      h('p', { class: 'value' }, fmt.num(m.current.uv), h('small', {}, uvLevel(m.current.uv))),
      h('p', { class: 'sub' }, fill(t('todayMax'), { v: `${fmt.num(m.today.uvMax)} (${uvLevel(m.today.uvMax)})` })),
      strip('uv', (v) => fmt.num(v), 11)));
  }
  if (has('pollen')) {
    if (m.pollen?.available) {
      els.cams.hidden = false;
      cards.push(card('pollen', h('ul', { class: 'pollen' }, POLLEN_TYPES.map((p) => h('li', {},
        h('span', {}, t(`pollenTypes.${p}`)),
        h('b', {}, m.pollen.values[p] == null ? '–' : `${fmt.num(m.pollen.values[p], 0)} ${t('pollenUnit')}`))))));
    } else {
      cards.push(naCard('pollen', t('pollenWhy')));
    }
  }
  if (has('humidity')) {
    cards.push(card('humidity', h('p', { class: 'value' }, fmt.pct(m.current.humidity)), strip('humidity', fmt.pct, 100)));
  }
  if (has('sun')) {
    cards.push(card('sun', h('div', { class: 'sun-row' },
      h('div', {}, h('span', { class: 'sub' }, t('sunrise')), h('p', { class: 'value' }, m.today.sunrise ? fmt.time(m.today.sunrise) : '–')),
      h('div', {}, h('span', { class: 'sub' }, t('sunset')), h('p', { class: 'value' }, m.today.sunset ? fmt.time(m.today.sunset) : '–')))));
  }

  const metrics = forecastMetrics(fields);
  const metricCell = {
    temperature: { hour: (r) => fmt.temp0(r.temperature), day: (d) => `${fmt.temp0(d.tMin)} / ${fmt.temp0(d.tMax)}` },
    rain: { hour: (r) => fmt.pct(r.rain), day: (d) => fmt.pct(d.rain) },
    wind: { hour: (r) => fmt.kmh(r.wind), day: (d) => fmt.kmh(d.wind) },
    humidity: { hour: (r) => fmt.pct(r.humidity), day: null },
    uv: { hour: (r) => fmt.num(r.uv, 0), day: (d) => fmt.num(d.uv, 0) },
  };
  // Short visible header, full name for screen readers (phones are narrow).
  const colHead = (k, extra = '') => h('th', { scope: 'col' },
    h('span', { 'aria-hidden': 'true' }, t(`short.${k}`)),
    h('span', { class: 'visually-hidden' }, t(`fields.${k}`) + extra));
  const condCell = (code) => {
    const w = weatherCode(code);
    return w.icon ? [h('span', { class: 'cond', 'aria-hidden': 'true' }, w.icon), h('span', { class: 'visually-hidden' }, `${w.label}, `)] : null;
  };

  if (has('hourly')) {
    cards.push(h('article', { class: 'card wide', 'aria-labelledby': 'h-hourly' },
      h('h3', { id: 'h-hourly' }, t('fields.hourly')),
      h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-labelledby': 'h-hourly' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('time')), metrics.map((k) => colHead(k)))),
        h('tbody', {}, m.next24.map((r) => h('tr', {},
          h('th', { scope: 'row' }, condCell(r.code), fmt.time(r.time)),
          metrics.map((k) => h('td', {}, metricCell[k].hour(r))))))))));
  }
  if (has('daily')) {
    const dayMetrics = metrics.filter((k) => metricCell[k].day);
    const cols = dayMetrics.length ? dayMetrics : ['temperature'];
    cards.push(h('article', { class: 'card wide', 'aria-labelledby': 'h-daily' },
      h('h3', { id: 'h-daily' }, t('fields.daily')),
      h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-labelledby': 'h-daily' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('day')),
          cols.map((k) => colHead(k, k === 'temperature' ? ` (${t('minMax')})` : '')))),
        h('tbody', {}, m.days.map((d) => h('tr', {},
          h('th', { scope: 'row' }, condCell(d.code), fmt.day(d.date)),
          cols.map((k) => h('td', {}, metricCell[k].day(d))))))))));
  }
  if (has('alerts')) cards.push(naCard('alerts', t('alertsWhy')));

  const placeName = place.label ?? t('yourLocation');
  els.results.replaceChildren(
    h('header', { class: 'place' },
      h('h2', {}, placeName),
      h('p', {}, fill(t('asOf'), { time: fmt.time(m.nowIso) })),
      h('p', {}, fill(t('showing'), { list: fmt.list(fields.map((f) => t(`fields.${f}`))) }))),
    h('div', { class: 'grid' }, cards));
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
els.form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
els.retry.addEventListener('click', () => (lastRun ?? run)());
els.gps.addEventListener('click', useGps);
els.city.addEventListener('input', updateGpsStatus);
// Ticking a box makes the list the source of truth, so clear the typed request.
els.checks.addEventListener('change', () => { els.request.value = ''; });
els.lang.addEventListener('change', () => {
  state.lang = els.lang.value;
  applyStaticStrings();
  if (!els.message.hidden) clearMessage(); // old message was in the old language
  render();
});

applyStaticStrings();

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

