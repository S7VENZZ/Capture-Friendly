'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { APP_NAME, GITHUB_REPO, RELEASES_URL, LATEST_API, DOWNLOAD_PREFIX, DONATE_URL, DISCORD_APP_ID, installerName, parseVersion, compareVersions, pickRelease } = require('./about');

function test(name, fn) {
  fn();
  console.log('ok  ' + name);
}

test('versions are read from tags with or without "v"', () => {
  assert.deepEqual(parseVersion('v2.0.19'), [2, 0, 19]);
  assert.deepEqual(parseVersion('2.0.19'), [2, 0, 19]);
  assert.equal(parseVersion('2.0'), null);
  assert.equal(parseVersion('latest'), null);
  assert.equal(parseVersion('2.0.19-beta'), null);
  assert.equal(parseVersion(undefined), null);
});

test('versions are compared as numbers (2.0.10 is newer than 2.0.9)', () => {
  assert.equal(compareVersions('v2.0.10', '2.0.9'), 1);
  assert.equal(compareVersions('2.0.9', '2.0.10'), -1);
  assert.equal(compareVersions('2.1.0', '2.0.99'), 1);
  assert.equal(compareVersions('3.0.0', '2.9.9'), 1);
  assert.equal(compareVersions('2.0.19', 'v2.0.19'), 0);
  assert.equal(compareVersions('x', '2.0.19'), null);
});

test('the newest version is looked up on GitHub and nowhere else', () => {
  assert.equal(new URL(LATEST_API).hostname, 'api.github.com');
  assert.equal(new URL(RELEASES_URL).hostname, 'github.com');
  assert.equal(new URL(DOWNLOAD_PREFIX).hostname, 'github.com');
  assert.ok(LATEST_API.includes(GITHUB_REPO) && RELEASES_URL.includes(GITHUB_REPO) && DOWNLOAD_PREFIX.includes(GITHUB_REPO));
  assert.match(GITHUB_REPO, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.equal(APP_NAME, 'Capture Friendly');
});

test('the only other link is the donation page', () => {
  assert.equal(new URL(DONATE_URL).protocol, 'https:');
  assert.equal(new URL(DONATE_URL).hostname, 'buymeacoffee.com');
});

const SHA = 'a'.repeat(64);
const release = (over = {}, asset = {}) => ({
  tag_name: 'v1.2.0',
  assets: [{ name: installerName('1.2.0'), size: 123456, digest: `sha256:${SHA}`, browser_download_url: `${DOWNLOAD_PREFIX}v1.2.0/${installerName('1.2.0')}`, ...asset }],
  ...over,
});

test('a newer release with a checkable installer can be installed', () => {
  const r = pickRelease(release(), '1.0.0');
  assert.equal(r.version, '1.2.0');
  assert.equal(r.newer, true);
  assert.deepEqual(r.asset, { name: 'Capture-Friendly-Setup-1.2.0.exe', url: `${DOWNLOAD_PREFIX}v1.2.0/Capture-Friendly-Setup-1.2.0.exe`, size: 123456, sha256: SHA });
});

test('the same or an older release is not an update', () => {
  assert.equal(pickRelease(release(), '1.2.0').newer, false);
  assert.equal(pickRelease(release(), '1.3.0').newer, false);
});

test('an installer without a SHA-256 from GitHub is never installed', () => {
  assert.equal(pickRelease(release({}, { digest: undefined }), '1.0.0').asset, null);
  assert.equal(pickRelease(release({}, { digest: 'md5:abc' }), '1.0.0').asset, null);
  assert.equal(pickRelease(release({}, { digest: `sha256:${SHA}zz` }), '1.0.0').asset, null);
});

test('an installer without a sensible size is never installed', () => {
  assert.equal(pickRelease(release({}, { size: 0 }), '1.0.0').asset, null);
  assert.equal(pickRelease(release({}, { size: -5 }), '1.0.0').asset, null);
  assert.equal(pickRelease(release({}, { size: 1.5 }), '1.0.0').asset, null);
  assert.equal(pickRelease(release({}, { size: 2 * 1024 * 1024 * 1024 }), '1.0.0').asset, null);
});

test('only a file stored in this project\'s releases is downloaded', () => {
  assert.equal(pickRelease(release({}, { browser_download_url: 'https://evil.example/Capture-Friendly-Setup-1.2.0.exe' }), '1.0.0').asset, null);
  assert.equal(pickRelease(release({}, { browser_download_url: 'https://github.com/someone/else/releases/download/v1.2.0/Capture-Friendly-Setup-1.2.0.exe' }), '1.0.0').asset, null);
  assert.equal(pickRelease(release({}, { browser_download_url: 'http://127.0.0.1:8080/x.exe' }), '1.0.0').asset, null, 'loopback only for the tests');
  assert.ok(pickRelease(release({}, { browser_download_url: 'http://127.0.0.1:8080/x.exe' }), '1.0.0', { allowLoopback: true }).asset);
});

test('only the installer with the exact name of that version counts', () => {
  assert.equal(pickRelease({ tag_name: 'v1.2.0', assets: [{ name: 'Capture-Friendly-Setup-9.9.9.exe', size: 5, digest: `sha256:${SHA}`, browser_download_url: `${DOWNLOAD_PREFIX}v1.2.0/x.exe` }] }, '1.0.0').asset, null);
  assert.equal(pickRelease({ tag_name: 'v1.2.0', assets: [] }, '1.0.0').asset, null);
  assert.equal(pickRelease({ tag_name: 'v1.2.0' }, '1.0.0').asset, null);
});

test('an answer that is not a release is no update', () => {
  assert.deepEqual(pickRelease(null, '1.0.0'), { version: '', newer: false, asset: null });
  assert.deepEqual(pickRelease({ tag_name: 'nightly' }, '1.0.0'), { version: '', newer: false, asset: null });
  assert.deepEqual(pickRelease({ message: 'Not Found' }, '1.0.0'), { version: '', newer: false, asset: null });
});

test('the program contains no address of any server of the author', () => {
  const dir = __dirname;
  const forbidden = [/s7venz\.cloud/i, /159\.195\./, /wss?:\/\//i, /signaling/i, /signal-server/i, /update-url/i, /turn:/i];
  for (const file of fs.readdirSync(dir).filter((f) => /\.(js|html|css)$/.test(f) && !f.endsWith('.test.js'))) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const re of forbidden) assert.ok(!re.test(text), `${file} must not match ${re}`);
  }
});

test('the page has no network access at all (content security policy)', () => {
  const html = fs.readFileSync(path.join(__dirname, 'capture.html'), 'utf8');
  const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /default-src 'none'/);
  assert.ok(!/connect-src/.test(csp), 'connect-src falls back to default-src none');
  assert.ok(!/(\*|https?:|wss?:)/.test(csp.replace(/mediastream:/, '')), 'no remote source of any kind');
});

test('the page gets only three small interfaces, update, Discord display and a read-only sound check (no node, no file access)', () => {
  const preload = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  assert.match(preload, /exposeInMainWorld\('cfUpdate'/);
  assert.match(preload, /exposeInMainWorld\('cfPresence'/);
  assert.match(preload, /exposeInMainWorld\('cfAudio'/);
  assert.deepEqual([...preload.matchAll(/ipcRenderer\.(invoke|on)\('([^']+)'/g)].map((m) => m[2]).sort(), ['audio:listening', 'presence:status', 'presence:update', 'update:check', 'update:install', 'update:status']);
  assert.ok(!/require\((?!'electron')/.test(preload), 'the preload requires nothing but electron');
});

test('the check whether Windows plays the card as well only reads the registry (nothing is ever changed)', () => {
  const text = fs.readFileSync(path.join(__dirname, 'listen.js'), 'utf8');
  assert.deepEqual([...text.matchAll(/execFile\('([^']+)', \['([^']+)'/g)].map((m) => `${m[1]} ${m[2]}`), ['reg query'], 'the only command is "reg query"');
  assert.ok(!/['"`](add|delete|import|export|copy|save|restore|load|unload|compare|flags)['"`]/i.test(text), 'no "reg" command that writes');
  assert.ok(!/powershell|cmd\.exe|(?<![.\w])(?:spawn|exec)\(/i.test(text), 'no shell (a bare spawn( or exec( call)');
});

console.log('\nall about tests passed');
