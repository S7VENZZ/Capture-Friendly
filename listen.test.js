'use strict';

const assert = require('assert');
const { parseReg, listeningEndpoints, isYes, withoutUsbId, friendlyName, labelMatches, isListening } = require('./listen');

let failed = 0;
const running = [];
function test(name, fn) {
  running.push(
    (async () => {
      try {
        await fn();
        console.log('ok  ' + name);
      } catch (err) {
        failed++;
        console.error('FAIL  ' + name + '\n  ' + (err && err.message));
      }
    })()
  );
}

const BASE = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Capture';
const LISTEN = '{24dbb0fc-9311-4b3d-9cf0-18ff155639d4},1';

// what `reg query ... /s /v {24dbb0fc-...},1` prints (one card with "Listen" on, one microphone with it off), as Windows prints it
const QUERY = [
  '',
  `${BASE}\\{8b924214-53f1-426d-850a-3c0c22902c37}\\Properties`,
  `    ${LISTEN}    REG_BINARY    0B00000001000000FFFF0000`,
  '',
  `${BASE}\\{11111111-2222-3333-4444-555555555555}\\Properties`,
  `    ${LISTEN}    REG_BINARY    0B0000000100000000000000`,
  '',
  'End of search: 2 match(es) found.',
  '',
].join('\r\n');

// what `reg query <endpoint>\Properties` prints for the card
const PROPERTIES = [
  '',
  `${BASE}\\{8b924214-53f1-426d-850a-3c0c22902c37}\\Properties`,
  '    {b3f8fa53-0004-438e-9003-51a46e139bfc},15    REG_BINARY    4100000001000000EA070B0001001000160033001C004C00',
  '    {a45c254e-df1c-4efd-8020-67d146a850e0},2    REG_SZ    HDMI',
  '    {b3f8fa53-0004-438e-9003-51a46e139bfc},6    REG_SZ    UGREEN 25173',
  '    {24dbb0fc-9311-4b3d-9cf0-18ff155639d4},1    REG_BINARY    0B00000001000000FFFF0000',
  '',
].join('\r\n');

test('the output of reg is read key by key, with name, type and data', () => {
  const keys = parseReg(PROPERTIES);
  assert.equal(keys.length, 1);
  assert.equal(keys[0].values['{a45c254e-df1c-4efd-8020-67d146a850e0},2'].data, 'HDMI');
  assert.equal(keys[0].values['{b3f8fa53-0004-438e-9003-51a46e139bfc},6'].data, 'UGREEN 25173', 'spaces inside the data stay');
  assert.equal(keys[0].values[LISTEN].type, 'REG_BINARY');
  assert.deepEqual(parseReg(''), []);
  assert.deepEqual(parseReg(null), []);
});

test('only an endpoint with "Listen" on (FFFF) counts, one with it off does not', () => {
  assert.deepEqual(listeningEndpoints(QUERY), ['{8b924214-53f1-426d-850a-3c0c22902c37}']);
  assert.equal(isYes('0B00000001000000FFFF0000'), true);
  assert.equal(isYes('0b00000001000000ffff0000'), true);
  assert.equal(isYes('0B0000000100000000000000'), false);
  for (const odd of ['', 'FFFF', '0B00000001000000FFFF', '0B00000001000000FFFF000000', null, undefined, 42]) assert.equal(isYes(odd), false);
  assert.deepEqual(listeningEndpoints('nonsense'), []);
});

test('the name of the endpoint is the connector and the device, like Windows names it', () => {
  assert.equal(friendlyName('HDMI', 'UGREEN 25173'), 'HDMI (UGREEN 25173)');
  assert.equal(friendlyName('', 'UGREEN 25173'), 'UGREEN 25173');
  assert.equal(friendlyName('', ''), '');
});

test('the label Chromium shows is matched without its USB id, ignoring case', () => {
  assert.equal(withoutUsbId('HDMI (UGREEN 25173) (3188:1000)'), 'HDMI (UGREEN 25173)');
  assert.equal(withoutUsbId('Mikrofon (Realtek(R) Audio)'), 'Mikrofon (Realtek(R) Audio)');
  const names = { '{a}': 'HDMI (UGREEN 25173)' };
  assert.equal(labelMatches('HDMI (UGREEN 25173) (3188:1000)', names), true);
  assert.equal(labelMatches('hdmi (ugreen 25173) (3188:1000)', names), true);
  assert.equal(labelMatches('HDMI (OTHER CARD) (3188:1000)', names), false, 'another card is not this one');
  assert.equal(labelMatches('', names), false);
  assert.equal(labelMatches('HDMI (UGREEN 25173)', { '{a}': '' }), false, 'an endpoint without a name never matches');
});

test('trouble or odd input never says "yes" (nothing is said then)', async () => {
  assert.equal(await isListening(''), false);
  assert.equal(await isListening(null), false);
  assert.equal(await isListening('x'.repeat(201)), false);
});

Promise.all(running).then(() => {
  if (failed) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
  }
  console.log('\nall listen tests passed');
});
