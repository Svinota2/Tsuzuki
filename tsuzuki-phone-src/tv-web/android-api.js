// ============================================================
//  window.api для Android TV.
//  На ПК эти функции даёт Electron (src/main/preload.js), здесь — Java-мост
//  window.AndroidBridge (app/src/main/java/.../NativeBridge.java).
//  Интерфейс (views/*.js) одинаковый для обеих версий.
//
//  Kodik (онлайн-просмотр) работает и на ТВ: запросы к kodik-api.com идут
//  через Java-мост (как Shikimori), токен подбирается автоматически так же,
//  как на ПК. Блокировка рекламы на ТВ недоступна (WebView не перехватывает
//  сеть) — в настройках эта вкладка скрыта, сами запросы-заглушки на месте.
// ============================================================
(function () {
  'use strict';

  // Адрес Shikimori. Сменится домен — поменяй здесь.
  var SHIKIMORI_URL = 'https://shikimori.io';

  var B = window.AndroidBridge;
  var pending = new Map();
  var seq = 0;

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

  async function shiki(path, options) {
    options = options || {};
    var res = await http(options.method || 'GET', SHIKIMORI_URL + path, options.headers, options.body);
    if (res.status >= 400) throw new Error('Shikimori ответил ' + res.status + ': ' + String(res.text).slice(0, 200));
    return JSON.parse(res.text);
  }

  // ============================================================
  //  Kodik — онлайн-просмотр с озвучками (восстановлено).
  //  Логика та же, что в ПК-версии (src/main/main.js).
  // ============================================================
  var KODIK_API = 'https://kodik-api.com';
  var KODIK_TOKENS_URL = 'https://raw.githubusercontent.com/YaNesyTortiK/AnimeParsers/refs/heads/main/kdk_tokns/tokens.json';
  var kodikAutoToken = null; // { token, at }

  // Токены в AnimeParsers зашифрованы: две половины в base64, каждая перевёрнута
  function decodeKodikToken(enc) {
    var mid = Math.floor(enc.length / 2);
    var tail = atob(enc.slice(0, mid).split('').reverse().join(''));
    var head = atob(enc.slice(mid).split('').reverse().join(''));
    return head + tail;
  }

  async function kodikFetch(path, params) {
    var u = KODIK_API + path + '?';
    var q = [];
    for (var k in params) {
      if (params[k] != null && params[k] !== '') q.push(k + '=' + encodeURIComponent(String(params[k])));
    }
    u += q.join('&');
    var res = await http('GET', u, {}, '');
    var data = null;
    try { data = JSON.parse(res.text || '{}'); } catch (e) { data = null; }
    if (res.status >= 400 || (data && data.error)) {
      throw new Error((data && data.error) || ('Kodik ответил ' + res.status));
    }
    return data;
  }

  async function fetchKodikAutoToken() {
    var res = await http('GET', KODIK_TOKENS_URL, {}, '');
    var list = JSON.parse(res.text || '{}');
    var groups = ['stable', 'unstable'];
    for (var g = 0; g < groups.length; g++) {
      var arr = list[groups[g]] || [];
      for (var i = 0; i < arr.length; i++) {
        var token = '';
        try { token = decodeKodikToken(String(arr[i].tokn || '')); } catch (e) { continue; }
        if (!token) continue;
        try {
          await kodikFetch('/translations', { token: token });
          kodikAutoToken = { token: token, at: Date.now() };
          return token;
        } catch (e) { /* токен нерабочий — пробуем следующий */ }
      }
    }
    throw new Error('Сейчас нет рабочих публичных токенов Kodik. Вставь свой в «Настройках».');
  }

  async function resolveKodikToken(userToken) {
    var own = String(userToken || '').trim();
    if (own) return { token: own, source: 'user' };
    if (kodikAutoToken && Date.now() - kodikAutoToken.at < 12 * 3600 * 1000) {
      return { token: kodikAutoToken.token, source: 'public' };
    }
    return { token: await fetchKodikAutoToken(), source: 'public' };
  }

  window.api = {
    isTV: true,
    platform: 'android',

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

    // ---------- Kodik (онлайн-просмотр с озвучками) ----------
    kodikSearch: async function (params) {
      params = params || {};
      var run = async function () {
        var r = await resolveKodikToken(params.token);
        var q = {
          token: r.token,
          with_episodes: 'true',
          with_episodes_data: 'true',
          limit: Math.max(1, Math.min(Number(params.limit) || 100, 100)),
          types: 'anime,anime-serial'
        };
        var id = String(params.shikimoriId || '').trim();
        if (/^\d+$/.test(id)) q.shikimori_id = id;
        else q.title = String(params.title || '').trim();
        if (!q.shikimori_id && !q.title) throw new Error('Нужен id Shikimori или название тайтла');
        return await kodikFetch('/search', q);
      };
      try {
        return await run();
      } catch (e) {
        // публичный токен мог протухнуть — перезапрашиваем и пробуем ещё раз
        if (!String(params.token || '').trim() && /токен|token/i.test(String(e && e.message || ''))) {
          kodikAutoToken = null;
          return await run();
        }
        throw e;
      }
    },

    kodikCheck: async function (token) {
      var r = await resolveKodikToken(token);
      var data = await kodikFetch('/translations', { token: r.token });
      var list = Array.isArray(data) ? data : (data.results || data.translations || Object.values(data || {}));
      return { count: list.length, source: r.source === 'user' ? 'user' : 'public' };
    },

    // Окно плеера: на ТВ отдельного окна нет — открываем плеер в браузере/приложении
    openPlayer: async function (url) { B.openExternal(url); },

    // Папки с сериями (выбор через системное окно Android)
    pickFolder: function () { return call('pickFolder'); },
    listVideos: function (folder) { return call('listVideos', folder); },
    openPath: async function (p) { B.openPath(p); },

    // Сайты и сервисы открываются в браузере или приложении сервиса
    openWeb: async function (url) { B.openExternal(url); },
    openExternal: async function (url) { B.openExternal(url); },

    // ---------- Блокировка рекламы: на ТВ недоступна (WebView) ----------
    // Заглушки нужны, чтобы общий интерфейс не падал. В настройках вкладка скрыта (isTV).
    setAdblock: async function (enabled) { return { enabled: false }; },
    adblockStats: async function () { return { enabled: false, blocked: 0, domains: 0, recent: [] }; },
  };
})();
