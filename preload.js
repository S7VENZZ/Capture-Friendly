'use strict';

/**
 * The only things the page can ask of the program: look for a newer version, install it, and hear how that goes (updater.js);
 * switch the Discord display on or off (presence.js); ask whether Windows plays the card's sound as well (listen.js, read only).
 * No file access, no address to open, no node: the program decides what is downloaded and from where, and what Discord is told.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cfUpdate', {
  check: () => ipcRenderer.invoke('update:check'),
  install: () => ipcRenderer.invoke('update:install'),
  onStatus: (callback) => ipcRenderer.on('update:status', (_event, status) => callback(status)),
});

// Is "Listen to this device" switched on in Windows for the card's sound input? (read only, listen.js); the page gets true or false
contextBridge.exposeInMainWorld('cfAudio', {
  listening: (label) => ipcRenderer.invoke('audio:listening', String(label || '').slice(0, 200)),
});

// The Discord display: the page says only whether it is switched on and whether the picture runs; the text that Discord shows is fixed (presence.js).
contextBridge.exposeInMainWorld('cfPresence', {
  update: (state) => ipcRenderer.invoke('presence:update', { enabled: Boolean(state && state.enabled), running: Boolean(state && state.running) }),
  onStatus: (callback) => ipcRenderer.on('presence:status', (_event, status) => callback(status)),
});
