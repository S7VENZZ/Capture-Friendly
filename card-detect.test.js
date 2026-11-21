'use strict';

const assert = require('node:assert/strict');
const { classify, pickCard } = require('./card-detect');

let n = 0;
function test(name, fn) {
  fn();
  n++;
  console.log('ok  ' + name);
}

const cam = (deviceId, label, extra = {}) => ({ kind: 'videoinput', deviceId, label, ...extra });
const WEBCAM = cam('w', 'USB2.0 HD UVC WebCam (1bcf:2c9c)');
const UGREEN = cam('u', 'UGREEN HDMI Capture (345f:2130)');

test('names are sorted into card, webcam, virtual camera and unknown', () => {
  assert.equal(classify('UGREEN HDMI Capture'), 'card');
  assert.equal(classify('Elgato Cam Link 4K'), 'card');
  assert.equal(classify('AVerMedia Live Gamer Portable 2 Plus'), 'card');
  assert.equal(classify('USB3.0 HDMI Capture'), 'card');
  assert.equal(classify('USB2.0 HD UVC WebCam'), 'webcam');
  assert.equal(classify('Integrated Camera'), 'webcam');
  assert.equal(classify('Logitech BRIO'), 'webcam');
  assert.equal(classify('Elgato Facecam'), 'webcam'); // a webcam from a card maker is still a webcam
  assert.equal(classify('OBS Virtual Camera'), 'virtual');
  assert.equal(classify('HONOR Magic6 Pro | JP (Windows virtuelle Kamera)'), 'virtual'); // German Windows: "virtuelle Kamera"
  assert.equal(classify('Camo'), 'virtual');
  assert.equal(classify('USB Video'), 'other'); // generic names tell nothing (cards and webcams both use them)
  assert.equal(classify(''), 'other');
  assert.equal(classify(undefined), 'other');
});

test('the card is found even when the webcam is listed first', () => {
  const p = pickCard([WEBCAM, UGREEN], null);
  assert.equal(p.device.deviceId, 'u');
  assert.equal(p.auto, true);
  assert.equal(p.why, 'name');
});

test('a virtual camera does not hide the card either', () => {
  assert.equal(pickCard([cam('o', 'OBS Virtual Camera'), WEBCAM, UGREEN], null).device.deviceId, 'u');
});

test('only a webcam: preselected, but never switched on by itself', () => {
  const p = pickCard([WEBCAM], null);
  assert.equal(p.device.deviceId, 'w');
  assert.equal(p.auto, false);
});

test('only virtual and webcam: nothing is switched on by itself', () => {
  assert.equal(pickCard([cam('o', 'OBS Virtual Camera'), WEBCAM], null).auto, false);
});

test('an unknown name is preselected before a webcam, but not switched on by itself', () => {
  const p = pickCard([WEBCAM, cam('x', 'USB Video')], null);
  assert.equal(p.device.deviceId, 'x');
  assert.equal(p.auto, false);
});

test('a card chosen by hand before is found again by its id and then switched on', () => {
  const p = pickCard([WEBCAM, cam('x', 'USB Video')], { id: 'x', label: 'USB Video' });
  assert.equal(p.device.deviceId, 'x');
  assert.equal(p.auto, true);
  assert.equal(p.why, 'remembered');
});

test('and by its name when the id changed', () => {
  const p = pickCard([WEBCAM, cam('new-id', 'USB Video')], { id: 'old-id', label: 'USB Video' });
  assert.equal(p.device.deviceId, 'new-id');
  assert.equal(p.auto, true);
});

test('the remembered card wins over another card that is named like one', () => {
  const p = pickCard([UGREEN, cam('e', 'Elgato HD60 X')], { id: 'e', label: 'Elgato HD60 X' });
  assert.equal(p.device.deviceId, 'e');
});

test('a webcam is never remembered into switching on, the card is taken instead', () => {
  const p = pickCard([WEBCAM, UGREEN], { id: 'w', label: WEBCAM.label });
  assert.equal(p.device.deviceId, 'u');
  assert.equal(p.auto, true);
});

test('a remembered card that is not plugged in is ignored', () => {
  const p = pickCard([WEBCAM, UGREEN], { id: 'gone', label: 'Something else' });
  assert.equal(p.device.deviceId, 'u');
});

test('two cards: the first one named like a card, the same one every time', () => {
  const list = [WEBCAM, UGREEN, cam('e', 'Elgato HD60 X')];
  assert.equal(pickCard(list, null).device.deviceId, 'u');
  assert.equal(pickCard(list, null).device.deviceId, 'u');
});

test('inputs without a name cannot be recognized, so nothing is switched on by itself', () => {
  const p = pickCard([cam('a', ''), cam('b', '')], null);
  assert.equal(p.auto, false);
  assert.equal(p.device.deviceId, 'a');
});

test('no video input at all', () => {
  assert.equal(pickCard([], null), null);
  assert.equal(pickCard(undefined, null), null);
  assert.equal(pickCard([{ kind: 'audioinput', deviceId: 'm', label: 'UGREEN HDMI Capture' }], null), null);
});

console.log(`\nall card-detect tests passed (${n})`);
