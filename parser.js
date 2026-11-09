// parser.js — turns a free-text request ("only rain and wind", "nur Regen und Wind",
// "everything except pollen") into a list of field ids.
//
// Deterministic by design: a per-language dictionary plus a tiny typo matcher.
// Core rule: every meaningful word must be understood. If any word is unknown,
// vague or could mean two different fields, the whole request is rejected —
// we never guess, because guessing would show fields nobody asked for.

export const FIELDS = [
  'temperature', 'rain', 'wind', 'uv', 'pollen',
  'humidity', 'sun', 'hourly', 'daily', 'alerts',
];

// Synonyms are written already normalized (lowercase, no accents, ß → ss).
// Multi-word entries are matched as phrases before single words.
const SYNONYMS = {
  temperature: [
    // en
    'temperature', 'temperatures', 'temp', 'temperatur', 'temperaturen', 'temperatura', 'temperaturas',
    'degrees', 'grad', 'degres', 'grados',
  ],
  rain: [
    'rain', 'rain chance', 'chance of rain', 'chance rain', 'rain probability', 'probability of rain',
    'precipitation', 'precip', 'showers', 'shower', 'raining',
    // de
    'regen', 'regenwahrscheinlichkeit', 'regenrisiko', 'niederschlag', 'niederschlage',
    'niederschlagswahrscheinlichkeit', 'schauer',
    // fr
    'pluie', 'pluies', 'precipitations', 'averse', 'averses', 'risque de pluie',
    'probabilite de pluie', 'chance de pluie', 'chances de pluie',
    // es
    'lluvia', 'lluvias', 'precipitacion', 'precipitaciones', 'chubascos',
    'probabilidad de lluvia', 'posibilidad de lluvia',
  ],
  wind: [
    'wind', 'winds', 'wind speed', 'gusts', 'gust', 'windy',
    'windgeschwindigkeit', 'boen', 'windig',
    'vent', 'vents', 'rafales', 'vitesse du vent',
    'viento', 'vientos', 'rafagas', 'velocidad del viento',
  ],
  uv: [
    'uv', 'uv index', 'uvi', 'uvindex', 'ultraviolet',
    'uv wert', 'uv strahlung',
    'indice uv', 'rayons uv',
    'radiacion uv', 'indice de uv',
  ],
  pollen: [
    'pollen', 'pollens', 'pollen count', 'pollenflug', 'pollenbelastung', 'polen',
  ],
  humidity: [
    'humidity', 'humid', 'relative humidity',
    'luftfeuchtigkeit', 'feuchtigkeit', 'luftfeuchte',
    'humidite', 'humedad',
  ],
  sun: [
    'sunrise', 'sunset', 'sunrise sunset', 'sun times',
    'sonnenaufgang', 'sonnenuntergang', 'sonnenzeiten',
    'lever du soleil', 'coucher du soleil', 'lever et coucher du soleil',
    'amanecer', 'atardecer', 'salida del sol', 'puesta del sol', 'anochecer',
  ],
  hourly: [
    'hourly', 'hourly forecast', 'hour by hour', 'hours', 'per hour',
    'stundlich', 'stundenweise', 'stunden', 'stundliche vorhersage',
    'horaire', 'heure par heure', 'par heure', 'heures', 'previsions horaires',
    'por hora', 'por horas', 'horas', 'pronostico por horas', 'hora a hora',
  ],
  daily: [
    '7 day', '7 days', '7day', 'seven day', 'seven days', '7 day forecast', 'week', 'weekly', 'daily',
    'the week', 'next week',
    '7 tage', '7 tagen', 'woche', 'wochenvorhersage', 'sieben tage', 'taglich', '7 tage vorhersage',
    '7 jours', 'sept jours', 'semaine', 'la semaine',
    '7 dias', 'siete dias', 'semana', 'semanal', 'la semana',
  ],
  alerts: [
    'alerts', 'alert', 'warnings', 'warning', 'weather alerts', 'weather warnings', 'severe weather',
    'warnungen', 'warnung', 'unwetterwarnung', 'unwetterwarnungen', 'wetterwarnung', 'wetterwarnungen', 'unwetter',
    'alertes', 'alerte', 'vigilance', 'alertes meteo', 'avertissements',
    'alertas', 'alerta', 'avisos', 'aviso', 'alertas meteorologicas',
  ],
};

// Filler words that carry no field meaning. Exact match only — we never
// typo-correct into a filler word, so they can't swallow real typos.
const STOPWORDS = new Set([
  // en
  'only', 'just', 'and', 'show', 'me', 'the', 'a', 'an', 'please', 'with', 'plus', 'also', 'of', 'for',
  'on', 'over', 'next', 'in', 'today', 'now', 'current', 'currently', 'give', 'want', 'i', 'to', 'see', 'display', 'info', 'data', 'level', 'levels', 'index',
  // de
  'nur', 'und', 'zeig', 'zeige', 'mir', 'bitte', 'die', 'der', 'das', 'den', 'mit', 'auch', 'fur', 'uber', 'heute', 'jetzt', 'aktuell', 'aktuelle', 'ich', 'mochte', 'will',
  // fr
  'seulement', 'juste', 'uniquement', 'que', 'et', 'le', 'la', 'les', 'du', 'de', 'des', 'moi', 'montre', 'montrez', 'svp', 'avec', 'aussi', 'sur', 'pour', 'aujourd', 'hui', 'maintenant', 'actuel', 'actuelle', 'je', 'veux',
  // es
  'solo', 'solamente', 'unicamente', 'y', 'e', 'el', 'los', 'las', 'del', 'muestra', 'muestrame', 'por', 'favor', 'con', 'tambien', 'en', 'para', 'hoy', 'ahora', 'actual', 'quiero', 'ver',
]);

// "everything" words switch to "all fields, minus exclusions" mode.
const ALL_WORDS = new Set([
  'everything', 'all', 'every', 'anything',
  'alles', 'allem', 'alle',
  'tout', 'tous', 'toutes',
  'todo', 'toda', 'todos', 'todas',
]);

// After one of these, field words are exclusions.
const EXCEPT_WORDS = new Set([
  'except', 'excluding', 'but', 'without', 'not', 'no', 'minus',
  'ausser', 'ohne', 'nicht', 'kein', 'keine', 'keinen',
  'sauf', 'sans', 'excepte', 'pas', 'hormis',
  'excepto', 'menos', 'salvo', 'sin', 'ni',
]);

// "forecast" is fine next to "hourly" / "7-day", but alone it doesn't say which.
const FORECAST_WORDS = new Set(['forecast', 'forecasts', 'vorhersage', 'prognose', 'prevision', 'previsions', 'pronostico', 'prediccion']);

// Words that point at weather in general but not at ONE field — always unclear.
const VAGUE_WORDS = new Set([
  'weather', 'wetter', 'meteo', 'temps', 'tiempo', 'clima', 'climat',
  'sun', 'sunny', 'sonne', 'sonnig', 'soleil', 'sol', 'soleado',
  'forecasting',
]);

export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Optimal-string-alignment distance: Levenshtein plus adjacent transpositions,
// so "rian" → "rain" costs 1 (plain Levenshtein would say 2).
// `subCost` lets callers make substitutions expensive (see fuzzyField).
export function editDistance(a, b, subCost = 1) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : subCost;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

// How many typos a word may contain, by length.
//  < 4 letters: none ("uv", "sol", "day" are too easy to confuse).
//  4–6 letters: one swap / missing / extra letter, but NOT a substituted letter —
//    in short words a substitution usually produces a different real word
//    ("wine" vs "wind", "pain" vs "rain").
//  7+ letters: two edits of any kind.
function typoRule(len) {
  if (len < 4) return { budget: 0, subCost: 1 };
  if (len <= 6) return { budget: 1, subCost: 2 };
  return { budget: 2, subCost: 1 };
}

// Real words in our four languages that sit one edit away from a synonym.
// They must never be "corrected" into a field.
const NOT_TYPOS = new Set([
  'tempo', 'tempe', 'venta', 'ventas', 'ventre', 'vente', 'wines', 'pollo', 'hora',
  'regel', 'regal', 'regeln', 'luft', 'humo',
]);

// Build lookup tables once.
const PHRASES = []; // { words: [...], field }
const WORD_TO_FIELD = new Map();
for (const [field, list] of Object.entries(SYNONYMS)) {
  for (const syn of list) {
    const words = syn.split(' ');
    if (words.length > 1) PHRASES.push({ words, field });
    else WORD_TO_FIELD.set(syn, field);
  }
}
PHRASES.sort((a, b) => b.words.length - a.words.length);
const SINGLE_WORDS = [...WORD_TO_FIELD.entries()];

function fuzzyField(token) {
  const { budget, subCost } = typoRule(token.length);
  if (budget === 0 || NOT_TYPOS.has(token)) return { kind: 'unknown' };
  let best = Infinity;
  const fieldsAtBest = new Set();
  for (const [word, field] of SINGLE_WORDS) {
    if (Math.abs(word.length - token.length) > budget) continue;
    if (word[0] !== token[0]) continue; // people rarely mistype the first letter
    const dist = editDistance(token, word, subCost);
    if (dist > budget) continue;
    if (dist < best) { best = dist; fieldsAtBest.clear(); }
    if (dist === best) fieldsAtBest.add(field);
  }
  if (fieldsAtBest.size === 1) return { kind: 'field', field: [...fieldsAtBest][0], fuzzy: true };
  if (fieldsAtBest.size > 1) return { kind: 'ambiguous', candidates: [...fieldsAtBest] };
  return { kind: 'unknown' };
}

function classify(token) {
  if (WORD_TO_FIELD.has(token)) return { kind: 'field', field: WORD_TO_FIELD.get(token) };
  if (STOPWORDS.has(token)) return { kind: 'stop' };
  if (ALL_WORDS.has(token)) return { kind: 'all' };
  if (EXCEPT_WORDS.has(token)) return { kind: 'except' };
  if (FORECAST_WORDS.has(token)) return { kind: 'forecast' };
  if (VAGUE_WORDS.has(token)) return { kind: 'vague' };
  return fuzzyField(token);
}

/**
 * @returns {{ok: true, fields: string[]} | {ok: false, reason: 'empty'|'unclear', problems: string[]}}
 */
export function parseRequest(text) {
  const tokens = normalize(text).split(' ').filter(Boolean);
  if (tokens.length === 0) return { ok: false, reason: 'empty', problems: [] };

  const include = new Set();
  const exclude = new Set();
  const problems = [];
  let allMode = false;
  let excluding = false;
  let sawForecastWord = false;

  const addField = (field) => (excluding ? exclude : include).add(field);

  for (let i = 0; i < tokens.length; ) {
    // 1. Longest phrase match first ("chance of rain", "lever du soleil").
    const phrase = PHRASES.find((p) => p.words.every((w, k) => tokens[i + k] === w));
    if (phrase) {
      addField(phrase.field);
      i += phrase.words.length;
      continue;
    }
    // 2. Single word.
    const token = tokens[i];
    const c = classify(token);
    switch (c.kind) {
      case 'field': addField(c.field); break;
      case 'stop': break;
      case 'all':
        if (excluding) problems.push(token); // "everything except everything"
        else allMode = true;
        break;
      case 'except': excluding = true; break;
      case 'forecast': sawForecastWord = true; break;
      default: problems.push(token); // unknown, vague, ambiguous
    }
    i += 1;
  }

  if (problems.length) return { ok: false, reason: 'unclear', problems };

  let fields;
  if (allMode) fields = FIELDS.filter((f) => !exclude.has(f));
  else fields = FIELDS.filter((f) => include.has(f) && !exclude.has(f));

  // "forecast" alone doesn't say hourly or 7-day.
  if (sawForecastWord && !fields.includes('hourly') && !fields.includes('daily')) {
    return { ok: false, reason: 'unclear', problems: ['forecast'] };
  }
  if (fields.length === 0) return { ok: false, reason: 'unclear', problems: [] };
  return { ok: true, fields };
}
