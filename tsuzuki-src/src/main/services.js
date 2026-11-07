// ============================================================
//  СИСТЕМНЫЕ СЛУЖБЫ (Windows/Linux):
//   - вход в аккаунт Shikimori (OAuth2) и запросы от имени пользователя;
//   - анонимная статистика использования (раз в сутки, по желанию);
//   - автообновление (electron-updater, GitHub Releases).
//
//  Всё это вынесено из main.js, чтобы он оставался читаемым.
//  Наружу отдаётся через IPC: см. registerServices().
// ============================================================

// НОВЫЙ ФАЙЛ В 1.3: аккаунт Shikimori, анонимная статистика, автообновление.

const { app, BrowserWindow, ipcMain, net, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const settings = require('./settings');

// ---------- Аккаунт Shikimori (OAuth2) ----------
// Токены хранятся отдельно от файла данных — в зашифрованном виде (safeStorage).
// Если ОС не умеет шифровать (например, Linux без keyring) — пишем как есть,
// но отдельным файлом, чтобы резервная копия списка их не содержала.

function authPath() {
  return path.join(app.getPath('userData'), settings.AUTH_FILE);
}

function readAuth() {
  try {
    const raw = fs.readFileSync(authPath());
    let text;
    if (safeStorage.isEncryptionAvailable()) text = safeStorage.decryptString(raw);
    else text = raw.toString('utf8');
    const auth = JSON.parse(text);
    return auth && auth.access_token ? auth : null;
  } catch {
    return null;
  }
}

function writeAuth(auth) {
  try {
    const text = JSON.stringify(auth);
    const data = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(text)
      : Buffer.from(text, 'utf8');
    fs.writeFileSync(authPath(), data);
  } catch {
    // не смогли сохранить — просто не запоминаем вход
  }
}

function clearAuth() {
  try { fs.unlinkSync(authPath()); } catch { /* уже нет */ }
}

// Запрос токена: обмен кода, обновление по refresh_token
async function tokenRequest(params) {
  const res = await net.fetch(settings.SHIKIMORI_URL + '/oauth/token', {
    method: 'POST',
    headers: {
      'User-Agent': settings.USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `Shikimori не выдал токен (${res.status})`;
    try { const j = JSON.parse(text); if (j.error_description) msg += ': ' + j.error_description; } catch { /* не JSON */ }
    throw new Error(msg);
  }
  return JSON.parse(text);
}

async function fetchWithToken(urlPath, token, opts = {}) {
  const url = /^https?:/.test(urlPath) ? urlPath : settings.SHIKIMORI_URL + urlPath;
  return net.fetch(url, {
    method: opts.method || 'GET',
    headers: {
      'User-Agent': settings.USER_AGENT,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
      Authorization: 'Bearer ' + token,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

async function refreshAuth(auth) {
  if (!auth || !auth.refresh_token) throw new Error('Сессия истекла — войди заново');
  const fresh = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: auth.refresh_token,
    client_id: settings.SHIKIMORI_CLIENT_ID,
    client_secret: settings.SHIKIMORI_CLIENT_SECRET,
    redirect_uri: settings.SHIKIMORI_REDIRECT,
  });
  const next = { ...auth, ...fresh, obtainedAt: Date.now() };
  writeAuth(next);
  return next;
}

// Запрос от имени пользователя. При 401 один раз обновляем токен.
async function authFetch(urlPath, opts = {}) {
  let auth = readAuth();
  if (!auth) throw new Error('Сначала войди в аккаунт Shikimori');
  let res = await fetchWithToken(urlPath, auth.access_token, opts);
  if (res.status === 401) {
    auth = await refreshAuth(auth);
    res = await fetchWithToken(urlPath, auth.access_token, opts);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* пустой ответ / не JSON */ }
  return { status: res.status, text, json };
}

async function whoami(token) {
  const auth = token ? { access_token: token } : readAuth();
  if (!auth) return null;
  const res = await fetchWithToken('/api/users/whoami', auth.access_token);
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

// Ссылка на страницу входа — её можно открыть на телефоне и ввести код на ТВ
function authorizeUrl() {
  if (!settings.SHIKIMORI_CLIENT_ID) return '';
  return settings.SHIKIMORI_URL + '/oauth/authorize?' + new URLSearchParams({
    client_id: settings.SHIKIMORI_CLIENT_ID,
    redirect_uri: settings.SHIKIMORI_REDIRECT,
    response_type: 'code',
    scope: 'user_rates',
  }).toString();
}

// Вход: открываем страницу Shikimori, ждём страницу с кодом (redirect_uri=oob)
// и забираем код. Затем меняем его на токены.
function authorizeShikimori() {
  if (!settings.SHIKIMORI_CLIENT_ID) {
    throw new Error('В settings.js не задан SHIKIMORI_CLIENT_ID — зарегистрируй OAuth-приложение на Shikimori');
  }
  const url = authorizeUrl();

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 940,
      height: 760,
      title: 'Вход в Shikimori',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    let finished = false;

    const scan = async () => {
      if (finished || win.isDestroyed()) return;
      try {
        const text = await win.webContents.executeJavaScript(
          'document.body ? document.body.innerText : ""', true);
        const m = String(text).match(/\b[0-9a-f]{64}\b/i);
        if (!m) return;
        finished = true;
        const code = m[0];
        win.close();
        try {
          const token = await tokenRequest({
            grant_type: 'authorization_code',
            code,
            client_id: settings.SHIKIMORI_CLIENT_ID,
            client_secret: settings.SHIKIMORI_CLIENT_SECRET,
            redirect_uri: settings.SHIKIMORI_REDIRECT,
          });
          const user = await whoami(token.access_token);
          const auth = { ...token, obtainedAt: Date.now(), user };
          writeAuth(auth);
          resolve({ ok: true, user: user || null });
        } catch (err) {
          reject(err);
        }
      } catch { /* страница ещё грузится */ }
    };

    win.webContents.on('did-finish-load', scan);
    win.webContents.on('did-stop-loading', scan);
    win.on('closed', () => {
      if (!finished) {
        finished = true;
        reject(new Error('Окно входа закрыто'));
      }
    });
    win.loadURL(url);
  });
}

// Ручной вход по коду — пригодится, если окно не сработало
// (и это же используют ТВ/телефон через мост).
async function exchangeCode(code) {
  const clean = String(code || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(clean)) throw new Error('Код должен быть длинной строкой из букв a–f и цифр');
  const token = await tokenRequest({
    grant_type: 'authorization_code',
    code: clean,
    client_id: settings.SHIKIMORI_CLIENT_ID,
    client_secret: settings.SHIKIMORI_CLIENT_SECRET,
    redirect_uri: settings.SHIKIMORI_REDIRECT,
  });
  const user = await whoami(token.access_token);
  writeAuth({ ...token, obtainedAt: Date.now(), user });
  return { ok: true, user: user || null };
}

function authStatus() {
  const auth = readAuth();
  if (!auth) return { loggedIn: false };
  return {
    loggedIn: true,
    user: auth.user || null,
    expiresAt: auth.obtainedAt && auth.expires_in ? auth.obtainedAt + auth.expires_in * 1000 : null,
  };
}

// ---------- Анонимная статистика (ИЗМЕНЕНО В 1.5: Aptabase) ----------
// Интерфейс присылает событие { event, version, platform, lang, lib },
// здесь оно переводится в формат Aptabase и уходит на eu.aptabase.com.
// Никаких названий, списков, оценок, путей, ников и токенов.
// IP-адрес Aptabase не хранит (по их политике), считает «уникальных за день»
// по хэшу, который меняется каждые сутки.
const APTABASE_HOSTS = { EU: 'https://eu.aptabase.com', US: 'https://us.aptabase.com' };
const telemetrySession = Math.floor(Date.now() / 1000) + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

function telemetryEndpoint(appKey) {
  const custom = String(settings.TELEMETRY_URL || '').trim();
  if (custom) return custom;
  const region = appKey.split('-')[1];
  return APTABASE_HOSTS[region] ? `${APTABASE_HOSTS[region]}/api/v0/event` : '';
}

function osInfo() {
  const names = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' };
  let version = '';
  try { version = process.getSystemVersion(); } catch { version = require('os').release(); }
  return { osName: names[process.platform] || process.platform, osVersion: version };
}

async function sendTelemetry(payload) {
  const appKey = String(settings.TELEMETRY_APP_KEY || '').trim();
  if (!appKey) return { ok: false, disabled: true }; // ключ не задан — ничего не отправляем
  const url = telemetryEndpoint(appKey);
  if (!url) return { ok: false, disabled: true };
  const p = payload || {};
  const props = {};
  if (p.platform) props.platform = String(p.platform).slice(0, 40);
  if (Number.isFinite(p.lib)) props.lib = p.lib;
  const body = {
    timestamp: new Date().toISOString(),
    sessionId: telemetrySession,
    eventName: String(p.event || 'app_open').slice(0, 60),
    systemProps: {
      isDebug: !app.isPackaged, // запуск из исходников (npm start) — отдельно от настоящих пользователей
      locale: String(p.lang || 'ru').slice(0, 10),
      ...osInfo(),
      engineName: 'Chromium',
      engineVersion: process.versions.chrome || '',
      appVersion: String(p.version || app.getVersion()),
      sdkVersion: 'tsuzuki@' + app.getVersion(),
    },
    props,
  };
  try {
    const res = await net.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'App-Key': appKey,
        'User-Agent': settings.USER_AGENT,
      },
      body: JSON.stringify(body),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false, error: 'network' }; // статистика не должна мешать работе
  }
}

// ---------- Автообновление (ИЗМЕНЕНО В 1.6) ----------
// Своё, без сторонних библиотек: приложение читает небольшой version.json
// (адрес — settings.UPDATE_JSON_URL), сравнивает версию и, если новее:
//   Windows — тихо скачивает установщик во временную папку, сверяет SHA-256
//             и предлагает перезапуститься (тихий установщик сам запускает Tsuzuki);
//   Linux   — ничего не качает (Windows-установщик не запустить): показывает
//             «Доступна версия X» и по кнопке открывает страницу релиза в браузере.
//
// Безопасность (ИЗМЕНЕНО В 1.6): скачивание только по https и только с хостов
// из settings.UPDATE_ALLOWED_HOSTS; для локальных тестов из исходников разрешён
// http://localhost. Перед запуском файла сверяется SHA-256 из version.json.
//
// Формат version.json:
//   { "version": "1.6.0", "url": "https://…/Tsuzuki-Setup.exe",
//     "sha256": "hex…", "page": "https://…/releases", "notes": "что нового" }
let updateState = { status: 'idle' };
let pendingFile = null;
let autoTimer = null;

function compareVersions(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function setUpdaterState(patch) {
  updateState = { ...updateState, ...patch, at: Date.now() };
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.webContents.send('updater:status', updateState);
}

// «НИК» в адресах = адрес ещё не настроен, автообновление выключено
function isConfiguredUrl(url) {
  const u = String(url || '').trim();
  return !!u && !/НИК/i.test(u);
}

function isDevHost(hostname) {
  // http://localhost разрешён только для локальных тестов: при запуске из исходников
  // или если явно задана переменная окружения TSUZUKI_UPDATE_TEST=1 (только 127.0.0.1/localhost).
  const testMode = !app.isPackaged || process.env.TSUZUKI_UPDATE_TEST === '1';
  return testMode && (hostname === 'localhost' || hostname === '127.0.0.1');
}

// ИЗМЕНЕНО В 1.6: только https + список разрешённых хостов (свой сайт — в settings.js)
function urlAllowed(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol === 'https:') {
      const host = u.hostname.toLowerCase();
      const allowed = (settings.UPDATE_ALLOWED_HOSTS || []).map((h) => String(h).toLowerCase());
      return allowed.some((h) => host === h || host.endsWith('.' + h));
    }
    if (u.protocol === 'http:') return isDevHost(u.hostname);
    return false;
  } catch {
    return false;
  }
}

function releasePageOf(info) {
  return String((info && (info.page || info.url_linux)) || settings.UPDATE_PAGE || '').trim();
}

// ИЗМЕНЕНО В 1.6: «Проверять обновления автоматически» реально выключает таймер и фоновые проверки
function setUpdaterAuto(enabled) {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  if (enabled) {
    checkUpdates(false).catch(() => {});
    const hours = Math.max(1, Number(settings.UPDATE_INTERVAL_HOURS) || 6);
    autoTimer = setInterval(() => checkUpdates(false).catch(() => {}), hours * 3600 * 1000);
  } else {
    setUpdaterState({ status: 'disabled' });
  }
  return { ok: true, enabled: !!enabled };
}

async function checkUpdates(manual = false) {
  const jsonUrl = String(settings.UPDATE_JSON_URL || '').trim();
  if (!isConfiguredUrl(jsonUrl)) {
    setUpdaterState({ status: 'disabled' });
    return updateState;
  }
  if (!urlAllowed(jsonUrl)) {
    setUpdaterState({ status: 'error', error: 'host' });
    return updateState;
  }
  setUpdaterState({ status: 'checking' });
  try {
    const res = await net.fetch(jsonUrl, { headers: { 'User-Agent': settings.USER_AGENT, Accept: 'application/json', 'Cache-Control': 'no-cache' } });
    // ИЗМЕНЕНО В 1.6: пока репозиторий релизов не создан, GitHub отвечает 404.
    // Не пугаем «ошибкой» — показываем, что автообновление ещё не настроено.
    if (res.status === 404) {
      setUpdaterState({ status: 'disabled', reason: 'not-found' });
      return updateState;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const info = await res.json();
    if (compareVersions(info.version, app.getVersion()) <= 0) {
      setUpdaterState({ status: 'none', version: app.getVersion() });
      return updateState;
    }
    const notes = String(info.notes || '');
    const page = releasePageOf(info);
    if (process.platform !== 'win32') {
      // Linux: .exe не запускаем — только сообщаем и даём кнопку «Скачать» (страница релиза)
      setUpdaterState({ status: 'available', version: info.version, notes, page, platform: 'linux', manual });
      return updateState;
    }
    if (!info.url || !urlAllowed(info.url)) {
      setUpdaterState({ status: 'error', error: 'url' });
      return updateState;
    }
    setUpdaterState({ status: 'available', version: info.version, notes, page, url: info.url, sha256: String(info.sha256 || '').trim().toLowerCase(), manual });
    // тихо качаем в фоне, чтобы потом сразу предложить перезапуск
    downloadUpdate().catch(() => {});
  } catch {
    setUpdaterState({ status: 'error' });
  }
  return updateState;
}

async function downloadUpdate() {
  if (process.platform !== 'win32') return { ok: false, error: 'linux' };
  if (!updateState.url || updateState.status === 'downloading') return { ok: false };
  if (!urlAllowed(updateState.url)) {
    setUpdaterState({ status: 'error', error: 'url' });
    return { ok: false, error: 'url' };
  }
  setUpdaterState({ status: 'downloading', percent: 0 });
  try {
    const res = await net.fetch(updateState.url, { headers: { 'User-Agent': settings.USER_AGENT } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const total = Number(res.headers.get('content-length')) || 0;
    const chunks = [];
    let received = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      received += value.length;
      if (total) setUpdaterState({ status: 'downloading', percent: Math.min(99, Math.round((received / total) * 100)) });
    }
    const data = Buffer.concat(chunks);
    // ИЗМЕНЕНО В 1.6: сверяем SHA-256, чтобы не запускать подменённый файл
    const actual = require('crypto').createHash('sha256').update(data).digest('hex');
    const expected = String(updateState.sha256 || '').trim().toLowerCase();
    if (expected && actual !== expected) {
      setUpdaterState({ status: 'error', error: 'sha256' });
      return { ok: false, error: 'sha256' };
    }
    if (!expected) console.warn('[updater] в version.json нет sha256 — скачанный файл не проверен');
    const file = path.join(app.getPath('temp'), `Tsuzuki-Setup-${updateState.version}.exe`);
    fs.writeFileSync(file, data);
    pendingFile = file;
    setUpdaterState({ status: 'ready', version: updateState.version, sha256Ok: !!expected, file });
    return { ok: true, file };
  } catch (err) {
    setUpdaterState({ status: 'error' });
    return { ok: false, error: err.message };
  }
}

function installUpdate() {
  // ИЗМЕНЕНО В 1.6: на Linux установщик не запускаем — открываем страницу релиза
  if (process.platform !== 'win32') {
    const page = updateState.page || settings.UPDATE_PAGE;
    if (page && /^https?:\/\//i.test(page) && isConfiguredUrl(page)) {
      require('electron').shell.openExternal(page);
      return { ok: true, opened: true };
    }
    return { ok: false, error: 'no-page' };
  }
  if (!pendingFile || !fs.existsSync(pendingFile)) return { ok: false };
  try {
    const { spawn } = require('child_process');
    spawn(pendingFile, ['/S'], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 800);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------- Регистрация IPC ----------
function registerServices() {
  ipcMain.handle('shiki:auth-start', () => authorizeShikimori());
  ipcMain.handle('shiki:auth-url', () => authorizeUrl());
  ipcMain.handle('shiki:auth-code', (_e, code) => exchangeCode(code));
  ipcMain.handle('shiki:auth-status', () => authStatus());
  ipcMain.handle('shiki:auth-logout', () => { clearAuth(); return { ok: true }; });
  ipcMain.handle('shiki:api', (_e, { path: p, method, body } = {}) => authFetch(p || '/api/users/whoami', { method, body }));

  ipcMain.handle('telemetry:send', (_e, payload) => sendTelemetry(payload));

  // Данные о приложении для статистики и экранов «О приложении»
  ipcMain.handle('device:info', () => ({
    version: app.getVersion(),
    platform: process.platform === 'win32' ? 'win' : process.platform === 'linux' ? 'linux' : process.platform,
    isTV: false,
  }));

  ipcMain.handle('updater:check', () => checkUpdates(true));
  ipcMain.handle('updater:state', () => updateState);
  ipcMain.handle('updater:install', () => installUpdate());
  // ИЗМЕНЕНО В 1.6: настройка «Проверять обновления автоматически» управляет фоновой проверкой
  ipcMain.handle('updater:set-auto', (_e, enabled) => setUpdaterAuto(enabled));
}

module.exports = {
  registerServices,
  authFetch,
  authStatus,
  checkUpdates,
  installUpdate,
  setUpdaterAuto,
};
