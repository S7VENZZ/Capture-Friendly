'use strict';

/**
 * Capture cards show up twice: as a video input and as a separate USB audio input.
 * This picks the audio input that belongs to a video input. Pure function, no DOM.
 *
 *  1. same groupId (Chromium groups the inputs of one physical USB device)
 *  2. otherwise the same USB id "(vvvv:pppp)" that Chromium appends to the labels of USB devices
 *
 * The virtual "default" / "communications" entries are never picked: they point at whatever the PC uses as microphone.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CfCardMatch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const USB_ID = /\(([0-9a-f]{4}:[0-9a-f]{4})\)/i;
  const VIRTUAL = new Set(['default', 'communications']);

  const usbId = (label) => {
    const m = USB_ID.exec(label || '');
    return m ? m[1].toLowerCase() : '';
  };

  /**
   * @param {{deviceId:string, groupId?:string, label?:string}} video
   * @param {Array<{kind:string, deviceId:string, groupId?:string, label?:string}>} devices result of enumerateDevices()
   * @returns the matching audioinput or null
   */
  function matchAudioInput(video, devices) {
    if (!video) return null;
    const inputs = devices.filter((d) => d.kind === 'audioinput' && d.deviceId && !VIRTUAL.has(d.deviceId));
    if (video.groupId) {
      const same = inputs.find((d) => d.groupId === video.groupId);
      if (same) return same;
    }
    const id = usbId(video.label);
    return (id && inputs.find((d) => usbId(d.label) === id)) || null;
  }

  return { matchAudioInput };
});
