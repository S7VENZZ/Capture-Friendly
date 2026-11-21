'use strict';

// The Discord display is tested against a stand-in for Discord on a pipe of our own: the real handshake and messages, nothing else.
const assert = require('node:assert/strict');
const net = require('net');
const { createPresence, encode, createReader, OP } = require('./presence');
const { RELEASES_URL, DISCORD_APP_ID } = require('./about');

const ID = '123456789012345678';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newPipe = () => `\\\\.\\pipe\\cf-unit-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
async function waitFor(cond, what, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(10);
  }
  assert.fail('timeout: ' + what);
}

/** A stand-in for Discord: answers the handshake with READY, answers every command, records everything. */
function fakeDiscord(pipe) {
  const d = { connections: 0, handshakes: [], commands: [], sockets: [], server: null, reply: null };
  d.server = net.createServer((s) => {
    d.connections++;
    d.sockets.push(s);
    const read = createReader((op, data) => {
      if (op === OP.HANDSHAKE) {
        d.handshakes.push(data);
        s.write(encode(OP.FRAME, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 } }));
      } else if (op === OP.FRAME) {
        d.commands.push(data);
        s.write(encode(OP.FRAME, d.reply ? d.reply(data) : { cmd: data.cmd, evt: null, data: {}, nonce: data.nonce }));
      } else if (op === OP.PONG) d.pong = data;
    });
    s.on('data', read);
    s.on('error', () => {});
  });
  d.listen = () => new Promise((r) => d.server.listen(pipe, r));
  d.close = () => new Promise((r) => { d.sockets.forEach((s) => s.destroy()); d.server.close(r); });
  d.activities = () => d.commands.map((c) => (c.args.activity ? 'show' : 'clear'));
  return d;
}

let n = 0;
async function test(name, fn) {
  const pipe = newPipe();
  const discord = fakeDiscord(pipe);
  const made = [];
  const make = (o = {}) => {
    const p = createPresence({ appId: ID, paths: () => [pipe], retryMs: 60, graceMs: 120, ...o });
    made.push(p);
    return p;
  };
  try {
    await fn({ pipe, discord, make });
  } finally {
    made.forEach((p) => p.close());
    await discord.close();
  }
  n++;
  console.log('ok  ' + name);
}

(async () => {
  await test('messages are cut into pieces and put together again', async () => {
    const got = [];
    const read = createReader((op, data) => got.push([op, data]));
    const a = encode(1, { a: 1 });
    const b = encode(3, { b: 'zwei' });
    const all = Buffer.concat([a, b]);
    for (let i = 0; i < all.length; i += 3) read(all.subarray(i, i + 3)); // three bytes at a time
    assert.deepEqual(got, [[1, { a: 1 }], [3, { b: 'zwei' }]]);
    const big = Buffer.alloc(8);
    big.writeInt32LE(1, 0);
    big.writeInt32LE(50 * 1024 * 1024, 4);
    assert.throws(() => createReader(() => {})(big), /too large/);
  });

  await test('the application of this program has a proper Discord id', async () => {
    assert.match(DISCORD_APP_ID, /^\d{17,20}$/);
  });

  await test('without a valid application id nothing is ever connected', async ({ discord, make }) => {
    await discord.listen();
    const p = make({ appId: '' });
    assert.equal(p.update({ enabled: true, running: true }).available, false);
    const q = make({ appId: 'abc' });
    assert.equal(q.update({ enabled: true, running: true }).available, false);
    await sleep(200);
    assert.equal(discord.connections, 0);
  });

  await test('switched off (the default) no connection is made at all', async ({ discord, make }) => {
    await discord.listen();
    const p = make();
    p.update({ enabled: false, running: true });
    p.update({ enabled: false, running: false });
    await sleep(200);
    assert.equal(discord.connections, 0);
  });

  await test('switched on, it says hello with the application id and shows nothing while no picture runs', async ({ discord, make }) => {
    await discord.listen();
    const p = make();
    p.update({ enabled: true, running: false });
    await waitFor(() => discord.commands.length >= 1, 'first command');
    assert.deepEqual(discord.handshakes, [{ v: 1, client_id: ID }]);
    assert.deepEqual(discord.activities(), ['clear']);
    assert.equal(p.status().connected, true);
  });

  await test('while the picture runs it shows exactly the fixed display: timer, logo, one button', async ({ discord, make }) => {
    await discord.listen();
    const p = make();
    const before = Math.floor(Date.now() / 1000);
    p.update({ enabled: true, running: true, details: 'something of my own', buttons: [{ label: 'x', url: 'https://example.com' }] }); // nothing but the two switches counts
    await waitFor(() => discord.activities().includes('show'), 'display');
    const cmd = discord.commands.find((c) => c.args.activity);
    assert.equal(cmd.cmd, 'SET_ACTIVITY');
    assert.equal(cmd.args.pid, process.pid);
    assert.deepEqual(Object.keys(cmd.args.activity).sort(), ['assets', 'buttons', 'timestamps']);
    assert.ok(Number.isInteger(cmd.args.activity.timestamps.start) && cmd.args.activity.timestamps.start >= before && cmd.args.activity.timestamps.start <= before + 5);
    assert.deepEqual(cmd.args.activity.assets, { large_image: 'https://raw.githubusercontent.com/S7VENZZ/capture-friendly/main/assets/logo.png?v=3', large_text: 'Capture Friendly' });
    assert.deepEqual(cmd.args.activity.buttons, [{ label: 'Get Capture Friendly', url: RELEASES_URL }]);
  });

  await test('when the picture stops the display is taken away after a moment', async ({ discord, make }) => {
    await discord.listen();
    const p = make();
    p.update({ enabled: true, running: true });
    await waitFor(() => discord.activities().includes('show'), 'display');
    p.update({ enabled: true, running: false });
    await waitFor(() => discord.activities().at(-1) === 'clear', 'removal');
  });

  await test('a short stop (the picture restarts after a setting) keeps the display and its timer', async ({ discord, make }) => {
    await discord.listen();
    const p = make({ graceMs: 400 });
    p.update({ enabled: true, running: true });
    await waitFor(() => discord.activities().includes('show'), 'display');
    const start = discord.commands.find((c) => c.args.activity).args.activity.timestamps.start;
    p.update({ enabled: true, running: false });
    await sleep(100);
    p.update({ enabled: true, running: true });
    await sleep(600);
    assert.deepEqual(discord.activities(), ['show'], 'nothing was removed and nothing shown twice');
    assert.equal(discord.commands[0].args.activity.timestamps.start, start);
  });

  await test('switching it off removes the display and closes the connection', async ({ discord, make }) => {
    await discord.listen();
    const p = make();
    p.update({ enabled: true, running: true });
    await waitFor(() => discord.activities().includes('show'), 'display');
    p.update({ enabled: false, running: true });
    await waitFor(() => discord.activities().at(-1) === 'clear', 'removal');
    await waitFor(() => discord.sockets[0].destroyed, 'closed connection');
    assert.equal(p.status().connected, false);
    const count = discord.connections;
    await sleep(250);
    assert.equal(discord.connections, count, 'no new connection while it is off');
  });

  await test('Discord is not running at first: it keeps looking and connects once Discord is there', async ({ discord, make }) => {
    const p = make();
    assert.equal(p.update({ enabled: true, running: true }).connected, false);
    await sleep(250);
    await discord.listen();
    await waitFor(() => discord.activities().includes('show'), 'display after Discord appeared', 4000);
    assert.equal(p.status().connected, true);
  });

  await test('Discord is restarted: the display comes back by itself, with the same timer', async ({ discord, make }) => {
    await discord.listen();
    const p = make();
    p.update({ enabled: true, running: true });
    await waitFor(() => discord.activities().includes('show'), 'display');
    const start = discord.commands[0].args.activity.timestamps.start;
    discord.sockets[0].destroy();
    await waitFor(() => discord.connections === 2 && discord.commands.filter((c) => c.args.activity).length === 2, 'second display', 4000);
    assert.equal(discord.commands.filter((c) => c.args.activity)[1].args.activity.timestamps.start, start);
  });

  await test('a ping from Discord is answered', async ({ discord, make }) => {
    await discord.listen();
    const p = make();
    p.update({ enabled: true, running: false });
    await waitFor(() => discord.sockets.length === 1 && p.status().connected, 'connected');
    discord.sockets[0].write(encode(OP.PING, { nonce: 'abc' }));
    await waitFor(() => discord.pong, 'pong');
    assert.deepEqual(discord.pong, { nonce: 'abc' });
  });

  await test('an error from Discord is passed on so the settings can say it', async ({ discord, make }) => {
    await discord.listen();
    discord.reply = (c) => ({ cmd: c.cmd, evt: 'ERROR', data: { code: 4000, message: 'Invalid activity' }, nonce: c.nonce });
    const p = make();
    p.update({ enabled: true, running: true });
    await waitFor(() => p.status().problem === 'Invalid activity', 'problem');
  });

  await test('closing the program removes the display too', async ({ discord, make }) => {
    await discord.listen();
    const p = make();
    p.update({ enabled: true, running: true });
    await waitFor(() => discord.activities().includes('show'), 'display');
    p.close();
    await waitFor(() => discord.activities().at(-1) === 'clear', 'removal');
  });

  console.log(`\nall presence tests passed (${n})`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
