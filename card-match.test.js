'use strict';

const assert = require('node:assert/strict');
const { matchAudioInput } = require('./card-match');

function test(name, fn) {
  fn();
  console.log('ok  ' + name);
}

const video = { kind: 'videoinput', deviceId: 'v1', groupId: 'g-card', label: 'USB3.0 Video (534d:2109)' };
const cardMic = { kind: 'audioinput', deviceId: 'a-card', groupId: 'g-card', label: 'Digital Audio Interface (USB3.0 Video) (534d:2109)' };
const pcMic = { kind: 'audioinput', deviceId: 'a-pc', groupId: 'g-pc', label: 'Mikrofon (Realtek)' };
const defaultMic = { kind: 'audioinput', deviceId: 'default', groupId: 'g-pc', label: 'Default - Mikrofon (Realtek)' };

test('the audio input of the same device group is chosen', () => {
  assert.equal(matchAudioInput(video, [defaultMic, pcMic, cardMic]), cardMic);
});

test('without a group match the USB id in the label is used', () => {
  const v = { ...video, groupId: 'x' };
  const a = { ...cardMic, groupId: 'y' };
  assert.equal(matchAudioInput(v, [pcMic, a]), a);
});

test('the PC microphone is never taken for a card', () => {
  assert.equal(matchAudioInput(video, [defaultMic, pcMic]), null);
  assert.equal(matchAudioInput({ ...video, groupId: 'g-pc' }, [defaultMic]), null, 'the virtual default entry is skipped');
});

test('no label, no group, no match', () => {
  assert.equal(matchAudioInput({ kind: 'videoinput', deviceId: 'v', groupId: '', label: '' }, [cardMic, pcMic]), null);
  assert.equal(matchAudioInput(null, [cardMic]), null);
});

test('video outputs and other kinds are ignored', () => {
  assert.equal(matchAudioInput(video, [{ ...cardMic, kind: 'audiooutput' }]), null);
});
