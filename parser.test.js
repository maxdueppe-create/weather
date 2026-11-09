// parser.test.js — run with `node --test` (Node 18+). No dependencies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest, FIELDS, editDistance, normalize } from './parser.js';

const ok = (input, expected) => {
  const r = parseRequest(input);
  assert.equal(r.ok, true, `"${input}" should parse, got ${JSON.stringify(r)}`);
  assert.deepEqual([...r.fields].sort(), [...expected].sort(), `"${input}"`);
};
const unclear = (input) => {
  const r = parseRequest(input);
  assert.equal(r.ok, false, `"${input}" should be rejected, got ${JSON.stringify(r)}`);
};

// ---- The spec's test cases (parser-related ones) ----
test('TC1 "only rain and temperature" → exactly those 2 fields', () => {
  ok('only rain and temperature', ['rain', 'temperature']);
});
test('TC2 "everything except pollen" → all fields except pollen', () => {
  ok('everything except pollen', FIELDS.filter((f) => f !== 'pollen'));
  assert.equal(parseRequest('everything except pollen').fields.length, 9);
});
test('TC3 "should I bring a jacket?" → error, nothing guessed', () => {
  unclear('should I bring a jacket?');
});
test('TC4 "nice day?" → error', () => unclear('nice day?'));
test('TC5 "stock prices" → error', () => unclear('stock prices'));
test('TC8 "nur Regen und Wind" → rain + wind', () => ok('nur Regen und Wind', ['rain', 'wind']));
test('TC9 "rian and temp" → rain + temperature', () => ok('rian and temp', ['rain', 'temperature']));
test('TC10 (parser half) "UV and pollen" → uv + pollen', () => ok('UV and pollen', ['uv', 'pollen']));

// ---- Languages ----
test('German', () => {
  ok('alles außer Pollen', FIELDS.filter((f) => f !== 'pollen'));
  ok('Temperatur, Luftfeuchtigkeit', ['temperature', 'humidity']);
  ok('Sonnenaufgang und UV-Index', ['sun', 'uv']);
  ok('7-Tage-Vorhersage', ['daily']);
  ok('stündlich Regen', ['hourly', 'rain']);
});
test('French', () => {
  ok('seulement la pluie et le vent', ['rain', 'wind']);
  ok('tout sauf le pollen', FIELDS.filter((f) => f !== 'pollen'));
  ok('humidité et lever du soleil', ['humidity', 'sun']);
  ok('prévisions sur 7 jours', ['daily']);
});
test('Spanish', () => {
  ok('solo lluvia y viento', ['rain', 'wind']);
  ok('todo excepto polen', FIELDS.filter((f) => f !== 'pollen'));
  ok('índice UV y humedad', ['uv', 'humidity']);
  ok('pronóstico de 7 días', ['daily']);
});

// ---- Tolerance: abbreviations, typos, punctuation ----
test('abbreviations and typos', () => {
  ok('temp', ['temperature']);
  ok('Regen', ['rain']);
  ok('temprature', ['temperature']);
  ok('humidty', ['humidity']);
  ok('wnid', ['wind']);
  ok('RAIN!!!', ['rain']);
  ok('rain/wind', ['rain', 'wind']);
  ok('sunrise/sunset', ['sun']);
});
test('multiple exclusions', () => {
  ok('everything except pollen and alerts', FIELDS.filter((f) => f !== 'pollen' && f !== 'alerts'));
  ok('all but uv', FIELDS.filter((f) => f !== 'uv'));
});

// ---- Strictness: never guess ----
test('vague or partial requests are rejected', () => {
  unclear('');
  unclear('   ');
  unclear('weather');
  unclear('forecast');              // hourly or 7-day?
  unclear('sun');                   // sunrise/sunset or UV?
  unclear('is it cold');
  unclear('rain and stock prices'); // one unknown word rejects the whole request
  unclear('no pollen');             // only an exclusion, nothing to show
  unclear('everything except everything');
});
test('short words get no typo tolerance', () => {
  unclear('uf');  // not "uv"
  unclear('day');
});

// ---- Helpers ----
test('editDistance counts a transposition as 1', () => {
  assert.equal(editDistance('rian', 'rain'), 1);
  assert.equal(editDistance('kitten', 'sitting'), 3);
});
test('normalize strips accents, ß and punctuation', () => {
  assert.equal(normalize('Außer Ümläut-Test!'), 'ausser umlaut test');
  assert.equal(normalize('Índice  UV'), 'indice uv');
});

test('real words are not "corrected" into fields', () => {
  for (const w of ['train', 'brain', 'pain', 'gain', 'wine', 'wild', 'wink', 'wand', 'vend',
    'venta', 'tempo', 'weak', 'regal', 'tomorrow', 'umbrella', 'coffee']) {
    unclear(w);
  }
});
test('typo rules: swaps and missing letters ok in short words, first letter must match', () => {
  ok('wnid', ['wind']);
  ok('rainn', ['rain']);
  ok('temperatrue', ['temperature']);
  ok('luftfeuchtigkiet', ['humidity']);
  unclear('tain'); // substituted letter in a short word
  unclear('emp');  // too short
});
