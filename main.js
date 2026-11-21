'use strict';

/**
 * Capture Friendly – main process.
 *
 * Shows the picture and the sound of a capture card in one window that you share in Discord ("Fenster teilen").
 * The page has no network access and no access to the computer: it may only use the video / audio devices the user
 * picks and fullscreen, and ask this process (preload.js) to look for a newer version and install it (updater.js,
 * GitHub only). The only links that may open are the releases page on GitHub and the donation page.
 */

const { app, BrowserWindow, Menu, ipcMain, session, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { APP_NAME, RELEASES_URL, DONATE_URL } = require('./about');
const { createUpdater, cleanupOldDownloads } = require('./updater');
const { createPresence } = require('./presence');
const { isListening } = require('./listen');

const IS_DEV = process.argv.includes('--dev');
const PAGE = path.join(__dirname, 'capture.html');
const PAGE_URL = pathToFileURL(PAGE).href;

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('app.capturefriendly');

// Keep playing when the window is hidden; a window that another window covers must keep painting (Discord would get a frozen picture).
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 480,
    minHeight: 300,
    backgroundColor: '#000000',
    title: APP_NAME,
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
      devTools: IS_DEV,
    },
  });
  win.setMenu(null);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    win = null;
    app.quit();
  });
  win.loadFile(PAGE, { query: { v: app.getVersion() } }); // the page shows the version
}

const updater = createUpdater((status) => {
  if (win && !win.isDestroyed()) win.webContents.send('update:status', status);
});
// only the page of this window may ask
const fromPage = (event) => Boolean(win) && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url.startsWith(PAGE_URL);
ipcMain.handle('update:check', (event) => (fromPage(event) ? updater.check() : null));
ipcMain.handle('update:install', (event) => (fromPage(event) ? updater.install() : null));

// is "Listen to this device" on in Windows for the card's sound input? Only read, never changed; the page only gets true or false
ipcMain.handle('audio:listening', (event, label) => (fromPage(event) && typeof label === 'string' ? isListening(label) : false));

// the Discord display (off until the user switches it on in the settings)
const presence = createPresence({
  onStatus: (status) => {
    if (win && !win.isDestroyed()) win.webContents.send('presence:status', status);
  },
});
ipcMain.handle('presence:update', (event, state) => (fromPage(event) ? presence.update({ enabled: Boolean(state && state.enabled === true), running: Boolean(state && state.running === true) }) : null));
app.on('before-quit', () => {
  presence.close();
  // the settings (language, card, modes ...) are on disk even when the window is closed right after a change;
  // not before the app is ready: a second start (the first one still runs) quits before that and has no session yet
  if (app.isReady()) session.defaultSession.flushStorageData();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  // no pop-ups, no navigation away from the local page, no <webview>
  app.on('web-contents-created', (_event, contents) => {
    // the only links that may open (in the browser): the downloads page on GitHub and the donation page
    contents.setWindowOpenHandler(({ url }) => {
      if (url === RELEASES_URL || url === DONATE_URL) shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    const allowed = (permission, url) => (permission === 'media' || permission === 'fullscreen') && typeof url === 'string' && url.startsWith(PAGE_URL);
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => callback(allowed(permission, details.requestingUrl)));
    session.defaultSession.setPermissionCheckHandler((wc, permission, origin, details) => allowed(permission, details.requestingUrl || wc.getURL()));
    createWindow();
    cleanupOldDownloads();
  });

  app.on('window-all-closed', () => app.quit());
}
