// ============================================================
//  БЛОКИРОВКА РЕКЛАМЫ.
//  Сетевой adblock: отменяет запросы к рекламным и трекерным доменам
//  во всех сессиях Electron — в основном окне, внутри Kodik-iframe
//  и в окнах сервисов. Список доменов собран из EasyList и RU AdList
//  (см. adblock-domains.js). Внутреннюю «косметику» чужих сайтов не
//  трогаем: чистим только сеть.
// ============================================================

const { app, session } = require('electron');
const DOMAINS = require('./adblock-domains');

const HOSTS = new Set(DOMAINS);

// Контентные домены, которые нельзя блокировать целиком: в фильтрах есть
// широкие правила вида ||yandex.net^ / ||mail.ru^, из-за которых ломались бы
// картинки и видео в окнах сервисов. Проверяются раньше списка блокировки.
const ALLOW = new Set([
  'yandex.net', 'mail.ru', 'rambler.ru',
  'yastatic.net', 'imgsmail.ru', 'mycdn.me', 'userapi.com', 'ok.ru', 'vk.com', 'vk.ru', 'vkvideo.ru',
  'youtube.com', 'youtu.be', 'ytimg.com', 'googlevideo.com', 'ggpht.com', 'youtube-nocookie.com',
  'gstatic.com', 'googleapis.com', 'googleusercontent.com', 'google.com',
  'shikimori.io', 'shikimori.one', 'anilibria.top', 'aniliberty.top', 'libria.fun',
  'kodik.info', 'kodikplayer.com', 'kodik.biz', 'kodik-api.com', 'kodikres.com', 'kodikdb.com',
  'anime365.ru', 'smotret-anime.app',
  'kinopoisk.ru', 'hd.kinopoisk.ru', 'ivi.ru', 'okko.tv', 'wink.ru', 'rutube.ru',
  'crunchyroll.com', 'netflix.com', 'myanimelist.net', 'anilist.co', 'jikan.moe',
  'github.com', 'githubusercontent.com', 'github.io', 'npmjs.com',
]);

function isAllowed(hostname) {
  const parts = String(hostname).toLowerCase().split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    if (ALLOW.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

const wiredSessions = new Set();

let enabled = true;
let blocked = 0;
const recentBlocked = []; // последние заблокированные хосты — для диагностики

// Совпадает ли хост с рекламным доменом (или его поддоменом)
function isAdHost(hostname) {
  if (!hostname) return false;
  if (isAllowed(hostname)) return false;
  const parts = String(hostname).toLowerCase().split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    if (HOSTS.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

// Возвращает хост, если запрос надо заблокировать, иначе null
function blockedHost(url) {
  if (!enabled) return null;
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  return isAdHost(host) ? host : null;
}

function shouldBlock(url) {
  return blockedHost(url) !== null;
}

// Навешиваем обработчик на сессию один раз
function attach(ses) {
  if (!ses || wiredSessions.has(ses)) return;
  wiredSessions.add(ses);
  ses.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      const host = blockedHost(details.url);
      if (host) {
        blocked++;
        recentBlocked.push(host);
        if (recentBlocked.length > 100) recentBlocked.shift();
        callback({ cancel: true });
        return;
      }
      callback({});
    }
  );
}

// Вызывается один раз при запуске приложения, до создания окна
function install(initiallyEnabled = true) {
  enabled = !!initiallyEnabled;
  attach(session.defaultSession);
  // Окна сервисов живут в отдельной сессии (вход сохраняется между запусками)
  attach(session.fromPartition('persist:services'));
  // На случай других сессий (новые partition, webview) — подключаем на лету
  app.on('web-contents-created', (_event, contents) => {
    try {
      attach(contents.session);
    } catch {
      // сессия может быть уже уничтожена — не страшно
    }
  });
}

function setEnabled(value) {
  enabled = !!value;
  return { enabled };
}

function isEnabled() {
  return enabled;
}

function getStats() {
  return { enabled, blocked, domains: HOSTS.size, recent: [...new Set(recentBlocked)].slice(-15) };
}

module.exports = { install, setEnabled, isEnabled, getStats, isAdHost, shouldBlock };
