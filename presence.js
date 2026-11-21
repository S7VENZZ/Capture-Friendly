'use strict';

/**
 * Discord "Rich Presence": tells the Discord program on this PC that Capture Friendly is in use (like a game), while the picture runs.
 *
 *  - Off by default. Only when the user switches it on is any connection made, and only to the Discord program on the same PC
 *    (a local pipe, nothing goes over the internet from here). Switched off, the connection is closed again.
 *  - What is sent is fixed (see activityFor): a timer, the logo, one button with the download link. The name shown is the one of
 *    the Discord application. Nothing about the picture, the card, the PC or the user, and the page cannot send any text of its own.
 *  - No account has to be linked: the Discord program on this PC is already logged in.
 */

const net = require('net');
const About = require('./about');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const MAX_FRAME = 1024 * 1024;

// Automated tests only: a pipe of our own instead of Discord's. Anything but \\.\pipe\cf-test-<name> is ignored.
const TEST_PIPE = /^\\\\\.\\pipe\\cf-test-[A-Za-z0-9-]{4,40}$/.test(process.env.CF_TEST_DISCORD_PIPE || '') ? process.env.CF_TEST_DISCORD_PIPE : '';
const TEST_APP_ID = TEST_PIPE && /^\d{17,20}$/.test(process.env.CF_TEST_DISCORD_APP_ID || '') ? process.env.CF_TEST_DISCORD_APP_ID : '';

/** Discord listens on \\.\pipe\discord-ipc-0 ... 9 (a second Discord, e.g. the test version, takes the next number). */
const discordPipes = () => (TEST_PIPE ? [TEST_PIPE] : Array.from({ length: 10 }, (_, i) => `\\\\.\\pipe\\discord-ipc-${i}`));

/** One message: 4 bytes type, 4 bytes length, then the JSON text. */
function encode(op, data) {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** Collects the pieces of a connection into whole messages: onMessage(op, data). Throws on a message that makes no sense. */
function createReader(onMessage) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8) {
      const len = buf.readInt32LE(4);
      if (len < 0 || len > MAX_FRAME) throw new Error('message too large');
      if (buf.length < 8 + len) return;
      const op = buf.readInt32LE(0);
      const text = buf.subarray(8, 8 + len).toString('utf8');
      buf = buf.subarray(8 + len);
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        /* not JSON: handed on as null */
      }
      onMessage(op, data);
    }
  };
}

/** What Discord shows. Fixed on purpose. */
function activityFor(startedAtMs) {
  return {
    timestamps: { start: Math.floor(startedAtMs / 1000) },
    assets: { large_image: About.LOGO_URL, large_text: About.APP_NAME },
    buttons: [{ label: 'Get Capture Friendly', url: About.RELEASES_URL }],
  };
}

/**
 * @param {{ appId?: string, paths?: () => string[], retryMs?: number, graceMs?: number, now?: () => number,
 *           onStatus?: (status: object) => void }} o
 */
function createPresence(o = {}) {
  const appId = String(o.appId !== undefined ? o.appId : TEST_APP_ID || About.DISCORD_APP_ID || ''); // given but empty or wrong: switched off
  const valid = /^\d{17,20}$/.test(appId);
  const paths = o.paths || discordPipes;
  const retryMs = o.retryMs || 15000; // Discord not running (yet): look again from time to time
  const graceMs = o.graceMs === undefined ? 5000 : o.graceMs; // a short stop (the picture restarts after a setting) keeps the timer
  const now = o.now || Date.now;
  const onStatus = o.onStatus || (() => {});

  let want = { enabled: false, running: false };
  let sock = null;
  let ready = false;
  let retryTimer = null;
  let clearTimer = null;
  let showing = false; // what Discord was last told
  let startedAt = 0;
  let nonce = 0;
  let problem = '';

  const status = () => ({ available: valid, enabled: want.enabled, connected: ready, ...(problem ? { problem } : {}) });
  const report = () => {
    const s = status();
    onStatus(s);
    return s;
  };

  function push() {
    if (!ready || !sock) return;
    const args = { pid: process.pid };
    if (showing) args.activity = activityFor(startedAt); // without "activity" Discord removes the display
    sock.write(encode(OP.FRAME, { cmd: 'SET_ACTIVITY', args, nonce: String(++nonce) }));
  }

  function decide() {
    const show = want.enabled && want.running;
    if (show) {
      clearTimeout(clearTimer);
      clearTimer = null;
      if (!showing) {
        showing = true;
        if (!startedAt) startedAt = now();
        push();
      }
    } else if (showing && !clearTimer) {
      // the picture stopped: wait a moment, it may come straight back (a setting restarts it) and then the timer goes on
      clearTimer = setTimeout(
        () => {
          clearTimer = null;
          if (want.enabled && want.running) return;
          showing = false;
          startedAt = 0;
          push();
        },
        want.enabled ? graceMs : 0
      );
    }
  }

  function handle(s, op, data) {
    if (op === OP.PING) return void s.write(encode(OP.PONG, data));
    if (op === OP.CLOSE) {
      problem = data && data.message ? String(data.message).slice(0, 120) : '';
      return void s.destroy();
    }
    if (op !== OP.FRAME || !data) return;
    if (data.evt === 'READY') {
      ready = true;
      problem = '';
      push();
      report();
    } else if (data.evt === 'ERROR') {
      problem = String((data.data && data.data.message) || 'abgelehnt').slice(0, 120);
      report();
    }
  }

  function schedule() {
    if (retryTimer || !want.enabled || !valid) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      tryConnect(0);
    }, retryMs);
    if (retryTimer.unref) retryTimer.unref();
  }

  function tryConnect(i) {
    if (!want.enabled || !valid || sock) return;
    const list = paths();
    if (i >= list.length) return schedule();
    const s = net.createConnection(list[i]);
    let opened = false;
    const read = createReader((op, data) => handle(s, op, data));
    s.once('connect', () => {
      opened = true;
      sock = s;
      s.write(encode(OP.HANDSHAKE, { v: 1, client_id: appId }));
    });
    s.on('data', (chunk) => {
      try {
        read(chunk);
      } catch {
        s.destroy();
      }
    });
    s.on('error', () => {
      if (!opened) tryConnect(i + 1); // not this pipe: the next one
      else s.destroy();
    });
    s.on('close', () => {
      if (!opened) return;
      if (sock === s) {
        sock = null;
        ready = false;
        showing = false; // a new connection starts from nothing
        report();
        if (want.enabled) {
          decide();
          schedule();
        }
      }
    });
  }

  function disconnect() {
    clearTimeout(retryTimer);
    retryTimer = null;
    clearTimeout(clearTimer);
    clearTimer = null;
    const s = sock;
    sock = null;
    ready = false;
    showing = false;
    startedAt = 0;
    if (s) {
      s.write(encode(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid }, nonce: String(++nonce) })); // take the display away first
      s.end();
    }
  }

  /** @param {{ enabled?: boolean, running?: boolean }} next only the two switches; nothing else can be passed */
  function update(next) {
    want = { enabled: Boolean(next && next.enabled === true), running: Boolean(next && next.running === true) };
    if (!valid) return report();
    if (!want.enabled) disconnect();
    else {
      decide();
      if (!sock && !retryTimer) tryConnect(0);
    }
    return report();
  }

  function close() {
    want = { enabled: false, running: false };
    disconnect();
  }

  return { update, close, status };
}

module.exports = { createPresence, encode, createReader, activityFor, OP };
