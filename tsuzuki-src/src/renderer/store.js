// ============================================================
//  ТРЕКЕР: всё, что связано с твоим списком.
//  Данные хранятся в одном JSON-файле (путь — в «Настройках»).
//
//  Как выглядит одна запись в library:
//  {
//    id: 52991,                 // id тайтла на Shikimori
//    title: 'Фрирен', name: 'Sousou no Frieren',
//    poster: 'https://...', kind: 'tv', year: 2023,
//    episodes: 28,              // всего серий (0 — неизвестно)
//    episodesAired: 28,         // сколько уже вышло
//    animeStatus: 'released',   // статус выхода на Shikimori
//    status: 'watching',        // ТВОЙ статус (см. CONFIG.STATUSES) или null
//    watched: [1, 2, 3],        // номера просмотренных серий
//    score: 9,                  // твоя оценка 1–10, 0 — нет оценки
//    folder: 'D:\\Anime\\Frieren', // папка с сериями на диске
//    positions: { 'файл.mkv': 512 }, // где остановился в каждом файле (сек)
//    addedAt, updatedAt         // даты
//  }
// ============================================================

// ------------------------------------------------------------
//  ИЗМЕНЕНО В 1.1 (Claude, 02.11.2026):
//  - ensureEntry: + franchise, shikiScore, airedDate, metaAt
//  - getContinueWatching с настройками, hideContinue, clearContinue
//  - importRates — общий импорт (MAL, AniList, Shikimori)
//  - entriesMissingMeta / applyMeta — дозаполнение старых записей
// ------------------------------------------------------------

import { CONFIG } from './config.js';
import { titleOf } from './utils.js';

const EMPTY = () => ({
  version: 2,
  library: {},          // id → запись (см. выше)
  history: [],          // последние просмотренные серии
  prefs: {
    accent: null, kodikToken: null, showAdult: false,
    // ИЗМЕНЕНО В 1.3: согласие на анонимную статистику (null — ещё не выбрано)
    telemetry: null,
  },
  online: {},           // id → последняя озвучка/серия в онлайн-плеере
  // ИЗМЕНЕНО В 1.3: анонимная статистика, рекомендации, очередь синхронизации
  installId: null,      // случайный UUID установки (для статистики и синхронизации)
  telemetryLast: null,  // дата последней отправки app_open (ГГГГ-ММ-ДД)
  recs: null,           // кеш рекомендаций: { at: время, list: [...] }
  hiddenRecs: [],       // id рекомендаций, скрытых кнопкой «Не интересно»
  syncQueue: [],        // id записей, которые нужно отправить на Shikimori
  syncLast: null,       // время последней успешной синхронизации
  // ДОБАВЛЕНО В 1.4
  achievements: {},     // id достижения → дата получения
  rouletteHistory: [],  // последние 5 id из рулетки — чтобы не повторялись
  collections: [],      // свои подборки: [{ id, name, color, ids: [] }]
  // ДОБАВЛЕНО В 1.5: статистика по дням — для «Итогов года»
  // byDay: { 'ГГГГ-ММ-ДД': { episodes, minutes, ids: [id тайтлов] } }
  stats: { byDay: {} },
});

let state = EMPTY();
const listeners = new Set();
let saveTimer = null;

// Приведение данных к актуальной версии: чинит старые/импортированные
// бэкапы, где нет watched, positions и т.п. Без этого интерфейс падал.
function normalize(data) {
  const fixed = { ...EMPTY(), ...(data && typeof data === 'object' ? data : {}) };
  if (!fixed.library || typeof fixed.library !== 'object') fixed.library = {};
  if (!Array.isArray(fixed.history)) fixed.history = [];
  if (!fixed.prefs || typeof fixed.prefs !== 'object') fixed.prefs = {};
  if (fixed.prefs.accent === undefined) fixed.prefs.accent = null;
  if (fixed.prefs.kodikToken === undefined) fixed.prefs.kodikToken = null;
  if (fixed.prefs.showAdult === undefined) fixed.prefs.showAdult = false;
  // ИЗМЕНЕНО В 1.3: значения по умолчанию для новых настроек
  if (fixed.prefs.telemetry === undefined) fixed.prefs.telemetry = null;
  if (!fixed.online || typeof fixed.online !== 'object') fixed.online = {};
  if (typeof fixed.telemetryLast !== 'string') fixed.telemetryLast = null;
  if (!fixed.recs || typeof fixed.recs !== 'object') fixed.recs = null;
  if (!Array.isArray(fixed.hiddenRecs)) fixed.hiddenRecs = [];
  if (!Array.isArray(fixed.syncQueue)) fixed.syncQueue = [];
  if (typeof fixed.syncLast !== 'string') fixed.syncLast = null;
  // ДОБАВЛЕНО В 1.4: достижения, рулетка, подборки
  if (!fixed.achievements || typeof fixed.achievements !== 'object') fixed.achievements = {};
  if (!Array.isArray(fixed.rouletteHistory)) fixed.rouletteHistory = [];
  if (!Array.isArray(fixed.collections)) fixed.collections = [];
  // ДОБАВЛЕНО В 1.5: статистика по дням
  if (!fixed.stats || typeof fixed.stats !== 'object') fixed.stats = {};
  if (!fixed.stats.byDay || typeof fixed.stats.byDay !== 'object') fixed.stats.byDay = {};
  fixed.collections = fixed.collections
    .filter((c) => c && typeof c === 'object' && c.name)
    .map((c) => ({ id: String(c.id || c.name), name: String(c.name), color: c.color || '#ff5d48', ids: Array.isArray(c.ids) ? c.ids.map(String) : [] }));

  for (const [key, entry] of Object.entries(fixed.library)) {
    if (!entry || typeof entry !== 'object') { delete fixed.library[key]; continue; }
    entry.id = Number(entry.id) || Number(key) || 0;
    entry.watched = [...new Set((Array.isArray(entry.watched) ? entry.watched : [])
      .map(Number).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
    if (!entry.positions || typeof entry.positions !== 'object') entry.positions = {};
    entry.score = Number(entry.score) || 0;
    entry.episodes = Number(entry.episodes) || 0;
    entry.episodesAired = Number(entry.episodesAired) || entry.episodes || 0;
    if (entry.status === undefined) entry.status = null;
    if (!entry.title) entry.title = entry.name || 'Без названия';
    if (!entry.addedAt) entry.addedAt = entry.updatedAt || new Date().toISOString();
    if (!entry.updatedAt) entry.updatedAt = entry.addedAt;
    // ДОБАВЛЕНО В 1.4: заметка к тайтлу
    if (typeof entry.note !== 'string') entry.note = '';
  }
  fixed.version = 2;
  return fixed;
}

// ---------- Загрузка / сохранение ----------
export async function initStore() {
  const saved = await window.api.loadData();
  if (saved && typeof saved === 'object') state = normalize(saved);
}

function persist() {
  // сохраняем не на каждый клик, а раз в 300 мс — так быстрее
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.api.saveData(state), 300);
  listeners.forEach((fn) => fn());
}

// Подписка на изменения: onChange(() => перерисовать()) — вернёт функцию отписки
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getState = () => state;
export const getEntry = (id) => state.library[String(id)] || null;
export const getPrefs = () => state.prefs;

export function setPref(key, value) {
  state.prefs[key] = value;
  persist();
}

// Все записи, по желанию — только с нужным статусом. Свежие сверху.
export function listEntries(status) {
  const all = Object.values(state.library)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  if (status === 'all') return all; // «Все» — включая записи без статуса
  return status ? all.filter((e) => e.status === status) : all.filter((e) => e.status);
}

export function countByStatus() {
  const counts = Object.fromEntries(CONFIG.STATUSES.map((s) => [s.id, 0]));
  for (const e of Object.values(state.library)) if (e.status in counts) counts[e.status]++;
  return counts;
}

// ---------- Создание и обновление записи ----------
// anime — объект с Shikimori (из каталога или страницы тайтла)
export function ensureEntry(anime) {
  const id = String(anime.id);
  const now = new Date().toISOString();
  const prev = state.library[id];
  state.library[id] = {
    status: null,
    watched: [],
    score: 0,
    folder: null,
    positions: {},
    addedAt: now,
    ...prev,
    // свежие сведения о тайтле всегда обновляем
    id: Number(anime.id),
    title: titleOf(anime),
    name: anime.name || prev?.name || '',
    poster: anime.poster?.mainUrl || prev?.poster || '',
    kind: anime.kind || prev?.kind,
    year: anime.airedOn?.year || prev?.year,
    episodes: anime.episodes ?? prev?.episodes ?? 0,
    episodesAired: anime.episodesAired ?? prev?.episodesAired ?? 0,
    animeStatus: anime.status || prev?.animeStatus,
    duration: anime.duration ?? prev?.duration ?? 0,
    nextEpisodeAt: anime.nextEpisodeAt ?? prev?.nextEpisodeAt ?? null,
    // для склейки сезонов и сравнения с оценками Shikimori
    franchise: anime.franchise ?? prev?.franchise ?? null,
    shikiScore: Number(anime.score) || prev?.shikiScore || 0,
    airedDate: anime.airedOn?.date || prev?.airedDate || null,
    metaAt: 'franchise' in anime ? now : prev?.metaAt || null, // когда сведения пришли с Shikimori
    // ДОБАВЛЕНО В 1.5: id жанров — для любимых жанров в «Итогах года»
    genreIds: Array.isArray(anime.genres) ? anime.genres.map((g) => String(g.id)) : prev?.genreIds || null,
  };
  return state.library[id];
}

// ---------- Онлайн-просмотр: где остановился ----------
// id → { tr, trTitle, season, episode, title, poster, kind, animeStatus, at }
export function setOnlineState(id, patch) {
  const key = String(id);
  state.online[key] = {
    ...(state.online[key] || {}),
    hidden: false, // снова открыл — снова показываем в «Продолжить просмотр»
    ...patch,
    at: new Date().toISOString(),
  };
  persist();
}

export const getOnlineState = (id) => state.online[String(id)] || null;

// Последние открытые серии — для блока «Продолжить просмотр».
// Что прятать, настраивается в CONFIG (и в «Настройках» → «Главная»).
export function getContinueWatching(limit = CONFIG.CONTINUE_LIMIT) {
  const maxAge = CONFIG.CONTINUE_MAX_DAYS > 0 ? CONFIG.CONTINUE_MAX_DAYS * 86400000 : Infinity;
  const now = Date.now();
  return Object.entries(state.online || {})
    .map(([id, v]) => ({ id, ...v }))
    .filter((v) => v && v.episode && v.title && !v.hidden)
    .filter((v) => now - new Date(v.at || 0).getTime() <= maxAge)
    .filter((v) => !(CONFIG.CONTINUE_HIDE_COMPLETED && getEntry(v.id)?.status === 'completed'))
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, limit);
}

// Убрать один тайтл из «Продолжить просмотр» (место, где остановился, не теряется)
export function hideContinue(id) {
  const v = state.online[String(id)];
  if (!v) return;
  v.hidden = true;
  persist();
}

// Убрать всё из «Продолжить просмотр»
export function clearContinue() {
  for (const v of Object.values(state.online || {})) if (v) v.hidden = true;
  persist();
}

// Обновить сведения о вышедших сериях, не трогая статус и отметки.
// Возвращает true, если серий стало больше, чем было записано.
export function updateAired(anime) {
  const e = getEntry(anime.id);
  if (!e) return false;

  const prev = Number(e.episodesAired) || 0;
  const next = Number(anime.episodesAired) || prev;
  e.episodes = anime.episodes ?? e.episodes;
  e.episodesAired = next;
  e.animeStatus = anime.status || e.animeStatus;
  e.nextEpisodeAt = anime.nextEpisodeAt ?? e.nextEpisodeAt ?? null;
  touch(e);
  return next > prev;
}

function touch(entry) {
  entry.updatedAt = new Date().toISOString();
  persist();
}

export function setStatus(anime, status) {
  const e = ensureEntry(anime);
  if (status === 'completed' && e.status !== 'completed') e.completedAt = new Date().toISOString(); // ДОБАВЛЕНО В 1.5
  e.status = status;
  // «Просмотрено» — отмечаем все серии разом
  if (status === 'completed' && e.episodes) e.watched = range(1, e.episodes);
  pushSync(e.id); // ИЗМЕНЕНО В 1.3: на синхронизацию
  touch(e);
}

export function setScore(anime, score) {
  const e = ensureEntry(anime);
  e.score = Number(score) || 0;
  pushSync(e.id); // ИЗМЕНЕНО В 1.3: на синхронизацию
  touch(e);
}

export function setFolder(anime, folder) {
  const e = ensureEntry(anime);
  e.folder = folder;
  touch(e);
}

export function removeEntry(id) {
  delete state.library[String(id)];
  delete state.online[String(id)];
  persist();
}

// ---------- Свои записи (тайтлы, которых нет на Shikimori) ----------
// Отрицательные id не пересекаются с настоящими id Shikimori.
export function addManual(data) {
  let id = -1;
  while (state.library[String(id)]) id--;

  const now = new Date().toISOString();
  const episodes = Math.max(0, Number(data.episodes) || 0);
  state.library[String(id)] = {
    id,
    manual: true,
    title: String(data.title || '').trim() || 'Без названия',
    name: String(data.name || '').trim(),
    poster: String(data.poster || '').trim(),
    kind: data.kind || 'tv',
    year: Number(data.year) || null,
    episodes,
    episodesAired: episodes,
    animeStatus: 'released',
    status: data.status || null,
    watched: [],
    score: 0,
    folder: null,
    positions: {},
    description: String(data.description || '').trim(),
    duration: Math.max(0, Number(data.duration) || 0),
    addedAt: now,
    updatedAt: now,
  };
  persist();
  return id;
}

export function updateManual(id, data) {
  const e = getEntry(id);
  if (!e?.manual) return false;

  e.title = String(data.title || '').trim() || e.title;
  e.name = String(data.name || '').trim();
  e.poster = String(data.poster || '').trim();
  e.kind = data.kind || e.kind;
  e.year = Number(data.year) || null;
  e.episodes = Math.max(0, Number(data.episodes) || 0);
  e.episodesAired = e.episodes;
  e.description = String(data.description || '').trim();
  e.duration = Math.max(0, Number(data.duration) || 0);
  if (data.status !== undefined) e.status = data.status || null;
  touch(e);
  return true;
}

// ---------- Серии ----------
export const isWatched = (id, ep) => !!getEntry(id)?.watched.includes(ep);
export const watchedCount = (id) => getEntry(id)?.watched.length || 0;

export function setEpisodeWatched(anime, ep, watched = true) {
  const e = ensureEntry(anime);
  const set = new Set(e.watched);
  watched ? set.add(ep) : set.delete(ep);
  e.watched = [...set].sort((a, b) => a - b);

  if (watched) {
    state.history.unshift({ id: e.id, title: e.title, episode: ep, at: new Date().toISOString() });
    state.history = state.history.slice(0, 200); // храним последние 200
    countDay(e); // ДОБАВЛЕНО В 1.5: копим статистику по дням (история хранит только 200)
  }
  autoStatus(e);
  pushSync(e.id); // ИЗМЕНЕНО В 1.3: на синхронизацию
  touch(e);
}

export const toggleEpisode = (anime, ep) => setEpisodeWatched(anime, ep, !isWatched(anime.id, ep));

// Отметить все серии с 1 по n (как «досмотрел до n-й»)
export function markUpTo(anime, n) {
  const e = ensureEntry(anime);
  e.watched = range(1, n);
  autoStatus(e);
  pushSync(e.id); // ИЗМЕНЕНО В 1.3: на синхронизацию
  touch(e);
}

// Следующая непросмотренная серия
export function nextEpisode(id) {
  const e = getEntry(id);
  if (!e) return 1;
  let n = 1;
  while (e.watched.includes(n)) n++;
  return n;
}

function autoStatus(e) {
  if (!CONFIG.AUTO_STATUS) return;
  const done = e.episodes && e.watched.length >= e.episodes;
  if (done && e.status !== 'completed') e.completedAt = new Date().toISOString(); // ДОБАВЛЕНО В 1.5
  if (done) e.status = 'completed';
  else if (e.watched.length && (!e.status || e.status === 'planned' || e.status === 'completed')) e.status = 'watching';
}

// ---------- Позиция в файле (для «продолжить с места») ----------
export function savePosition(id, fileName, seconds) {
  const e = getEntry(id);
  if (!e) return;
  if (!e.positions || typeof e.positions !== 'object') e.positions = {};
  e.positions[fileName] = Math.floor(seconds);
  // позицию сохраняем тихо, без перерисовки интерфейса
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.api.saveData(state), 300);
}
export const getPosition = (id, fileName) => getEntry(id)?.positions?.[fileName] || 0;

// ---------- Резервная копия и импорт ----------
export const exportBackup = () => window.api.exportData(state);

export async function importBackup() {
  const data = await window.api.importData();
  if (!data) return false;
  if (!data.library) throw new Error('Это не похоже на резервную копию Tsuzuki');
  state = normalize(data);
  persist();
  return true;
}

// Импорт списка из любой программы. rates — массив
// { anime (объект Shikimori), status, episodes, score, updatedAt }.
// Отмечаем серии с 1 по episodes. «rewatching» считаем как «Смотрю».
// mode: 'overwrite' — перезаписать совпадающие тайтлы, 'skip' — не трогать то, что уже есть.
export function importRates(rates, mode = 'overwrite') {
  let added = 0, skipped = 0;
  const allowed = new Set(CONFIG.STATUSES.map((s) => s.id));
  for (const r of rates) {
    if (!r.anime) continue;
    if (mode === 'skip' && getEntry(r.anime.id)?.status) { skipped++; continue; }
    const e = ensureEntry(r.anime);
    const status = r.status === 'rewatching' ? 'watching' : r.status;
    e.status = allowed.has(status) ? status : 'planned';
    const eps = Math.max(0, Number(r.episodes) || 0);
    e.watched = range(1, e.episodes ? Math.min(eps, e.episodes) : eps);
    if (r.score) e.score = Math.round(Number(r.score)) || 0;
    e.updatedAt = r.updatedAt || new Date().toISOString();
    added++;
  }
  persist();
  return { added, skipped };
}

// Старое имя — оставлено, чтобы не ломать вызовы
export const importShikimoriRates = (rates) => importRates(rates).added;

// ---------- Дозаполнение сведений у старых записей ----------
// Записи, у которых нет франшизы или оценки Shikimori (созданы до обновления)
export const entriesMissingMeta = () =>
  Object.values(state.library).filter((e) => !e.manual && e.id > 0 && !e.metaAt);

// list — короткие объекты Shikimori (getAnimesByIds)
export function applyMeta(list) {
  for (const a of list) {
    const e = getEntry(a.id);
    if (!e) continue;
    e.franchise = a.franchise || null;
    e.shikiScore = Number(a.score) || 0;
    e.airedDate = a.airedOn?.date || e.airedDate || null;
    e.metaAt = new Date().toISOString();
  }
  persist();
}

// Помечаем попытку получить сведения: если на Shikimori тайтла нет,
// не спрашиваем его снова при каждом запуске.
export function markMetaAttempted(ids) {
  let changed = false;
  for (const id of ids) {
    const e = getEntry(id);
    if (e && !e.metaAt) {
      e.metaAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) persist();
}

// ---------- История: удаление ----------
// Убирает запись из истории по индексу. Отметки серий в библиотеке остаются.
export function removeHistoryAt(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.history.length) return false;
  state.history.splice(index, 1);
  persist();
  return true;
}

export function clearHistory() {
  state.history = [];
  persist();
}

export function clearAll() {
  state = EMPTY();
  persist();
}

function range(from, to) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

// ============================================================
//  СИНХРОНИЗАЦИЯ С SHIKIMORI (ИЗМЕНЕНО В 1.3)
//  Очередь локальных изменений и служебные поля.
// ============================================================

// Поставить запись в очередь на отправку (свои записи не отправляем — их нет на Shikimori)
export function pushSync(id) {
  const key = String(id);
  const entry = state.library[key];
  if (!entry || entry.manual) return;
  if (!state.syncQueue.includes(key)) {
    state.syncQueue.push(key);
    if (state.syncQueue.length > 500) state.syncQueue = state.syncQueue.slice(-500);
  }
}

export const getSyncQueue = () => state.syncQueue.slice();

export function removeFromSyncQueue(ids) {
  const drop = new Set((ids || []).map(String));
  const before = state.syncQueue.length;
  state.syncQueue = state.syncQueue.filter((id) => !drop.has(id));
  if (state.syncQueue.length !== before) persist();
}

export const getSyncLast = () => state.syncLast;
export function setSyncLast(iso) { state.syncLast = iso || new Date().toISOString(); persist(); }

// Сохранить сведения о записи на Shikimori (id, когда изменена, пересмотры)
export function setShikiRate(id, meta = {}) {
  const e = getEntry(id);
  if (!e) return;
  if (meta.shikiRateId !== undefined) e.shikiRateId = meta.shikiRateId;
  if (meta.shikiUpdatedAt !== undefined) e.shikiUpdatedAt = meta.shikiUpdatedAt;
  if (meta.rewatches !== undefined) e.rewatches = meta.rewatches;
  persist();
}

// ---------- Рекомендации «Для тебя» ----------
export const getRecsCache = () => state.recs;
export function setRecsCache(list) { state.recs = { at: Date.now(), list: list || [] }; persist(); }
export const getHiddenRecs = () => state.hiddenRecs.slice();
export function hideRec(id) {
  const key = String(id);
  if (!state.hiddenRecs.includes(key)) state.hiddenRecs.push(key);
  persist();
}

// ---------- Анонимная статистика ----------
export const getInstallId = () => state.installId;
export const getTelemetryLast = () => state.telemetryLast;
export function setTelemetryLast(day) { state.telemetryLast = day || null; persist(); }
export function ensureInstallId(id) {
  if (!state.installId) { state.installId = id; persist(); }
  return state.installId;
}
export function forceInstallId(id) { state.installId = id; persist(); return state.installId; }

// ============================================================
//  ДОСТИЖЕНИЯ, РУЛЕТКА, ЗАМЕТКИ И ПОДБОРКИ (ДОБАВЛЕНО В 1.4)
// ============================================================
export function setAchievements(map) {
  state.achievements = { ...(map || {}) };
  persist();
}

export function pushRoulette(id) {
  const key = String(id);
  state.rouletteHistory = [key, ...state.rouletteHistory.filter((x) => x !== key)].slice(0, 5);
  persist();
}
export const getRouletteHistory = () => state.rouletteHistory.slice();

export function setNote(id, text) {
  const e = getEntry(id);
  if (!e) return;
  e.note = String(text || '').slice(0, 5000);
  touch(e);
}

// Подборки
export const getCollections = () => state.collections.slice();
export function createCollection(name, color = '#ff5d48') {
  const clean = String(name || '').trim().slice(0, 60);
  if (!clean) return null;
  const c = { id: 'c' + Date.now().toString(36), name: clean, color, ids: [] };
  state.collections.push(c);
  persist();
  return c;
}
export function renameCollection(id, name) {
  const c = state.collections.find((x) => x.id === String(id));
  const clean = String(name || '').trim().slice(0, 60);
  if (!c || !clean) return false;
  c.name = clean;
  persist();
  return true;
}
export function deleteCollection(id) {
  const before = state.collections.length;
  state.collections = state.collections.filter((x) => x.id !== String(id));
  if (state.collections.length !== before) persist();
}
export function toggleCollectionItem(collectionId, animeId) {
  const c = state.collections.find((x) => x.id === String(collectionId));
  if (!c) return false;
  const key = String(animeId);
  if (c.ids.includes(key)) c.ids = c.ids.filter((x) => x !== key);
  else c.ids.push(key);
  persist();
  return c.ids.includes(key);
}
export function isInCollection(collectionId, animeId) {
  const c = state.collections.find((x) => x.id === String(collectionId));
  return !!c && c.ids.includes(String(animeId));
}
export function getCollectionEntries(id) {
  const c = state.collections.find((x) => x.id === String(id));
  if (!c) return null;
  const list = c.ids.map((x) => getEntry(x)).filter(Boolean);
  return { collection: c, entries: list };
}


// ============================================================
//  СТАТИСТИКА ПО ДНЯМ — для «Итогов года» (ДОБАВЛЕНО В 1.5)
//  Считаются только серии, отмеченные по одной (кликом или плеером).
//  «Отметить все до этой» и импорт не считаются — иначе один клик
//  превратился бы в «500 серий за день».
// ============================================================
const dayKey = (d = new Date()) => {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};

function countDay(e) {
  const key = dayKey();
  const day = state.stats.byDay[key] || (state.stats.byDay[key] = { episodes: 0, minutes: 0, ids: [] });
  day.episodes++;
  day.minutes += Number(e.duration) > 0 ? Number(e.duration) : CONFIG.RECAP_DEFAULT_EPISODE_MIN;
  if (!day.ids.includes(e.id)) day.ids.push(e.id);
}

export const getStatsByDay = () => state.stats.byDay;

// Один раз переносим старую историю (до 200 последних отметок) в статистику по дням
export function migrateHistoryToStats() {
  if (state.stats.migrated) return;
  const byDay = state.stats.byDay;
  for (const h of state.history) {
    const d = new Date(h.at);
    if (isNaN(d)) continue;
    const key = dayKey(d);
    const day = byDay[key] || (byDay[key] = { episodes: 0, minutes: 0, ids: [] });
    const dur = Number(getEntry(h.id)?.duration) || CONFIG.RECAP_DEFAULT_EPISODE_MIN;
    day.episodes++;
    day.minutes += dur;
    if (!day.ids.includes(h.id)) day.ids.push(h.id);
  }
  state.stats.migrated = true;
  persist();
}

// Дозаполнить жанры у записей (для «Итогов года»): list — короткие объекты Shikimori
export function applyGenres(list) {
  for (const a of list) {
    const e = getEntry(a.id);
    if (e && Array.isArray(a.genres)) e.genreIds = a.genres.map((g) => String(g.id));
  }
  persist();
}
