'use strict';

/**
 * Updates the program from its own GitHub releases, on a click ("Aktualisieren"):
 * ask GitHub for the newest release, download its installer, check it, run it silently, restart.
 *
 * What keeps this narrow:
 *  - the repository is fixed (about.js); the page cannot pass an address or a file name
 *  - HTTPS only, and the download has to end up on github.com / githubusercontent.com (also after redirects)
 *  - the installer is only started when its size and its SHA-256 are exactly what GitHub reports for that file
 *  - nothing is installed unless a check found a newer version first
 */

const { app, net } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const About = require('./about');

// Automated tests only: a local server instead of GitHub. Anything but http://127.0.0.1:<port>/ is ignored.
const TEST_API = /^http:\/\/127\.0\.0\.1:\d{2,5}\//.test(process.env.CF_TEST_UPDATE_API || '') ? process.env.CF_TEST_UPDATE_API : '';

/** An error the page can put into words of its own (it gets the code, not a text): see "upd.err.*" in i18n.js. */
const fail = (code, status) => Object.assign(new Error(code), { code, status });

const githubHost = (host) => host === 'github.com' || host.endsWith('.github.com') || host.endsWith('.githubusercontent.com');
const allowedUrl = (url) => (url.protocol === 'https:' && githubHost(url.hostname)) || (Boolean(TEST_API) && url.protocol === 'http:' && url.hostname === '127.0.0.1');

/** The installer of an earlier update stays in the temp folder (it ran from there). It is removed at the next start; what is still in use is left for the start after. */
function cleanupOldDownloads() {
  let names = [];
  try {
    names = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('capture-friendly-update-'));
  } catch {
    return;
  }
  for (const name of names) {
    try {
      fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    } catch {
      /* still in use */
    }
  }
}

/** @param {(status: object) => void} send tells the page how it goes */
function createUpdater(send) {
  let status = { state: 'idle', current: app.getVersion() };
  let found = null; // the newer release found by the last check: { version, asset }
  let busy = false;

  const set = (patch) => {
    status = { current: app.getVersion(), ...patch };
    send(status);
    return status;
  };

  async function check() {
    if (busy) return status;
    busy = true;
    found = null;
    set({ state: 'checking' });
    try {
      const res = await net.fetch(TEST_API || About.LATEST_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (res.status === 404) return set({ state: 'current', latest: '' }); // nothing published yet
      if (!res.ok) throw fail('unreachable', res.status);
      const picked = About.pickRelease(await res.json(), app.getVersion(), { allowLoopback: Boolean(TEST_API) });
      if (!picked.version) return set({ state: 'current', latest: '' });
      if (!picked.newer) return set({ state: 'current', latest: picked.version });
      if (picked.asset) found = { version: picked.version, asset: picked.asset };
      return set({ state: 'available', latest: picked.version, installable: Boolean(picked.asset) });
    } catch {
      return set({ state: 'error', code: 'unreachable' });
    } finally {
      busy = false;
    }
  }

  /** Opens the download. Every redirect is looked at before it is followed: it has to stay on GitHub. */
  function open(url) {
    return new Promise((resolve, reject) => {
      if (!allowedUrl(new URL(url))) return reject(fail('notGithub'));
      const request = net.request({ url, redirect: 'manual' });
      let hops = 0;
      request.on('redirect', (_status, _method, redirectUrl) => {
        let next = null;
        try {
          next = new URL(redirectUrl);
        } catch {
          /* not an address */
        }
        if (!next || !allowedUrl(next) || ++hops > 5) {
          request.abort();
          return reject(fail('notGithub'));
        }
        request.followRedirect();
      });
      request.on('response', (response) => resolve({ request, response }));
      request.on('error', reject);
      request.end();
    });
  }

  async function download(version, asset, file) {
    const { request, response } = await open(asset.url);
    if (response.statusCode !== 200) {
      request.abort();
      throw fail('http', response.statusCode);
    }
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(file);
    let done = 0;
    let lastSent = 0;
    try {
      await new Promise((resolve, reject) => {
        response.on('data', (chunk) => {
          done += chunk.length;
          if (done > asset.size) {
            request.abort();
            return reject(fail('tooLarge'));
          }
          hash.update(chunk);
          out.write(chunk);
          const now = Date.now();
          if (now - lastSent > 200) {
            lastSent = now;
            set({ state: 'downloading', latest: version, percent: Math.floor((done / asset.size) * 100) });
          }
        });
        response.on('end', resolve);
        response.on('error', reject);
        response.on('aborted', () => reject(fail('interrupted')));
      });
    } finally {
      await new Promise((resolve) => out.end(resolve));
    }
    if (done !== asset.size) throw fail('incomplete');
    if (hash.digest('hex') !== asset.sha256) throw fail('checksum');
  }

  async function install() {
    if (busy || !found) return status;
    if (!app.isPackaged && !TEST_API) return set({ state: 'error', latest: found.version, installable: true, code: 'devOnly' });
    busy = true;
    const { version, asset } = found;
    let dir = '';
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-friendly-update-'));
      const file = path.join(dir, asset.name);
      set({ state: 'downloading', latest: version, percent: 0 });
      await download(version, asset, file);
      set({ state: 'installing', latest: version });
      // the same arguments electron-updater uses: silent, mark as update, start the program again afterwards
      spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      setTimeout(() => app.quit(), 800);
    } catch (err) {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
      busy = false;
      set({ state: 'error', latest: version, installable: true, code: (err && err.code) || 'other', status: err && err.status });
    }
    return status;
  }

  return { check, install };
}

module.exports = { createUpdater, cleanupOldDownloads };
