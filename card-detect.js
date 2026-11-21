'use strict';

/**
 * Finds the capture card among the video inputs by itself. Pure functions, no DOM.
 *
 * Every video input gets a kind from its name:
 *   virtual  software cameras (OBS Virtual Camera, Camo, NDI ...)
 *   webcam   real cameras (webcam, integrated camera, Brio ...)
 *   card     capture cards (UGREEN, Elgato, Cam Link, AVerMedia, "Capture", "HDMI" ...)
 *   other    anything the name does not tell (generic names like "USB Video")
 *
 * pickCard() chooses which input to use and says whether it may be switched on without a click:
 *   1. the card used last time (remembered), unless it is a webcam or a virtual camera
 *   2. otherwise the first input that is named like a capture card
 *   3. otherwise just a preselection (first input that is not a webcam or virtual camera), never switched on by itself
 * A webcam or virtual camera is never switched on by itself: that would turn on a camera nobody asked for.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CfCardDetect = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const VIRTUAL = /virtual|virtuell|\bobs\b|\bcamo\b|\bndi\b|snap ?camera|manycam|xsplit|droidcam|iriun|epoccam|streamlabs|\bvcam\b|broadcast|mmhmm/i;
  const WEBCAM = /web ?cam|face ?cam|\bcamera\b|\bkamera\b|integrated|facetime|\bbrio\b|lifecam|kiyo|\bc9\d\d\b|\bc270\b|infrared|windows hello|\bir\b/i;
  const CARD = /capture|grabber|hdmi|ugreen|elgato|cam ?link|avermedia|magewell|blackmagic|decklink|game ?link|live ?gamer|hd60|4k60|ms2109|ms2130|macrosilicon|hagibis/i;

  /** @returns {'virtual'|'webcam'|'card'|'other'} */
  function classify(label) {
    const name = String(label || '');
    if (VIRTUAL.test(name)) return 'virtual';
    if (WEBCAM.test(name)) return 'webcam';
    if (CARD.test(name)) return 'card';
    return 'other';
  }

  const sameDevice = (d, remembered) => Boolean(remembered) && (d.deviceId === remembered.id || (Boolean(remembered.label) && d.label === remembered.label));
  const usable = (d) => d.kind === undefined || d.kind === 'videoinput';

  /**
   * @param {Array<{deviceId:string, label?:string, kind?:string}>} devices video inputs (other kinds are ignored)
   * @param {{id?:string, label?:string}|null} remembered the card that was running last time
   * @returns {{device:object, auto:boolean, why:'remembered'|'name'|'none'}|null} null when there is no video input
   */
  function pickCard(devices, remembered) {
    const cams = (devices || []).filter((d) => d && d.deviceId && usable(d));
    if (!cams.length) return null;
    const kind = (d) => classify(d.label);
    const old = cams.find((d) => sameDevice(d, remembered) && kind(d) !== 'webcam' && kind(d) !== 'virtual');
    if (old) return { device: old, auto: true, why: 'remembered' };
    const named = cams.find((d) => kind(d) === 'card');
    if (named) return { device: named, auto: true, why: 'name' };
    const guess = cams.find((d) => kind(d) === 'other') || cams[0];
    return { device: guess, auto: false, why: 'none' };
  }

  return { classify, pickCard };
});
