// ============================================================
//  МИНИ-ПЛЕЕР (ДОБАВЛЕНО В 1.6.3).
//  Отдельное окно «как в Discord»: без рамки Windows, поверх всех окон,
//  минимальные элементы управления. Играет те же свои видеофайлы, что и
//   плеер в основном окне.
//
//  Связь с основным окном:
//   - открыли мини-плеер → основной плеер ставит видео на паузу;
//   - в мини-плеере переключили серию → основное окно синхронизирует серию
//     и статус Discord;
//   - закрыли мини-плеер → основное окно продолжает с того же места/серии.
// ============================================================

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const extras = require('./extras'); // статус в Discord (1.5, переделан в 1.6.2)

let win = null;
let ctx = null;                        // { id, title, total, list, index, time, discord }
let getMainWindow = () => null;
let lastPresenceAt = 0;

function boundsPath() {
  return path.join(app.getPath('userData'), 'mini-window.json');
}

function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(boundsPath(), 'utf8'));
    if (b && Number.isFinite(b.width) && Number.isFinite(b.height) && b.width >= 240 && b.height >= 140) return b;
  } catch { /* первый запуск — размер по умолчанию */ }
  return null;
}

function saveBounds() {
  if (!win || win.isDestroyed()) return;
  try { fs.writeFileSync(boundsPath(), JSON.stringify(win.getBounds()), 'utf8'); } catch { /* не критично */ }
}

function sendToMain(data) {
  const m = getMainWindow();
  if (m && !m.isDestroyed()) m.webContents.send('mini:event', data);
}

// Статус в Discord: показываем то же, что и в основном плеере
function presence(data) {
  try {
    if (data) extras.setPresence({ title: data.title, episode: data.episode, total: data.total, startedAt: data.startedAt || Date.now() });
    else extras.setPresence(null);
  } catch { /* без Discord приложение всё равно работает */ }
}

// currentInfo() — что сейчас в мини-плеере (для статуса и событий)
function currentInfo() {
  if (!ctx) return null;
  const item = ctx.list[ctx.index] || {};
  return {
    index: ctx.index,
    time: ctx.time,
    episode: Number(item.ep),
    title: ctx.title,
    total: ctx.total,
  };
}

function open(data) {
  if (!data || !Array.isArray(data.list) || !data.list.length) return { ok: false, error: 'no-files' };
  ctx = {
    id: String(data.id || ''),
    title: String(data.title || 'Tsuzuki'),
    total: Number(data.total) || 0,
    discord: data.discord === true,
    index: Math.max(0, Math.min(Number(data.index) || 0, data.list.length - 1)),
    time: Number(data.time) || 0,
    list: data.list.map((f) => ({
      url: String(f.url || ''),
      name: String(f.name || ''),
      ep: Number(f.ep) || 0,
    })),
  };
  if (win && !win.isDestroyed()) {
    win.webContents.send('mini:init', ctx);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return { ok: true };
  }

  const saved = loadBounds();
  const work = screen.getPrimaryDisplay().workArea;
  const width = saved ? Math.min(saved.width, work.width) : 480;
  const height = saved ? Math.min(saved.height, work.height) : 300;
  const x = saved && Number.isFinite(saved.x)
    ? Math.min(Math.max(saved.x, work.x), work.x + work.width - width)
    : work.x + work.width - width - 24;
  const y = saved && Number.isFinite(saved.y)
    ? Math.min(Math.max(saved.y, work.y), work.y + work.height - height)
    : work.y + work.height - height - 24;

  win = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 280,
    minHeight: 160,
    frame: false,            // без рамки и кнопок Windows — «как в Discord»
    resizable: true,
    movable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,       // поверх всех окон (булавка в окне переключает)
    skipTaskbar: false,
    backgroundColor: '#000000',
    title: 'Tsuzuki — мини-плеер',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-mini.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, '..', 'renderer', 'mini.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('mini:init', ctx);
    // ДОБАВЛЕНО В 1.6.3: показываем в Discord то же, что и в основном плеере
    if (ctx.discord) {
      lastPresenceAt = Date.now();
      const item = ctx.list[ctx.index] || {};
      presence({ title: ctx.title, episode: Number(item.ep), total: ctx.total, startedAt: Date.now() });
    }
  });
  win.on('move', saveBounds);
  win.on('resize', saveBounds);
  win.on('closed', () => {
    const closed = currentInfo();
    ctx = null;
    win = null;
    sendToMain({ type: 'closed', ...(closed || { index: 0, time: 0 }) });
    presence(null);
  });
  return { ok: true };
}

function registerIpc() {
  ipcMain.handle('player:mini-available', () => true);
  ipcMain.handle('player:mini', (_e, data) => open(data));

  ipcMain.handle('mini:pin', (_e, on) => {
    if (!win || win.isDestroyed()) return { ok: false };
    const value = on === undefined ? !win.isAlwaysOnTop() : !!on;
    win.setAlwaysOnTop(value, 'screen-saver');
    return { ok: true, on: value };
  });

  ipcMain.handle('mini:close', () => {
    if (win && !win.isDestroyed()) win.close();
    return { ok: true };
  });

  ipcMain.handle('mini:return', () => {
    if (win && !win.isDestroyed()) win.close();
    const m = getMainWindow();
    if (m && !m.isDestroyed()) {
      if (m.isMinimized()) m.restore();
      m.show();
      m.focus();
    }
    return { ok: true };
  });

  ipcMain.handle('mini:state', () => ({
    ok: true,
    onTop: win && !win.isDestroyed() ? win.isAlwaysOnTop() : false,
  }));

  // События из мини-окна: переключили серию / обновилось время / пауза-плей
  ipcMain.on('mini:update', (_e, payload) => {
    if (!ctx || !payload) return;
    if (Number.isInteger(payload.index)) {
      ctx.index = Math.max(0, Math.min(payload.index, ctx.list.length - 1));
      ctx.time = 0;
    }
    if (Number.isFinite(payload.time)) ctx.time = payload.time;
    // статус в Discord — не чаще раза в 10 секунд (у Discord есть свой лимит)
    const now = Date.now();
    if (ctx.discord && (payload.event === 'switch' || payload.event === 'play') && now - lastPresenceAt > 10000) {
      lastPresenceAt = now;
      const info = currentInfo();
      if (info) presence({ title: info.title, episode: info.episode, total: info.total, startedAt: Date.now() });
    }
    sendToMain({ type: 'update', ...payload });
  });
}

function setMainWindowGetter(fn) {
  getMainWindow = typeof fn === 'function' ? fn : () => null;
}

module.exports = { registerIpc, setMainWindowGetter };
