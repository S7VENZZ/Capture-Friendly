'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { LANGS, languages, pick, t, DEFAULT } = require('./i18n');

let n = 0;
function test(name, fn) {
  fn();
  n++;
  console.log('ok  ' + name);
}

const en = LANGS.en.words;
const keysOf = (words) => Object.keys(words).sort();
const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('English is the default and the first language', () => {
  assert.equal(DEFAULT, 'en');
  assert.equal(languages[0].code, 'en');
  assert.equal(pick(undefined), 'en');
  assert.equal(pick('klingon'), 'en');
  assert.equal(pick('__proto__'), 'en');
  assert.equal(pick('de'), 'de');
});

test('the languages are the nine that were chosen, each with its own name', () => {
  assert.deepEqual(languages.map((l) => l.code), ['en', 'de', 'es', 'fr', 'pt-BR', 'ru', 'zh-CN', 'ja', 'tr']);
  assert.equal(new Set(languages.map((l) => l.name)).size, languages.length);
  assert.ok(languages.every((l) => l.name.trim().length > 1));
});

for (const { code } of languages) {
  test(`${code}: every word of English is there, and nothing more`, () => {
    assert.deepEqual(keysOf(LANGS[code].words), keysOf(en));
  });
  test(`${code}: no empty text, the places that are filled in are the same as in English`, () => {
    for (const key of Object.keys(en)) {
      const text = LANGS[code].words[key];
      assert.ok(typeof text === 'string' && text.trim().length > 0, `${code} ${key} is empty`);
      assert.equal(placeholders(text), placeholders(en[key]), `${code} ${key}: {places} differ from English`);
    }
  });
}

test('the other languages are really translated (most texts differ from the English ones)', () => {
  for (const { code } of languages.slice(1)) {
    const same = Object.keys(en).filter((k) => LANGS[code].words[k] === en[k]);
    assert.ok(same.length <= 12, `${code} still has English in: ${same.join(', ')}`);
  }
});

test('words are filled in, and a missing word falls back to English, then to the key', () => {
  assert.equal(t('en', 'fps.std', { n: 60 }), '60 FPS (default)');
  assert.equal(t('de', 'fps.std', { n: 60 }), '60 FPS (Standard)');
  assert.equal(t('de', 'upd.new', { v: '1.2.0' }), '1.2.0 – neu');
  assert.equal(t('xx', 'panel.title'), 'Settings');
  assert.equal(t('en', 'does.not.exist'), 'does.not.exist');
  assert.equal(t('en', 'off.detected', {}), '{name} detected', 'an unknown place stays as it is');
  assert.equal(t('en', '__proto__'), '__proto__');
});

// every word that the page asks for exists
const html = fs.readFileSync(path.join(__dirname, 'capture.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, 'capture.js'), 'utf8');
const updater = fs.readFileSync(path.join(__dirname, 'updater.js'), 'utf8');

test('every word used in capture.html exists', () => {
  const used = [...html.matchAll(/data-i18n(?:-title|-aria)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(used.length > 40);
  for (const key of used) assert.ok(key in en, `capture.html asks for "${key}"`);
});

test('every word used in capture.js exists', () => {
  const asked = [...js.matchAll(/\bt\('([\w.]+)'/g)].map((m) => m[1]);
  const used = asked.filter((k) => !k.endsWith('.')); // "card.why." and "upd.err." are completed in the code (checked below)
  assert.ok(used.length > 25);
  for (const key of used) assert.ok(key in en, `capture.js asks for "${key}"`);
  for (const key of ['card.why.name', 'card.why.remembered', 'card.why.manual']) assert.ok(key in en, key);
  const keyed = [...js.matchAll(/\b(?:showOff|stop)\(\s*(?:[^'()]*\?\s*)?'(off\.[\w]+)'/g)].map((m) => m[1]);
  for (const key of [...js.matchAll(/'((?:off|modes|card\.why)\.[\w]+)'/g)].map((m) => m[1]).concat(keyed)) assert.ok(key in en, `capture.js names "${key}"`);
});

test('every error code of the updater has its words', () => {
  const codes = [...updater.matchAll(/fail\('(\w+)'/g)].map((m) => m[1]).concat([...updater.matchAll(/code: '(\w+)'/g)].map((m) => m[1]), ['other']);
  assert.ok(codes.length >= 8);
  for (const code of new Set(codes)) assert.ok(`upd.err.${code}` in en, `updater.js uses the code "${code}"`);
});

test('the window has no German text left of its own (everything goes through the words)', () => {
  const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const german = code.match(/'[^']*[äöüÄÖÜß][^']*'|`[^`]*[äöüÄÖÜß][^`]*`|"[^"]*[äöüÄÖÜß][^"]*"/g) || [];
  assert.deepEqual(german, []);
  const markup = html.replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!/[äöüÄÖÜß]/.test(markup), 'capture.html has German text of its own');
});

console.log(`\nall i18n tests passed (${n})`);
