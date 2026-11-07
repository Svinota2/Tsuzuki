// ============================================================
//  ФОНОВЫЕ ФУНКЦИИ (Windows/Linux):
//   - значок в трее и сворачивание окна в трей;
//   - проверка новых серий, когда окно закрыто (системные уведомления);
//   - автозапуск вместе с системой.
// ============================================================

// НОВЫЙ ФАЙЛ В 1.3: трей, фоновые проверки серий, автозапуск.

const { app, BrowserWindow, Notification, Tray, Menu, nativeImage, net } = require('electron');
const path = require('path');
const fs = require('fs');
const settings = require('./settings');

let tray = null;
let timer = null;
let isQuitting = false;
let closeToTray = false;
let notificationsEnabled = true;
let getMainWindow = () => null;

function dataFile() { return path.join(app.getPath('userData'), settings.DATA_FILE); }

function readData() {
  try { return JSON.parse(fs.readFileSync(dataFile(), 'utf8')); } catch { return null; }
}

// Значения настроек, которые лежат в файле данных интерфейса
function readFlags() {
  const prefs = readData()?.prefs || {};
  const custom = prefs.custom || {};
  closeToTray = custom.closeToTray === true;
  notificationsEnabled = custom.backgroundNotify !== false;
}

function iconPath() {
  return path.join(__dirname, '..', 'renderer', 'icon.png');
}

// ---------- Трей ----------
function showWindow() {
  const win = getMainWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function buildTray() {
  if (tray) return tray;
  try {
    const img = nativeImage.createFromPath(iconPath());
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
    tray.setToolTip('Tsuzuki');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Открыть Tsuzuki', click: showWindow },
      { label: 'Проверить новые серии', click: () => checkEpisodes(true) },
      { type: 'separator' },
      { label: 'Выход', click: () => { isQuitting = true; app.quit(); } },
    ]));
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
  } catch {
    tray = null;
  }
  return tray;
}

// ---------- Автозапуск ----------
function autostartFile() {
  const dir = path.join(app.getPath('home'), '.config', 'autostart');
  return { dir, file: path.join(dir, 'tsuzuki.desktop') };
}

function setAutostart(enabled) {
  if (process.platform === 'linux') {
    try {
      const { dir, file } = autostartFile();
      if (!enabled) { fs.unlinkSync(file); return { ok: true }; }
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Tsuzuki',
        'Comment=Каталог и трекер аниме',
        'Exec=' + process.execPath,
        'Terminal=false',
        'X-GNOME-Autostart-enabled=true',
        '',
      ].join('\n'), 'utf8');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled, path: process.execPath, args: [] });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------- Проверка новых серий без открытого окна ----------
// Запросы идут из главного процесса: окно может быть закрыто.
// Логика та же, что в api/notifications.js на экране: сравнить episodesAired.
async function checkEpisodes(showNotifications = true) {
  const data = readData();
  if (!data) return [];
  const library = data.library || {};
  const entries = Object.values(library).filter((e) =>
    e && !e.manual && Number(e.id) > 0 &&
    (e.status === 'watching' || e.status === 'planned') &&
    e.animeStatus === 'ongoing');
  if (!entries.length) return [];

  const ids = [...new Set(entries.map((e) => Number(e.id)))].slice(0, 50);
  const query = `query($ids:String!){ animes(ids:$ids, limit:50){ id episodes episodesAired nextEpisodeAt } }`;
  let list = [];
  try {
    const res = await net.fetch(settings.SHIKIMORI_URL + '/api/graphql', {
      method: 'POST',
      headers: { 'User-Agent': settings.USER_AGENT, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables: { ids: ids.join(',') } }),
    });
    if (!res.ok) return [];
    const json = await res.json();
    list = json?.data?.animes || [];
  } catch {
    return []; // нет сети — молча выходим
  }

  const fresh = [];
  let changed = false;
  for (const a of list) {
    const entry = library[String(a.id)];
    if (!entry) continue;
    const prev = Number(entry.episodesAired) || 0;
    const next = Number(a.episodesAired) || 0;
    if (next > prev && prev > 0) fresh.push({ id: entry.id, title: entry.title || String(entry.id), from: prev, to: next });
    if (next !== prev) {
      entry.episodesAired = next;
      if (a.episodes) entry.episodes = Number(a.episodes) || entry.episodes;
      if (a.nextEpisodeAt) entry.nextEpisodeAt = a.nextEpisodeAt;
      changed = true;
    }
  }

  // Файл данных пишем, только если окно закрыто: открытое окно ведёт свою
  // запись и не должно получить конфликт версий.
  const win = getMainWindow();
  const windowOpen = win && !win.isDestroyed() && win.isVisible();
  if (changed && !windowOpen) {
    try { fs.writeFileSync(dataFile(), JSON.stringify(data, null, 2), 'utf8'); } catch { /* не критично */ }
  }

  if (fresh.length && showNotifications && notificationsEnabled && Notification.isSupported()) {
    for (const n of fresh.slice(0, 3)) {
      const notif = new Notification({
        title: 'Tsuzuki — новая серия',
        body: `${n.title}: вышла ${n.to}-я серия`,
      });
      notif.on('click', () => {
        showWindow();
        const w = getMainWindow();
        if (w) w.webContents.send('nav:anime', n.id);
      });
      notif.show();
    }
    if (fresh.length > 3) {
      new Notification({ title: 'Tsuzuki', body: `И ещё ${fresh.length - 3} новых серий` }).show();
    }
  } else if (fresh.length && windowOpen && fresh.length) {
    // окно открыто — отдадим список наверх, интерфейс покажет плашку
    try { win.webContents.send('episodes:news', fresh); } catch { /* окно закрывается */ }
  }

  return fresh;
}

function startBackgroundChecks() {
  readFlags();
  const hours = Math.max(1, Number(settings.NOTIFY_INTERVAL_HOURS) || 6);
  const run = () => { if (notificationsEnabled) checkEpisodes(true).catch(() => {}); };
  setTimeout(run, 30 * 1000); // чуть прогреться после запуска
  if (timer) clearInterval(timer);
  timer = setInterval(run, hours * 3600 * 1000);
}

function registerBackground(winProvider) {
  getMainWindow = winProvider;
  readFlags();
  buildTray();
  startBackgroundChecks();

  const { ipcMain } = require('electron');
  ipcMain.handle('tray:set-close', (_e, enabled) => { closeToTray = !!enabled; return { ok: true }; });
  ipcMain.handle('autostart:set', (_e, enabled) => setAutostart(!!enabled));
  ipcMain.handle('notifications:check-now', () => checkEpisodes(true));
  ipcMain.handle('notifications:set-enabled', (_e, enabled) => { notificationsEnabled = !!enabled; return { ok: true }; });
}

function isCloseToTray() { return closeToTray; }
function isQuittingNow() { return isQuitting; }
function markQuitting() { isQuitting = true; }

module.exports = {
  registerBackground,
  isCloseToTray,
  isQuittingNow,
  markQuitting,
  checkEpisodes,
  showWindow,
};
