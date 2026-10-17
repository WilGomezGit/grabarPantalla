const { app, BrowserWindow, desktopCapturer, session, ipcMain, globalShortcut, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let bubbleWin, win, sel = { id: null, audio: false }, normalBounds = null;
const webDir = fs.existsSync(path.join(__dirname, 'app')) ? path.join(__dirname, 'app') : path.join(__dirname, '..', 'web');
const iconPath = path.join(__dirname, 'icon.png');

function create() {
  win = new BrowserWindow({
    width: 1200, height: 820, backgroundColor: '#0d1117', title: 'WAG Rec', autoHideMenuBar: true,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false, contextIsolation: true }
  });
  win.loadFile(path.join(webDir, 'index.html'));
  win.on('closed', () => { closeBubble(); app.quit(); });
}

function closeBubble() { if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.destroy(); bubbleWin = null; }
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(true));
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const srcs = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    const s = srcs.find(x => x.id === sel.id) || srcs[0];
    cb(sel.audio ? { video: s, audio: 'loopback' } : { video: s });
  });

  ipcMain.handle('sources', async () => {
    const srcs = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 } });
    return srcs.map(s => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() }));
  });
  ipcMain.handle('setSource', (_e, id, audio) => { sel = { id, audio }; });
  ipcMain.on('compact', (_e, on) => {
    if (!win) return;
    if (on) {
      normalBounds = win.getBounds();
      const wa = screen.getPrimaryDisplay().workArea;
      win.setMinimumSize(300, 120);
      win.setSize(380, 160); win.setPosition(Math.round(wa.x + wa.width / 2 - 190), wa.y + 10);
      win.setAlwaysOnTop(true, 'screen-saver'); win.setContentProtection(true); // la barra no sale en el video
    } else {
      win.setContentProtection(false); win.setAlwaysOnTop(false); win.setMinimumSize(0, 0);
      if (normalBounds) win.setBounds(normalBounds);
      win.show(); win.focus();
    }
  });

  ipcMain.handle('bubbleOpen', async (_e, o) => {
    closeBubble();
    const wa = screen.getPrimaryDisplay().workArea, d = Math.round(Math.min(wa.width, wa.height) * o.size), pad = Math.round(d * .12), S = d + pad * 2, mg = 16;
    const x = o.pos.includes('l') ? wa.x + mg : wa.x + wa.width - S - mg, y = o.pos.includes('t') ? wa.y + mg : wa.y + wa.height - S - mg;
    bubbleWin = new BrowserWindow({ width: S, height: S, x, y, transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, hasShadow: false, backgroundColor: '#00000000', webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false, contextIsolation: true } });
    bubbleWin.setAlwaysOnTop(true, 'screen-saver');
    await bubbleWin.loadFile(path.join(webDir, 'bubble.html'), { query: { cam: o.cam || '', shape: o.shape, color: o.color, mirror: o.mirror ? '1' : '0', pad: String(pad) } });
  });
  ipcMain.on('bubbleState', (_e, st) => bubbleWin && !bubbleWin.isDestroyed() && bubbleWin.webContents.send('bubble-state', st));
  ipcMain.on('bubbleClose', closeBubble);

  const send = a => win && win.webContents.send('global', a);
  globalShortcut.register('CommandOrControl+Shift+S', () => send('stop'));
  globalShortcut.register('CommandOrControl+Shift+P', () => send('pause'));
  create();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
