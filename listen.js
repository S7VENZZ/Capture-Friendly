'use strict';

/**
 * Is "Listen to this device" (Windows: Sound -> Recording -> the card -> Properties -> Listen) switched on for the card's sound input?
 * Then Windows plays the sound of the card by itself as well (and its hiss, even when this program is closed) and the program's own
 * playback comes on top: everything is heard twice. The program only READS this setting, from the registry (no administrator rights
 * needed, nothing is ever changed), so the window can say it.
 *
 * The registry keeps, for every sound input ("endpoint"), the values this looks at:
 *   {24dbb0fc-...},1  "Listen" switched on (a yes/no value: ... FFFF = yes)
 *   {a45c254e-...},2  the name of the connector, e.g. "HDMI"
 *   {b3f8fa53-...},6  the name of the device,    e.g. "UGREEN 25173"
 * and Windows names the endpoint "<connector> (<device>)", the name Chromium shows as "HDMI (UGREEN 25173) (3188:1000)".
 */

const { execFile } = require('child_process');

const KEY = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Capture';
const LISTEN = '{24dbb0fc-9311-4b3d-9cf0-18ff155639d4},1';
const CONNECTOR = '{a45c254e-df1c-4efd-8020-67d146a850e0},2';
const DEVICE = '{b3f8fa53-0004-438e-9003-51a46e139bfc},6';

// Automated tests only: the answer without asking Windows. Anything but 0 or 1 is ignored.
const TEST_ANSWER = /^[01]$/.test(process.env.CF_TEST_LISTENING || '') ? process.env.CF_TEST_LISTENING === '1' : null;

/** The output of `reg query ... /s`: the values of every key, [{ key, values: { name: { type, data } } }]. */
function parseReg(text) {
  const keys = [];
  let current = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (/^HKEY_/i.test(raw)) {
      current = { key: raw.trim(), values: {} };
      keys.push(current);
    } else if (current) {
      const m = /^\s+(\S+(?: \S+)*?)\s{2,}(REG_\w+)(?:\s{2,}(.*))?$/.exec(raw);
      if (m) current.values[m[1]] = { type: m[2], data: (m[3] || '').trim() };
    }
  }
  return keys;
}

/** The id of the endpoint a key belongs to ("{guid}"), or ''. */
const endpointOf = (key) => (/\\Capture\\(\{[0-9a-f-]{36}\})\\/i.exec(key) || [])[1] || '';

/** A yes/no value in the registry: 0B000000 01000000 FFFF0000 is "yes", ...00000000 is "no" (12 bytes, the value after the 8 bytes of the header). */
function isYes(data) {
  const hex = String(data || '').replace(/\s/g, '').toUpperCase();
  return hex.length === 24 && hex.startsWith('0B00000001000000') && hex.slice(16, 20) === 'FFFF';
}

/** The endpoints with "Listen" switched on, from the output of a query for the value {24dbb0fc-...},1. */
function listeningEndpoints(text) {
  const out = [];
  for (const k of parseReg(text)) {
    const v = k.values[LISTEN];
    const id = endpointOf(k.key);
    if (v && id && isYes(v.data) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** "HDMI (UGREEN 25173) (3188:1000)" -> "HDMI (UGREEN 25173)": without the USB id Chromium adds. */
const withoutUsbId = (label) => String(label || '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();

/** Windows' name of an endpoint from its two values. */
const friendlyName = (connector, device) => (connector && device ? `${connector} (${device})` : device || connector || '');

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/** Does the label of a sound input (as Chromium shows it) belong to one of these endpoints? @param {{[id: string]: string}} names endpoint id -> name */
function labelMatches(label, names) {
  const wanted = withoutUsbId(label);
  return wanted !== '' && Object.values(names).some((n) => n !== '' && same(n, wanted));
}

const reg = (args) =>
  new Promise((resolve) => {
    execFile('reg', ['query', ...args], { windowsHide: true, timeout: 6000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => resolve(err ? '' : stdout));
  });

/**
 * @param {string} label the label of the card's sound input as the page knows it
 * @returns {Promise<boolean>} true only when it is certain: Windows is playing this input as well. Any trouble reading: false (nothing is said).
 */
async function isListening(label) {
  if (TEST_ANSWER !== null) return TEST_ANSWER;
  if (process.platform !== 'win32' || typeof label !== 'string' || !label || label.length > 200) return false;
  try {
    const ids = listeningEndpoints(await reg([KEY, '/s', '/v', LISTEN]));
    if (!ids.length) return false;
    const names = {};
    for (const id of ids) {
      const text = await reg([`${KEY}\\${id}\\Properties`]);
      const v = (keys, name) => (keys[0] && keys[0].values[name] ? keys[0].values[name].data : '');
      const keys = parseReg(text);
      names[id] = friendlyName(v(keys, CONNECTOR), v(keys, DEVICE));
    }
    return labelMatches(label, names);
  } catch {
    return false;
  }
}

module.exports = { isListening, parseReg, listeningEndpoints, isYes, withoutUsbId, friendlyName, labelMatches };
