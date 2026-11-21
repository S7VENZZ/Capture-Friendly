'use strict';

/**
 * Names, links and version rules of "Capture Friendly". The one place that names the repository and the links:
 * the window (main.js), the updater (updater.js) and the page (capture.js) all read them from here.
 *
 * Where the program looks for newer versions: GitHub, and only GitHub (the public releases of this project).
 * Nothing else is contacted for this – no server of the author, no account, no identifier is sent.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CfAbout = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const APP_NAME = 'Capture Friendly';
  const GITHUB_REPO = 'S7VENZZ/capture-friendly';
  const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;
  const LATEST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const DOWNLOAD_PREFIX = `https://github.com/${GITHUB_REPO}/releases/download/`;
  const DONATE_URL = 'https://buymeacoffee.com/s7venz';
  const DISCORD_APP_ID = '1572063033973280869'; // the Discord application of this program (a public identifier, not a secret)
  const LOGO_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/assets/logo.png?v=3`; // the picture Discord shows (Discord loads it itself, not this program); Discord keeps pictures by address, so raise the number when the logo changes
  const installerName = (version) => `Capture-Friendly-Setup-${version}.exe`;

  /** "v2.0.19" or "2.0.19" -> [2, 0, 19]; anything else -> null */
  function parseVersion(text) {
    const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(text || '').trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  }

  /** 1 if a is newer than b, -1 if older, 0 if equal, null if one of them is not a version */
  function compareVersions(a, b) {
    const x = parseVersion(a);
    const y = parseVersion(b);
    if (!x || !y) return null;
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
    return 0;
  }

  /**
   * What the answer of GitHub for "latest release" means for the running version.
   * The installer only counts when GitHub names its size and SHA-256 and it is stored in this project's releases
   * (the updater checks the file against both before it starts it). `allowLoopback` is for the automated tests only.
   * @returns {{version:string, newer:boolean, asset:null|{name:string,url:string,size:number,sha256:string}}}
   */
  function pickRelease(release, currentVersion, { allowLoopback = false } = {}) {
    const tag = String((release && release.tag_name) || '');
    if (!parseVersion(tag)) return { version: '', newer: false, asset: null };
    const version = tag.replace(/^v/, '');
    const newer = compareVersions(version, currentVersion) === 1;
    const wanted = installerName(version);
    const a = release && Array.isArray(release.assets) ? release.assets.find((x) => x && x.name === wanted) : null;
    const url = a && typeof a.browser_download_url === 'string' ? a.browser_download_url : '';
    const urlOk = url.startsWith(DOWNLOAD_PREFIX) || (allowLoopback && /^http:\/\/127\.0\.0\.1:\d{2,5}\//.test(url));
    const digest = a ? /^sha256:([0-9a-f]{64})$/i.exec(String(a.digest || '')) : null;
    const sizeOk = a && Number.isSafeInteger(a.size) && a.size > 0 && a.size < 1024 * 1024 * 1024;
    return { version, newer, asset: urlOk && digest && sizeOk ? { name: wanted, url, size: a.size, sha256: digest[1].toLowerCase() } : null };
  }

  return { APP_NAME, GITHUB_REPO, RELEASES_URL, LATEST_API, DOWNLOAD_PREFIX, DONATE_URL, DISCORD_APP_ID, LOGO_URL, installerName, parseVersion, compareVersions, pickRelease };
});
