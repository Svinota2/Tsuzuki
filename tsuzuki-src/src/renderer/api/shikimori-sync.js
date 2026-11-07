// ============================================================
//  СИНХРОНИЗАЦИЯ С SHIKIMORI (ИЗМЕНЕНО В 1.3).
//  Вход по аккаунту и двусторонняя синхронизация отметок/статусов/оценок.
//
//  Как работает:
//  - любое изменение в библиотеке (серия, статус, оценка) ставится в очередь
//    (store.syncQueue);
//  - через ~3 секунды после последнего изменения очередь уходит на Shikimori;
//  - при запуске и раз в CONFIG.SYNC_INTERVAL_MIN минут забираем список с сайта;
//  - если изменение сделано и там, и там — побеждает более позднее (updated_at).
//
//  Shikimori хранит только ЧИСЛО серий, поэтому при отправке считаем, сколько
//  серий просмотрено подряд (1, 2, 3, …), а при получении отмечаем 1..N.
// ============================================================

import { CONFIG } from '../config.js';
import * as store from '../store.js';
import { getAnimesByIds } from './shikimori.js';
import { toast } from '../utils.js';

const REMOTE_TO_LOCAL = {
  watching: 'watching',
  rewatching: 'watching',
  planned: 'planned',
  completed: 'completed',
  on_hold: 'on_hold',
  dropped: 'dropped',
};
const LOCAL_TO_REMOTE = {
  watching: 'watching',
  planned: 'planned',
  completed: 'completed',
  on_hold: 'on_hold',
  dropped: 'dropped',
};

let syncing = false;
let statusCache = null;
let changeTimer = null;
let autoTimer = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Вход ----------
export async function getStatus(force = false) {
  if (!window.api.shikiAuthStatus) return { loggedIn: false, unsupported: true };
  if (statusCache && !force) return statusCache;
  try {
    statusCache = await window.api.shikiAuthStatus();
  } catch {
    statusCache = { loggedIn: false };
  }
  return statusCache;
}

export async function login() {
  const res = await window.api.shikiAuthStart();
  statusCache = { loggedIn: true, user: res?.user || null };
  toast('Вход в Shikimori выполнен', 'ok');
  setTimeout(() => { syncNow({ silent: true }).catch(() => {}); }, 1000);
  return res;
}

// Вход по коду: для ТВ/телефона и на случай, если окно не открылось
export async function loginWithCode(code) {
  const res = await window.api.shikiAuthCode(code);
  statusCache = { loggedIn: true, user: res?.user || null };
  toast('Вход в Shikimori выполнен', 'ok');
  setTimeout(() => { syncNow({ silent: true }).catch(() => {}); }, 1000);
  return res;
}

export async function logout() {
  await window.api.shikiAuthLogout();
  statusCache = { loggedIn: false };
  toast('Вы вышли из аккаунта Shikimori');
}

// ---------- Преобразования ----------
export function maxConsecutive(watched) {
  const set = new Set((watched || []).map(Number));
  let n = 0;
  while (set.has(n + 1)) n++;
  return n;
}

function localStatus(remote) {
  return REMOTE_TO_LOCAL[remote] || (remote === 'rewatching' ? 'watching' : null);
}

function pushStatus(entry, episodes) {
  if (entry.status && LOCAL_TO_REMOTE[entry.status]) return LOCAL_TO_REMOTE[entry.status];
  if (episodes > 0) return 'watching';
  return 'planned';
}

// ---------- Отправка одного изменения ----------
async function pushEntry(id) {
  const entry = store.getEntry(id);
  if (!entry || entry.manual) { store.removeFromSyncQueue([id]); return; }

  const episodes = maxConsecutive(entry.watched);
  const rate = {
    status: pushStatus(entry, episodes),
    episodes,
    score: Number(entry.score) || 0,
    rewatches: Number(entry.rewatches) || 0,
  };

  let res;
  if (entry.shikiRateId) {
    res = await window.api.shikiApi('/api/v2/user_rates/' + entry.shikiRateId, {
      method: 'PATCH',
      body: { user_rate: rate },
    });
  } else {
    res = await window.api.shikiApi('/api/v2/user_rates', {
      method: 'POST',
      body: { user_rate: { ...rate, target_id: Number(entry.id), target_type: 'Anime' } },
    });
  }
  if (!res || res.status >= 400) {
    let detail = '';
    try { detail = res && res.json && (res.json.errors || res.json.error) ? JSON.stringify(res.json.errors || res.json.error) : (res?.text || '').slice(0, 120); } catch { /* ignore */ }
    throw new Error('Shikimori не принял изменение по «' + (entry.title || entry.id) + '»: ' + (detail || res?.status));
  }
  const saved = (res.json && (res.json.user_rate || res.json)) || {};
  store.setShikiRate(id, {
    shikiRateId: saved.id || entry.shikiRateId,
    shikiUpdatedAt: saved.updated_at || new Date().toISOString(),
    rewatches: saved.rewatches !== undefined ? saved.rewatches : rate.rewatches,
  });
  store.removeFromSyncQueue([id]);
}

// ---------- Применение одного изменения с сайта ----------
async function applyRemote(rate, animeData) {
  const id = String(rate.target_id);
  const entry = store.getEntry(id);
  const mapped = localStatus(rate.status);
  const episodes = Number(rate.episodes) || 0;

  if (!entry) {
    if (!animeData) return; // нет карточки — не из чего создать запись
    const created = store.ensureEntry(animeData);
    if (mapped) store.setStatus(animeData, mapped);
    if (episodes > 0) store.markUpTo(animeData, episodes);
    if (Number(rate.score)) store.setScore(animeData, Number(rate.score));
    store.setShikiRate(created.id, {
      shikiRateId: rate.id,
      shikiUpdatedAt: rate.updated_at,
      rewatches: Number(rate.rewatches) || 0,
    });
    // изменения только что созданы нами — убираем из очереди, чтобы не отправлять обратно
    store.removeFromSyncQueue([created.id]);
    return;
  }

  // Свои изменения ещё не отправлены — они важнее
  if (store.getSyncQueue().includes(id)) {
    store.setShikiRate(id, { shikiRateId: rate.id, rewatches: Number(rate.rewatches) || 0 });
    return;
  }

  const remoteTime = String(rate.updated_at || '');
  const localTime = String(entry.updatedAt || '');
  const remoteNewer = !entry.shikiUpdatedAt || remoteTime > localTime;

  if (remoteNewer) {
    if (mapped && mapped !== entry.status) {
      // ставим напрямую, чтобы не пересчитывать серии
      store.setStatus(store.getEntry(id) || entry, mapped);
    }
    if (episodes > 0 && maxConsecutive(entry.watched) !== episodes) {
      store.markUpTo(store.getEntry(id) || entry, episodes);
    }
    if (Number(rate.score) && Number(rate.score) !== entry.score) {
      store.setScore(store.getEntry(id) || entry, Number(rate.score));
    }
    // после применения «локальных» изменений очередь не нужна
    store.removeFromSyncQueue([id]);
  }

  store.setShikiRate(id, {
    shikiRateId: rate.id,
    shikiUpdatedAt: remoteTime || new Date().toISOString(),
    rewatches: Number(rate.rewatches) || 0,
  });
}

// ---------- Полный проход ----------
export async function syncNow({ silent = false } = {}) {
  if (syncing) return { ok: false, busy: true };
  const status = await getStatus();
  if (!status.loggedIn) return { ok: false, notLoggedIn: true };
  const userId = status.user && status.user.id;
  if (!userId) return { ok: false, error: 'Не удалось узнать id пользователя' };

  syncing = true;
  try {
    // 1. Отправляем накопленные изменения
    const queue = store.getSyncQueue();
    for (const id of queue) {
      await pushEntry(id);
      await sleep(CONFIG.SYNC_REQUEST_PAUSE_MS);
    }

    // 2. Забираем список с сайта постранично
    const limit = CONFIG.SYNC_PAGE_SIZE;
    let page = 1;
    let all = [];
    while (page <= 30) {
      const res = await window.api.shikiApi(
        `/api/v2/user_rates?user_id=${encodeURIComponent(userId)}&target_type=Anime&limit=${limit}&page=${page}`);
      if (!res || res.status >= 400) throw new Error('Shikimori не отдал список (код ' + (res?.status || '?') + ')');
      const list = Array.isArray(res.json) ? res.json : [];
      all = all.concat(list);
      if (list.length < limit) break;
      page++;
      await sleep(CONFIG.SYNC_REQUEST_PAUSE_MS);
    }

    // 3. Карточки тайтлов, которых ещё нет в библиотеке
    const known = new Set(Object.keys(store.getState().library));
    const missing = [...new Set(all.map((r) => String(r.target_id)))].filter((id) => !known.has(id));
    let animes = [];
    if (missing.length) {
      try { animes = await getAnimesByIds(missing.slice(0, 100)); } catch { animes = []; }
    }
    const byId = new Map((animes || []).map((a) => [String(a.id), a]));

    // 4. Применяем
    for (const rate of all) {
      try {
        await applyRemote(rate, byId.get(String(rate.target_id)));
      } catch (err) {
        console.warn('Синхронизация: не удалось применить запись', rate && rate.target_id, err);
      }
    }

    store.setSyncLast(new Date().toISOString());
    if (!silent) toast(`Синхронизировано: ${all.length} записей`, 'ok');
    return { ok: true, count: all.length, user: status.user };
  } catch (err) {
    if (!silent) toast(err.message || 'Не удалось синхронизировать', 'error');
    return { ok: false, error: err.message };
  } finally {
    syncing = false;
  }
}

// ---------- Автоматическая синхронизация ----------
export function startAutoSync() {
  if (!window.api.shikiAuthStatus) return;

  // После изменений: через ~3 секунды (как просит Shikimori — не спамить)
  store.onChange(() => {
    if (!store.getSyncQueue().length) return;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(async () => {
      const status = await getStatus();
      if (status.loggedIn) syncNow({ silent: true }).catch(() => {});
    }, 3000);
  });

  // Раз в CONFIG.SYNC_INTERVAL_MIN минут
  const minutes = Math.max(1, Number(CONFIG.SYNC_INTERVAL_MIN) || 15);
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = setInterval(async () => {
    const status = await getStatus();
    if (status.loggedIn) syncNow({ silent: true }).catch(() => {});
  }, minutes * 60 * 1000);

  // При запуске — через 6 секунд, чтобы не мешать загрузке
  setTimeout(async () => {
    const status = await getStatus();
    if (status.loggedIn) syncNow({ silent: true }).catch(() => {});
  }, 6000);
}
