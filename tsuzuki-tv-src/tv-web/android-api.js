// ============================================================
//  window.api для Android TV / телефона.
//  На ПК эти функции даёт Electron (src/main/preload.js), здесь — Java-мост
//  window.AndroidBridge (app/src/main/java/.../NativeBridge.java).
//  Интерфейс (views/*.js) одинаковый для обеих версий.
//
//  ИЗМЕНЕНО В 1.3:
//   - аккаунт Shikimori (вход по коду, токены в SharedPreferences) и синхронизация;
//   - анонимная статистика (по желанию);
//   - проверка обновлений (version.json);
//   - заглушки системных функций ПК (трей, автозапуск), чтобы общий интерфейс не падал.
// ============================================================
(function () {
  'use strict';

  // Адрес Shikimori. Сменится домен — поменяй здесь.
  var SHIKIMORI_URL = 'https://shikimori.io';

  // ---------- Настройки для входа и статистики ----------
  // OAuth-приложение Shikimori (то же, что в ПК-версии): впиши client_id и client_secret.
  // Пока строки пустые — кнопка входа покажет пояснение.
  var SHIKIMORI_CLIENT_ID = '';
  var SHIKIMORI_CLIENT_SECRET = '';
  var SHIKIMORI_REDIRECT = 'urn:ietf:wg:oauth:2.0:oob';

  // Анонимная статистика (ИЗМЕНЕНО В 1.5: счётчик Aptabase, eu.aptabase.com).
  // Ключ приложения из Aptabase. Пусто — статистика выключена совсем.
  // Тот же ключ, что в ПК-версии (src/main/settings.js → TELEMETRY_APP_KEY).
  var TELEMETRY_APP_KEY = 'A-EU-5097637651';
  // Свой сервер Aptabase — впиши полный адрес '.../api/v0/event'. Пусто — по ключу.
  var TELEMETRY_URL = '';
  var TELEMETRY_SESSION = Math.floor(Date.now() / 1000) + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

  // ---------- Обновления (ИЗМЕНЕНО В 1.6) ----------
  // У ТВ и телефона разные APK и разные versionCode, поэтому и version.json
  // у каждого свой. Замени НИК на свой ник на GitHub (публичный репозиторий релизов).
  // Формат: { "versionCode": 8, "versionName": "1.6.0", "apk": "https://…apk",
  //           "sha256": "hex…", "page": "https://…/releases", "notes": "…" }
  var UPDATE_URL_TV = 'https://github.com/Svinota2/Tsuzuki/releases/latest/download/version-tv.json';
  var UPDATE_URL_PHONE = 'https://github.com/Svinota2/Tsuzuki/releases/latest/download/version-phone.json';
  // Старое имя оставлено запасным: используется, если адрес для этой платформы пуст.
  var UPDATE_URL = '';
  // Разрешённые хосты для скачивания APK (только https). Свой сайт добавь сюда.
  var UPDATE_ALLOWED_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];

  var B = window.AndroidBridge;
  // ИЗМЕНЕНО В 1.5: тип устройства берём у Android (раньше его никто не задавал,
  // и телефон считался телевизором в статистике и настройках)
  if (!window.__deviceType) {
    try { window.__deviceType = B.getDeviceType ? B.getDeviceType() : 'tv'; } catch (e) { window.__deviceType = 'tv'; }
  }
  var pending = new Map();
  var seq = 0;
  var lastUpdate = { status: 'idle' };

  // ---------- Онлайн-просмотр Kodik (ДОБАВЛЕНО В 1.6.4) ----------
  // На ПК запросы к Kodik делает главный процесс. На Android то же самое идёт
  // через Java-мост (NativeBridge.request), поэтому CORS не мешает.
  // Токен: свой из «Настроек» → сохранённый публичный → подбор из AnimeParsers.
  var KODIK_API = 'https://kodik-api.com';
  var KODIK_TOKENS_URL = 'https://raw.githubusercontent.com/YaNesyTortiK/AnimeParsers/refs/heads/main/kdk_tokns/tokens.json';
  var KODIK_CACHE_KEY = 'tsuzuki.kodik.token';
  var KODIK_UA = 'Tsuzuki/1.6.4 (anime tracker)';

  function b64utf8(s) {
    try {
      var binary = atob(String(s));
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
      return '';
    }
  }

  // Токены в AnimeParsers зашифрованы: две половины в base64, каждая перевёрнута
  function decodeKodikToken(enc) {
    var mid = Math.floor(enc.length / 2);
    var tail = b64utf8(enc.slice(0, mid).split('').reverse().join(''));
    var head = b64utf8(enc.slice(mid).split('').reverse().join(''));
    return head + tail;
  }

  function readKodikCache() {
    try {
      var raw = localStorage.getItem(KODIK_CACHE_KEY);
      if (!raw) return null;
      var j = JSON.parse(raw);
      if (!j || !j.token) return null;
      if (Date.now() - Number(j.at || 0) > 12 * 3600 * 1000) return null;
      return j;
    } catch (e) {
      return null;
    }
  }

  function saveKodikCache(token) {
    try { localStorage.setItem(KODIK_CACHE_KEY, JSON.stringify({ token: token, at: Date.now() })); } catch (e) { /* ignore */ }
  }

  function clearKodikCache() {
    try { localStorage.removeItem(KODIK_CACHE_KEY); } catch (e) { /* ignore */ }
  }

  async function kodikRequest(path, params) {
    var url = KODIK_API + path;
    var query = [];
    for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
      var v = params[k];
      if (v === undefined || v === null || v === '') continue;
      query.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
    }
    if (query.length) url += '?' + query.join('&');
    var res = await http('GET', url, { 'User-Agent': KODIK_UA, Accept: 'application/json' }, '');
    var data = null;
    try { data = JSON.parse(res.text || 'null'); } catch (e) { data = null; }
    if (res.status >= 400 || (data && data.error)) {
      throw new Error((data && data.error) || ('Kodik ответил ' + res.status + ': ' + String(res.text || '').slice(0, 200)));
    }
    return data;
  }

  async function fetchPublicKodikToken() {
    var res = await http('GET', KODIK_TOKENS_URL, { 'User-Agent': KODIK_UA, Accept: 'application/json' }, '');
    if (res.status >= 400) throw new Error('Не удалось получить список публичных токенов (HTTP ' + res.status + ')');
    var list = {};
    try { list = JSON.parse(res.text || '{}'); } catch (e) { list = {}; }
    var groups = ['stable', 'unstable'];
    for (var gi = 0; gi < groups.length; gi++) {
      var arr = list[groups[gi]] || [];
      for (var i = 0; i < arr.length; i++) {
        var token = '';
        try { token = decodeKodikToken(String(arr[i].tokn || '')); } catch (e) { token = ''; }
        if (!token) continue;
        try {
          await kodikRequest('/translations', { token: token });
          saveKodikCache(token);
          return token;
        } catch (e) {
          // токен нерабочий — пробуем следующий
        }
      }
    }
    throw new Error('Сейчас нет рабочих публичных токенов Kodik. Вставь свой в «Настройках».');
  }

  async function resolveKodikToken(fromRenderer) {
    var own = String(fromRenderer || '').trim();
    if (own) return { token: own, source: 'user' };
    var cached = readKodikCache();
    if (cached) return { token: cached.token, source: 'public' };
    return { token: await fetchPublicKodikToken(), source: 'public' };
  }

  // Запрос с токеном. Если публичный токен протух — один раз обновляем и повторяем.
  async function kodikCall(path, params, fromRenderer) {
    var resolved = await resolveKodikToken(fromRenderer);
    try {
      return { data: await kodikRequest(path, Object.assign({}, params, { token: resolved.token })), source: resolved.source };
    } catch (err) {
      if (!/токен|token/i.test(String((err && err.message) || '')) || resolved.source === 'user') throw err;
      clearKodikCache();
      var fresh = await fetchPublicKodikToken();
      return { data: await kodikRequest(path, Object.assign({}, params, { token: fresh })), source: 'public' };
    }
  }

  // Java отвечает сюда: __nativeResolve(id, успех, результат)
  window.__nativeResolve = function (id, ok, value) {
    var p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(value);
    else p.reject(new Error(value));
  };

  function call(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve, reject) {
      var id = 'r' + ++seq;
      pending.set(id, { resolve: resolve, reject: reject });
      B[method].apply(B, [id].concat(args));
    });
  }

  async function http(method, url, headers, body) {
    return call('request', method, url, JSON.stringify(headers || {}), body || '');
  }

  // ИЗМЕНЕНО В 1.6: какой version.json брать — ТВ или телефон
  function updateUrlForDevice() {
    var url = (window.__deviceType === 'phone') ? UPDATE_URL_PHONE : UPDATE_URL_TV;
    if (!url || /НИК/i.test(url)) url = UPDATE_URL; // запасной старый адрес
    return String(url || '').trim();
  }

  // ИЗМЕНЕНО В 1.6: APK качаем только по https и только с разрешённых хостов
  function updateHostAllowed(url) {
    try {
      var a = document.createElement('a');
      a.href = String(url || '');
      if (a.protocol !== 'https:') return false;
      var host = a.hostname.toLowerCase();
      for (var i = 0; i < UPDATE_ALLOWED_HOSTS.length; i++) {
        var h = String(UPDATE_ALLOWED_HOSTS[i]).toLowerCase();
        if (host === h || (host.length > h.length && host.slice(-(h.length + 1)) === '.' + h)) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  async function shiki(path, options) {
    options = options || {};
    var res = await http(options.method || 'GET', SHIKIMORI_URL + path, options.headers, options.body);
    if (res.status >= 400) throw new Error('Shikimori ответил ' + res.status + ': ' + String(res.text).slice(0, 200));
    return JSON.parse(res.text);
  }

  // ---------- Токены аккаунта (SharedPreferences через мост) ----------
  function readAuth() {
    try {
      var raw = B.loadAuth();
      if (!raw) return null;
      var a = JSON.parse(raw);
      return a && a.access_token ? a : null;
    } catch (e) { return null; }
  }
  function writeAuth(auth) {
    try { B.saveAuth(JSON.stringify(auth)); } catch (e) { /* не смогли — вход не сохранится */ }
  }
  function clearAuth() {
    try { B.clearAuth(); } catch (e) { /* ignore */ }
  }

  async function tokenRequest(params) {
    var parts = [];
    for (var k in params) parts.push(k + '=' + encodeURIComponent(params[k]));
    var res = await http('POST', SHIKIMORI_URL + '/oauth/token',
      { 'Content-Type': 'application/x-www-form-urlencoded' }, parts.join('&'));
    var json = {};
    try { json = JSON.parse(res.text || '{}'); } catch (e) { json = {}; }
    if (res.status >= 400) throw new Error(json.error_description || ('Shikimori не выдал токен (' + res.status + ')'));
    return json;
  }

  async function whoamiWith(token) {
    var res = await http('GET', SHIKIMORI_URL + '/api/users/whoami',
      { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, '');
    if (res.status >= 400) return null;
    try { return JSON.parse(res.text || 'null'); } catch (e) { return null; }
  }

  async function refreshAuth(auth) {
    if (!auth || !auth.refresh_token) throw new Error('Сессия истекла — войди заново');
    var fresh = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: auth.refresh_token,
      client_id: SHIKIMORI_CLIENT_ID,
      client_secret: SHIKIMORI_CLIENT_SECRET,
      redirect_uri: SHIKIMORI_REDIRECT,
    });
    var next = Object.assign({}, auth, fresh, { obtainedAt: Date.now() });
    writeAuth(next);
    return next;
  }

  window.api = {
    isTV: true,
    platform: (window.__deviceType === 'phone' ? 'android-phone' : 'android-tv'),

    // Данные (твой список)
    loadData: async function () { return JSON.parse(B.loadData()); },
    saveData: async function (data) { B.saveData(JSON.stringify(data)); return true; },
    dataPath: async function () { return B.dataPath(); },
    exportData: function (data) {
      var name = 'tsuzuki-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      return call('exportData', JSON.stringify(data, null, 2), name).then(function (r) { return !!r; });
    },
    importData: async function () {
      var text = await call('importData');
      return text == null ? null : JSON.parse(text);
    },

    // Импорт из других программ
    openTextFile: function () { return call('openTextFile'); },
    anilist: async function (query, variables) {
      var res = await http('POST', 'https://graphql.anilist.co', { 'Content-Type': 'application/json' },
        JSON.stringify({ query: query, variables: variables }));
      var json = JSON.parse(res.text || '{}');
      if (res.status >= 400 || (json.errors && json.errors.length)) {
        throw new Error((json.errors && json.errors[0] && json.errors[0].message) || 'AniList ответил ' + res.status);
      }
      return json.data;
    },

    // Shikimori
    graphql: function (query, variables) {
      return shiki('/api/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query, variables: variables }),
      });
    },
    shikiGet: function (path) {
      if (!String(path).startsWith('/api/')) return Promise.reject(new Error('Разрешены только пути /api/...'));
      return shiki(path);
    },

    // ---------- Аккаунт Shikimori (ИЗМЕНЕНО В 1.3) ----------
    shikiAuthUrl: async function () {
      if (!SHIKIMORI_CLIENT_ID) return '';
      return SHIKIMORI_URL + '/oauth/authorize?client_id=' + encodeURIComponent(SHIKIMORI_CLIENT_ID) +
        '&redirect_uri=' + encodeURIComponent(SHIKIMORI_REDIRECT) +
        '&response_type=code&scope=user_rates';
    },
    shikiAuthStart: async function () {
      throw new Error('На ТВ войди по коду: открой ссылку на телефоне и введи код в настройках');
    },
    shikiAuthCode: async function (code) {
      var clean = String(code || '').trim();
      if (!/^[0-9a-f]{64}$/i.test(clean)) throw new Error('Код должен быть длинной строкой из букв a–f и цифр');
      if (!SHIKIMORI_CLIENT_ID) throw new Error('В android-api.js не задан SHIKIMORI_CLIENT_ID');
      var token = await tokenRequest({
        grant_type: 'authorization_code',
        code: clean,
        client_id: SHIKIMORI_CLIENT_ID,
        client_secret: SHIKIMORI_CLIENT_SECRET,
        redirect_uri: SHIKIMORI_REDIRECT,
      });
      var user = await whoamiWith(token.access_token);
      writeAuth(Object.assign({}, token, { obtainedAt: Date.now(), user: user }));
      return { ok: true, user: user };
    },
    shikiAuthStatus: async function () {
      var auth = readAuth();
      if (!auth) return { loggedIn: false };
      return { loggedIn: true, user: auth.user || null };
    },
    shikiAuthLogout: async function () { clearAuth(); return { ok: true }; },
    shikiApi: async function (path, opts) {
      opts = opts || {};
      var auth = readAuth();
      if (!auth) throw new Error('Сначала войди в аккаунт Shikimori');
      var send = function (token) {
        return http(opts.method || 'GET', SHIKIMORI_URL + path, {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        }, opts.body ? JSON.stringify(opts.body) : '');
      };
      var res = await send(auth.access_token);
      if (res.status === 401 && auth.refresh_token) {
        auth = await refreshAuth(auth);
        res = await send(auth.access_token);
      }
      var json = null;
      try { json = JSON.parse(res.text || 'null'); } catch (e) { json = null; }
      return { status: res.status, text: res.text, json: json };
    },

    // ---------- Анонимная статистика (ИЗМЕНЕНО В 1.3) ----------
    deviceInfo: async function () {
      var version = '1.3.0';
      try { version = B.getVersionName() || version; } catch (e) { /* ignore */ }
      return {
        version: version,
        platform: (window.__deviceType === 'phone' ? 'android-phone' : 'android-tv'),
        isTV: true,
      };
    },
    // ИЗМЕНЕНО В 1.5: событие уходит в формате Aptabase. Только версия, платформа,
    // язык и число тайтлов (округлённо). Никаких идентификаторов и названий.
    telemetrySend: async function (payload) {
      var key = String(TELEMETRY_APP_KEY || '').trim();
      if (!key) return { ok: false, disabled: true };
      var hosts = { EU: 'https://eu.aptabase.com', US: 'https://us.aptabase.com' };
      var url = TELEMETRY_URL || (hosts[key.split('-')[1]] ? hosts[key.split('-')[1]] + '/api/v0/event' : '');
      if (!url) return { ok: false, disabled: true };
      var p = payload || {};
      var version = p.version || '1.5.0';
      var m = /Android\s+([\d.]+)/.exec(navigator.userAgent || '');
      var props = {};
      if (p.platform) props.platform = String(p.platform).slice(0, 40);
      if (typeof p.lib === 'number' && isFinite(p.lib)) props.lib = p.lib;
      var body = {
        timestamp: new Date().toISOString(),
        sessionId: TELEMETRY_SESSION,
        eventName: String(p.event || 'app_open').slice(0, 60),
        systemProps: {
          isDebug: false,
          locale: String(p.lang || 'ru').slice(0, 10),
          osName: 'Android',
          osVersion: m ? m[1] : '',
          engineName: 'WebView',
          engineVersion: ((/Chrome\/([\d.]+)/.exec(navigator.userAgent || '') || [])[1]) || '',
          appVersion: String(version),
          sdkVersion: 'tsuzuki@' + version,
        },
        props: props,
      };
      try {
        var res = await http('POST', url, { 'Content-Type': 'application/json', 'App-Key': key }, JSON.stringify(body));
        return { ok: res.status < 300 };
      } catch (e) {
        return { ok: false, error: 'network' };
      }
    },

    // ---------- Обновления (ИЗМЕНЕНО В 1.3; раздельные адреса и sha256 — 1.6) ----------
    checkUpdates: async function () {
      var url = updateUrlForDevice();
      if (!url) { lastUpdate = { status: 'disabled' }; return lastUpdate; }
      if (!updateHostAllowed(url)) { lastUpdate = { status: 'error', error: 'host' }; return lastUpdate; }
      try {
        var res = await http('GET', url, {}, '');
        // ИЗМЕНЕНО В 1.6: пока репозиторий релизов не создан, GitHub отвечает 404 —
        // это не ошибка, а «ещё не настроено».
        if (res.status === 404) { lastUpdate = { status: 'disabled', reason: 'not-found' }; return lastUpdate; }
        if (res.status >= 400) throw new Error('сервер');
        var info = JSON.parse(res.text || '{}');
        var current = 0;
        try { current = Number(B.getVersionCode()) || 0; } catch (e) { current = 0; }
        if (Number(info.versionCode) > current) {
          lastUpdate = {
            status: 'available',
            version: info.versionName || String(info.versionCode),
            url: info.apk,
            sha256: String(info.sha256 || ''),
            page: String(info.page || ''),
            notes: info.notes || ''
          };
        } else {
          lastUpdate = { status: 'none', version: info.versionName || '' };
        }
      } catch (e) {
        lastUpdate = { status: 'error' };
      }
      return lastUpdate;
    },
    updateState: async function () { return lastUpdate; },
    // ИЗМЕНЕНО В 1.5: APK скачивается и открывается установщик прямо из приложения.
    // ИЗМЕНЕНО В 1.6: перед этим проверяем https/хост, а SHA-256 сверяет NativeBridge.
    // Если не вышло (нет разрешения, старая прошивка) — открываем ссылку в браузере.
    manualInstall: true,
    installUpdate: async function () {
      if (!lastUpdate || !lastUpdate.url) return { ok: false };
      if (!updateHostAllowed(lastUpdate.url)) return { ok: false, error: 'host' };
      try {
        await call('downloadAndInstall', lastUpdate.url, lastUpdate.sha256 || '');
      } catch (e) {
        var msg = String((e && e.message) || '');
        if (/Разреши/.test(msg)) throw e; // пользователь сейчас даст разрешение и нажмёт ещё раз
        // ИСПРАВЛЕНО В 1.6.1: раньше при любой ошибке открывалась ссылка на сам APK —
        // и файл, не прошедший проверку SHA-256, можно было скачать браузером в обход.
        // Теперь: не совпал SHA-256 — только сообщение; другие ошибки — страница релиза.
        if (/sha|хеш|хэш|контрольн|подмен|подлинн|совпад/i.test(msg)) {
          throw new Error('Файл обновления не прошёл проверку подлинности (SHA-256) — ставить его нельзя. Попробуй позже.');
        }
        var page = String(lastUpdate.page || '');
        if (page && updateHostAllowed(page)) {
          B.openExternal(page);
          return { ok: true, opened: true };
        }
        throw new Error('Не удалось скачать обновление — попробуй позже');
      }
      return { ok: true };
    },
    onUpdate: function () { return function () {}; },

    // ДОБАВЛЕНО В 1.6.4: онлайн-просмотр Kodik на ТВ и телефоне.
    // Раньше кнопка «Смотреть онлайн» падала с «kodikSearch is not a function».
    kodikSearch: function (opts) {
      opts = opts || {};
      var rawId = String(opts.shikimoriId == null ? '' : opts.shikimoriId).trim();
      var id = /^\d+$/.test(rawId) ? rawId : '';
      var queryTitle = String(opts.title == null ? '' : opts.title).trim();
      if (!id && !queryTitle) return Promise.reject(new Error('Нужен id Shikimori или название тайтла'));
      var params = {
        with_episodes: 'true',
        with_episodes_data: 'true',
        limit: Math.max(1, Math.min(Number(opts.limit) || 100, 100)),
        types: 'anime,anime-serial',
      };
      if (id) params.shikimori_id = id; else params.title = queryTitle;
      return kodikCall('/search', params, opts.token).then(function (r) { return r.data; });
    },
    kodikCheck: function (token) {
      return kodikCall('/translations', {}, token).then(function (r) {
        var d = r.data;
        var list;
        if (Array.isArray(d)) list = d;
        else if (d && Array.isArray(d.results)) list = d.results;
        else if (d && Array.isArray(d.translations)) list = d.translations;
        else list = d ? Object.values(d) : [];
        return { count: list.length, source: r.source === 'user' ? 'user' : 'public' };
      });
    },

    // ---------- Системные функции ПК — на Android не нужны ----------
    setCloseToTray: async function () { return { ok: false }; },
    setAutostart: async function () { return { ok: false }; },
    // ИЗМЕНЕНО В 1.5: фоновая проверка новых серий (WorkManager) и проверка по кнопке
    setBackgroundNotify: async function (enabled) {
      try { B.setBackgroundNotify(!!enabled); return { ok: true }; } catch (e) { return { ok: false }; }
    },
    checkNewEpisodesNow: function () { return call('checkEpisodesNow'); },
    onNavigate: function () { return function () {}; },
    onEpisodesNews: function () { return function () {}; },

    // Папки с сериями (выбор через системное окно Android)
    pickFolder: function () { return call('pickFolder'); },
    listVideos: function (folder) { return call('listVideos', folder); },
    // ДОБАВЛЕНО В 1.5: автораскладка папки с аниме
    listSubfolders: function (root) { return call('listSubfolders', root); },

    // ДОБАВЛЕНО В 1.5: «Итоги года» — постеры и сохранение картинки
    imageDataUrl: function (url) { return call('fetchImage', url); },
    saveImage: function (dataUrl, fileName) {
      var b64 = String(dataUrl || '').replace(/^data:image\/\w+;base64,/, '');
      return call('saveImage', b64, fileName || 'tsuzuki.png');
    },

    // ДОБАВЛЕНО В 1.5: статуса в Discord на Android нет
    discordSet: async function () { return { ok: false }; },
    discordAvailable: async function () { return { configured: false }; },
    openPath: async function (p) { B.openPath(p); },

    // Сайты и сервисы открываются в браузере или приложении сервиса
    openWeb: async function (url) { B.openExternal(url); },
    openExternal: async function (url) { B.openExternal(url); },

    // ---------- Блокировка рекламы: на Android недоступна (WebView) ----------
    setAdblock: async function () { return { enabled: false }; },
    adblockStats: async function () { return { enabled: false, blocked: 0, domains: 0, recent: [] }; },
  };
})();
