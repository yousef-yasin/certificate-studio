// Desktop wrapper for Certificate Studio. Loads the unchanged web app from disk
// in a native window and keeps everything offline: any non-local request is blocked.
'use strict';

const { app, BrowserWindow, Menu, session, shell } = require('electron');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const LOCAL_SCHEMES = ['file:', 'data:', 'blob:', 'devtools:', 'chrome-extension:'];

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#f2eee6',
    title: 'Certificate Studio',
    icon: path.join(APP_ROOT, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  // The app never navigates; keep dropped files and stray links from replacing it.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadFile(path.join(APP_ROOT, 'index.html'));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  const ses = session.defaultSession;
  // Privacy: refuse anything that isn't local (no network access at all).
  ses.webRequest.onBeforeRequest((details, callback) => {
    const local = LOCAL_SCHEMES.some((s) => details.url.startsWith(s));
    callback({ cancel: !local });
  });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  // Exports go through the native Save dialog, starting in Downloads.
  ses.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({
      title: 'Save certificate',
      defaultPath: path.join(app.getPath('downloads'), item.getFilename()),
    });
  });

  createWindow();
});

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on('window-all-closed', () => app.quit());
