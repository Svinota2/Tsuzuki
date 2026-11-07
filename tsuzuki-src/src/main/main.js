// ============================================================
//  Главный процесс Electron.
//  Здесь: создание окон, сохранение данных на диск, запросы к Shikimori,
//  работа с папками и файлами. Интерфейс лежит в src/renderer.
// ============================================================

// ------------------------------------------------------------
//  ИЗМЕНЕНО В 1.1 (Claude, 02.11.2026):
//  - file:openText — открыть файл списка (.xml/.gz/.json) для импорта
//  - anilist:graphql — запрос к AniList для импорта по нику
// ------------------------------------------------------------

const { app, BrowserWindow, ipcMain, dialog, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const settings = require('./settings');
const adblock = require('./adblock');
const adblockCosmetic = require('./adblock-cosmetic');
const services = require('./services');   // аккаунт Shikimori, статистика, автообновление (1.3)
const background = require('./background'); // трей, фоновые проверки серий (1.3)
const extras = require('./extras');         // итоги года, Discord, автораскладка папок (1.5)

const isDev = process.argv.includes('--dev');
let mainWindow = null;

// ---------- Главное окно ----------
function createMainWindow() {
  const w = settings.WINDOW;
  mainWindow = new BrowserWindow({
    width: w.width,
    height: w.height,
    minWidth: w.minWidth,
    minHeight: w.minHeight,
    backgroundColor: w.background,
    title: 'Tsuzuki',
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'), // значок окна (Linux)
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  // Всплывающие окна (включая рекламные popunder из Kodik-плеера) не открываем.
  // Внешние ссылки приложение открывает само через window.api.openExternal.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Не даём главному окну уйти со страницы приложения
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  // ИЗМЕНЕНО В 1.3: сворачивание в трей при закрытии (если включено в настройках)
  mainWindow.on('close', (e) => {
    if (!background.isQuittingNow() && background.isCloseToTray()) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ---------- Окно для официальных сервисов / трейлеров ----------
// partition 'persist:services' — вход в аккаунт на сайте сохраняется между запусками.
const webWindows = new Set(); // держим ссылки, иначе окна может закрыть сборщик мусора
function openWebWindow(url, title) {
  const win = new BrowserWindow({
    width: settings.WEB_WINDOW.width,
    height: settings.WEB_WINDOW.height,
    backgroundColor: '#000000',
    title: title || 'Tsuzuki',
    autoHideMenuBar: true,
    parent: undefined,
    webPreferences: {
      partition: 'persist:services',
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  webWindows.add(win);
  win.on('closed', () => webWindows.delete(win));
  // Всплывающие окна сайта открываем в этом же окне
  win.webContents.setWindowOpenHandler(({ url: next }) => {
    if (/^https?:\/\//.test(next)) win.loadURL(next);
    return { action: 'deny' };
  });
  // Косметическая чистка рекламных блоков сайта (нативные баннеры)
  adblockCosmetic.install(win.webContents);
  win.loadURL(url);
}

// ---------- Окно плеера (iframe-обёртка) ----------
// Ссылку Kodik нельзя открыть напрямую: плеер отдаёт «страницы не существует».
// Поэтому грузим локальную обёртку, которая вставляет тот же iframe.
const playerWindows = new Set();
const PLAYER_URL_RE = /^https:\/\/([a-z0-9-]+\.)*(kodikplayer\.com|kodik\.info|kodik\.biz)\//i;
function openPlayerWindow(url, title) {
  const link = String(url || '');
  if (!PLAYER_URL_RE.test(link)) throw new Error('Можно открывать только ссылки плеера Kodik');
  const wrapper = pathToFileURL(path.join(__dirname, '..', 'renderer', 'player-window.html')).href;
  const win = new BrowserWindow({
    width: settings.WEB_WINDOW.width,
    height: settings.WEB_WINDOW.height,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#000000',
    title: title || 'Tsuzuki — плеер',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  playerWindows.add(win);
  win.on('closed', () => playerWindows.delete(win));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const query = '?url=' + encodeURIComponent(link) + '&title=' + encodeURIComponent(String(title || ''));
  win.loadURL(wrapper + query);
}

// ---------- Хранение данных ----------
function dataPath() {
  return path.join(app.getPath('userData'), settings.DATA_FILE);
}

// ---------- Переезд со старого названия (AniDesk → Tsuzuki) ----------
// Старый список лежит в %APPDATA%\AniDesk (Linux: ~/.config/AniDesk).
// При первом запуске Tsuzuki копируем его в новую папку, ничего не удаляя,
// чтобы библиотека, история и настройки не потерялись после переименования.
function migrateOldData() {
  try {
    if (fs.existsSync(dataPath())) return; // у Tsuzuki уже есть свои данные
    const oldDir = path.join(app.getPath('appData'), 'AniDesk');
    const oldFile = path.join(oldDir, 'anidesk-data.json');
    if (!fs.existsSync(oldFile)) return;
    fs.mkdirSync(path.dirname(dataPath()), { recursive: true });
    fs.copyFileSync(oldFile, dataPath());
    // кеш авто-токена Kodik — тоже перенесём, чтобы не ждать автоподбор заново
    const oldToken = path.join(oldDir, 'kodik-auto-token.json');
    const newToken = path.join(path.dirname(dataPath()), 'kodik-auto-token.json');
    if (fs.existsSync(oldToken) && !fs.existsSync(newToken)) fs.copyFileSync(oldToken, newToken);
  } catch {
    // переезд не критичен: если не вышло — приложение начнёт с пустого списка
  }
}

function readData() {
  try {
    return JSON.parse(fs.readFileSync(dataPath(), 'utf8'));
  } catch {
    return null; // файла ещё нет — интерфейс создаст пустой список
  }
}

function writeData(data) {
  // Пишем во временный файл и переименовываем, чтобы не испортить данные при сбое
  const file = dataPath();
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return true;
}

// ---------- Запросы к Shikimori ----------
async function shikiRequest(urlPath, options = {}) {
  const res = await net.fetch(settings.SHIKIMORI_URL + urlPath, {
    ...options,
    headers: {
      'User-Agent': settings.USER_AGENT,
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shikimori ответил ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// ---------- Запросы к Kodik ----------
// Свой токен выдаётся владельцам сайтов (support@kodikres.com), но приложению
// он не обязателен: если токен не задан, берём рабочий публичный токен из
// открытой библиотеки AnimeParsers (github.com/YaNesyTortiK/AnimeParsers).
// Публичный токен общий и может перестать работать — тогда вставь свой.
const KODIK_API = 'https://kodik-api.com';

let autoKodikToken = null; // { token, source, at }

// Токены в AnimeParsers зашифрованы: две половины в base64, каждая перевёрнута
function decodeKodikToken(enc) {
  const mid = Math.floor(enc.length / 2);
  const tail = Buffer.from(enc.slice(0, mid).split('').reverse().join(''), 'base64').toString('utf8');
  const head = Buffer.from(enc.slice(mid).split('').reverse().join(''), 'base64').toString('utf8');
  return head + tail;
}

function autoTokenPath() {
  return path.join(app.getPath('userData'), settings.KODIK_TOKEN_CACHE_FILE);
}

function readAutoToken() {
  if (autoKodikToken) return autoKodikToken;
  if (!settings.AUTO_KODIK_TOKEN) return null;
  try {
    const data = JSON.parse(fs.readFileSync(autoTokenPath(), 'utf8'));
    const ttl = (Number(settings.KODIK_TOKEN_TTL_HOURS) || 12) * 60 * 60 * 1000;
    if (data?.token && Date.now() - Number(data.at || 0) < ttl) {
      autoKodikToken = { token: data.token, source: 'public-cached', at: Number(data.at) };
      return autoKodikToken;
    }
  } catch {
    // кеша ещё нет — это нормально
  }
  return null;
}

function saveAutoToken(token) {
  autoKodikToken = { token, source: 'public', at: Date.now() };
  try {
    fs.writeFileSync(autoTokenPath(), JSON.stringify({ token, at: autoKodikToken.at }), 'utf8');
  } catch {
    // не смогли сохранить кеш — токен останется в памяти
  }
  return token;
}

function forgetAutoToken() {
  autoKodikToken = null;
  try { fs.unlinkSync(autoTokenPath()); } catch { /* кеша уже нет */ }
}

async function fetchPublicKodikToken() {
  if (!settings.AUTO_KODIK_TOKEN) throw new Error('Автоподбор токена Kodik отключён в настройках');
  const res = await net.fetch(settings.KODIK_TOKENS_URL, {
    headers: { 'User-Agent': settings.USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Не удалось получить список публичных токенов (HTTP ${res.status})`);
  const list = JSON.parse(await res.text());

  for (const group of ['stable', 'unstable']) {
    for (const item of list?.[group] || []) {
      let token = '';
      try { token = decodeKodikToken(String(item.tokn || '')); } catch { continue; }
      if (!token) continue;
      try {
        await kodikRequest('/translations', { token });
        return saveAutoToken(token);
      } catch {
        // токен нерабочий — пробуем следующий
      }
    }
  }
  throw new Error('Сейчас нет рабочих публичных токенов Kodik. Вставь свой в «Настройках».');
}

// Свой токен (настройки/env) в приоритете, иначе публичный.
async function resolveKodikToken(fromRenderer) {
  const own = String(fromRenderer || process.env.KODIK_TOKEN || settings.KODIK_TOKEN || '').trim();
  if (own) return { token: own, source: 'user' };
  const cached = readAutoToken();
  if (cached) return cached;
  return { token: await fetchPublicKodikToken(), source: 'public' };
}

async function kodikRequest(urlPath, params = {}) {
  const url = new URL(KODIK_API + urlPath);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await net.fetch(url.toString(), {
    headers: {
      'User-Agent': settings.USER_AGENT,
      Accept: 'application/json',
    },
  });
  const text = await res.text();

  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // оставляем null — покажем текст ошибки ниже
  }

  if (!res.ok || data?.error) {
    throw new Error(data?.error || `Kodik ответил ${res.status}: ${text.slice(0, 200)}`);
  }
  return data;
}

// Запрос с нужным токеном. Если публичный токен протух — один раз
// перезапрашиваем список токенов и повторяем запрос.
async function kodikCall(urlPath, params, fromRenderer) {
  let resolved = await resolveKodikToken(fromRenderer);
  try {
    return {
      data: await kodikRequest(urlPath, { ...params, token: resolved.token }),
      source: resolved.source === 'user' ? 'user' : 'public',
    };
  } catch (err) {
    const tokenProblem = /токен|token/i.test(String(err?.message || ''));
    if (!tokenProblem || resolved.source === 'user') throw err;
    forgetAutoToken();
    const fresh = await fetchPublicKodikToken();
    return {
      data: await kodikRequest(urlPath, { ...params, token: fresh }),
      source: 'public',
    };
  }
}

// ---------- Видео в папке ----------
// Естественная сортировка: «2.mkv» раньше «10.mkv»
const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

function listVideos(folder) {
  const result = [];
  const walk = (dir, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && depth < 2) walk(full, depth + 1); // заходим в подпапки на 2 уровня
      else if (e.isFile() && settings.VIDEO_EXTENSIONS.includes(path.extname(e.name).toLowerCase())) {
        result.push({ name: e.name, path: full, url: pathToFileURL(full).href });
      }
    }
  };
  walk(folder, 0);
  return result.sort((a, b) => collator.compare(a.name, b.name));
}

// ---------- IPC: всё, что интерфейс может попросить у главного процесса ----------
// Список этих функций в интерфейсе — window.api (см. preload.js)
function registerIpc() {
  ipcMain.handle('data:load', () => readData());
  ipcMain.handle('data:save', (_e, data) => writeData(data));
  ipcMain.handle('data:path', () => dataPath());

  ipcMain.handle('data:export', async (_e, data) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Сохранить резервную копию',
      defaultPath: `tsuzuki-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  });

  ipcMain.handle('data:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Загрузить резервную копию',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return null;
    return JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
  });

  // Открыть текстовый файл (импорт списков из других программ).
  // .gz распаковываем сами — MyAnimeList отдаёт экспорт в .xml.gz
  ipcMain.handle('file:openText', async (_e, { title, extensions } = {}) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: title || 'Выбери файл',
      filters: [{ name: 'Файлы списка', extensions: extensions || ['xml', 'gz', 'json', 'txt'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return null;
    let buf = fs.readFileSync(filePaths[0]);
    if (filePaths[0].toLowerCase().endsWith('.gz')) {
      try {
        buf = require('zlib').gunzipSync(buf);
      } catch {
        throw new Error('Не удалось распаковать .gz: файл повреждён или это не gzip-архив');
      }
    }
    return { name: path.basename(filePaths[0]), text: buf.toString('utf8') };
  });

  // AniList (импорт списка по нику). Только чтение открытых данных.
  ipcMain.handle('anilist:graphql', async (_e, query, variables) => {
    const res = await net.fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': settings.USER_AGENT },
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // ниже покажем понятную ошибку вместо «Unexpected token»
    }
    if (!res.ok || json?.errors?.length) {
      throw new Error(json?.errors?.[0]?.message || `AniList ответил ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!json?.data) throw new Error('AniList вернул пустой ответ — проверь ник и открытость списка');
    return json.data;
  });

  ipcMain.handle('shiki:graphql', (_e, query, variables) =>
    shikiRequest('/api/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    })
  );
  ipcMain.handle('shiki:get', (_e, urlPath) => {
    if (!urlPath.startsWith('/api/')) throw new Error('Разрешены только пути /api/...');
    return shikiRequest(urlPath);
  });

  // Kodik: поиск озвучек и серий по id Shikimori или по названию.
  // Токен свой или публичный — решает kodikCall.
  ipcMain.handle('kodik:search', async (_e, { token, shikimoriId, title, limit = 100 } = {}) => {
    const rawId = String(shikimoriId ?? '').trim();
    const id = /^\d+$/.test(rawId) ? rawId : '';
    const queryTitle = String(title ?? '').trim();
    if (!id && !queryTitle) throw new Error('Нужен id Shikimori или название тайтла');

    const params = {
      with_episodes: 'true',
      with_episodes_data: 'true',
      limit: Math.max(1, Math.min(Number(limit) || 100, 100)),
      types: 'anime,anime-serial',
    };
    if (id) params.shikimori_id = id;
    else params.title = queryTitle;

    const { data } = await kodikCall('/search', params, token);
    return data;
  });

  // Проверка токена: /translations отдаёт список доступных озвучек.
  // Возвращает и источник токена: 'user' — свой, иначе публичный.
  ipcMain.handle('kodik:check', async (_e, token) => {
    const { data, source } = await kodikCall('/translations', {}, token);
    const list = Array.isArray(data)
      ? data
      : (data?.results || data?.translations || Object.values(data || {}));
    return { count: list.length, source: source === 'user' ? 'user' : 'public' };
  });

  ipcMain.handle('folder:pick', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Выбери папку с сериями',
      properties: ['openDirectory'],
    });
    return canceled ? null : filePaths[0];
  });
  ipcMain.handle('folder:videos', (_e, folder) => listVideos(folder));
  ipcMain.handle('path:open', (_e, p) => shell.openPath(p));

  ipcMain.handle('web:open', (_e, url, title) => {
    if (!/^https?:\/\//.test(url)) throw new Error('Можно открывать только http(s) ссылки');
    openWebWindow(url, title);
  });
  ipcMain.handle('web:external', (_e, url) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
  // Плеер Kodik в отдельном окне (через локальную iframe-обёртку)
  ipcMain.handle('player:open', (_e, url, title) => openPlayerWindow(url, title));

  // Блокировка рекламы: вкл/выкл и счётчик заблокированных запросов
  ipcMain.handle('adblock:set', (_e, enabled) => adblock.setEnabled(enabled));
  ipcMain.handle('adblock:stats', () => adblock.getStats());

  // Субтитры рядом с видео (ДОБАВЛЕНО В 1.4)
  ipcMain.handle('subtitles:find', (_e, videoPath) => findSubtitles(String(videoPath || '')));
  ipcMain.handle('subtitles:read', (_e, subPath) => readSubtitles(String(subPath || '')));

  // ИЗМЕНЕНО В 1.3: аккаунт Shikimori, статистика, автообновление
  services.registerServices();
  // ИЗМЕНЕНО В 1.3: трей, фоновые проверки новых серий, автозапуск
  background.registerBackground(() => mainWindow);
  // ДОБАВЛЕНО В 1.5: картинки для «Итогов года», Discord, подпапки с аниме
  extras.registerExtras(() => mainWindow);
}

// ---------- Субтитры рядом с видео (ДОБАВЛЕНО В 1.4) ----------
// Ищем файлы субтитров с тем же именем, что у видео: «серия.srt», «серия.rus.ass» и т.п.
// .srt и .ass переводим в WebVTT — его умеет показывать встроенный <video>.
const SUB_EXT = ['.srt', '.vtt', '.ass', '.ssa'];

function findSubtitles(videoPath) {
  try {
    const dir = path.dirname(videoPath);
    const base = path.parse(videoPath).name;
    const out = [];
    for (const file of fs.readdirSync(dir)) {
      const ext = path.extname(file).toLowerCase();
      if (!SUB_EXT.includes(ext)) continue;
      const stem = path.parse(file).name;
      if (stem !== base && !stem.startsWith(base + '.') && !stem.startsWith(base + '_')) continue;
      const suffix = stem.slice(base.length).replace(/^[._-]+/, '').trim();
      out.push({ path: path.join(dir, file), name: file, label: suffix ? suffix.toUpperCase() : 'Основные' });
    }
    // сначала простые .srt/.vtt, потом .ass/.ssa (у них теряются стили — честно помечаем)
    out.sort((a, b) => {
      const rank = (x) => (/\.(ass|ssa)$/i.test(x.name) ? 1 : 0);
      return rank(a) - rank(b) || String(a.label).localeCompare(String(b.label));
    });
    return out.map((x) => ({ ...x, label: /\.(ass|ssa)$/i.test(x.name) ? x.label + ' (без стилей)' : x.label }));
  } catch {
    return [];
  }
}

function srtToVtt(text) {
  const lines = String(text).replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
  const out = ['WEBVTT', ''];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\d+$/.test(line.trim())) { i++; continue; } // номер блока
    const m = line.match(/^(\d{1,2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}),(\d{3})/);
    if (m) {
      out.push(`${m[1]}.${m[2]} --> ${m[3]}.${m[4]}`);
      i++;
      while (i < lines.length && lines[i].trim() !== '') { out.push(lines[i]); i++; }
      out.push('');
      continue;
    }
    i++;
  }
  return out.join('\n');
}

function assToVtt(text) {
  const out = ['WEBVTT', ''];
  const norm = (t) => {
    const m = String(t || '').trim().match(/^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/);
    if (!m) return null;
    return `${m[1].padStart(2, '0')}:${m[2]}:${m[3]}.${(m[4] + '00').slice(0, 3)}`;
  };
  for (const line of String(text).replace(/\r/g, '').split('\n')) {
    if (!/^Dialogue:/.test(line)) continue;
    const parts = line.replace(/^Dialogue:\s*/, '').split(',');
    const start = norm(parts[1]);
    const end = norm(parts[2]);
    if (!start || !end) continue;
    const txt = parts.slice(9).join(',')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/g, '\n')
      .replace(/\s+/g, ' ')
      .trim();
    if (!txt) continue;
    out.push(`${start} --> ${end}`, txt, '');
  }
  return out.join('\n');
}

function readSubtitles(subPath) {
  const ext = path.extname(subPath).toLowerCase();
  if (!SUB_EXT.includes(ext)) throw new Error('Это не файл субтитров');
  const text = fs.readFileSync(subPath, 'utf8');
  if (ext === '.vtt') return { ok: true, vtt: text, format: 'vtt' };
  if (ext === '.srt') return { ok: true, vtt: srtToVtt(text), format: 'srt' };
  return { ok: true, vtt: assToVtt(text), format: ext.slice(1) };
}

// ---------- Запуск ----------
app.whenReady().then(() => {
  // Идентификатор приложения для системных уведомлений Windows
  if (process.platform === 'win32') app.setAppUserModelId('local.tsuzuki.app');
  migrateOldData(); // первым делом — перенос списка со старого названия (AniDesk)
  // Блокировка рекламы: по умолчанию включена, выключается в «Настройках»
  const saved = readData();
  adblock.install(!saved?.prefs || saved.prefs.adblock !== false);
  registerIpc();
  createMainWindow();

  // ИЗМЕНЕНО В 1.6: автообновление включает/выключается пунктом настроек
  // («Проверять обновления автоматически» → prefs.custom.autoUpdate).
  // Проверка идёт при запуске и раз в settings.UPDATE_INTERVAL_HOURS часов,
  // таймер живёт в services.setUpdaterAuto(); выключено — не проверяем вовсе.
  services.setUpdaterAuto(saved?.prefs?.custom?.autoUpdate !== false).catch(() => {});

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('before-quit', () => background.markQuitting());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
