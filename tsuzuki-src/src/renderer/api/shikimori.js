// ============================================================
//  Запросы к Shikimori (GraphQL).
//  Сами запросы уходят через главный процесс (window.api.graphql),
//  здесь только описано, ЧТО спрашивать.
//  Список всех полей: https://shikimori.io/api/doc/graphql
// ============================================================

// ------------------------------------------------------------
//  ИЗМЕНЕНО В 1.1 (Claude, 02.11.2026):
//  - CARD_FIELDS: + english, rating, franchise, genres, scoresStats
//  - FULL_FIELDS: + scoresStats, statusesStats (статистика Shikimori)
//  - cleanList — убираем клипы, рекламу, промо, тайтлы без постера
//  - searchAnimes: сортировка «Лучшие», строгий поиск
//  - getFranchise — все сезоны франшизы
//  - getAnimesByIds — сведения о многих тайтлах (импорт, дозаполнение)
// ------------------------------------------------------------

import { CONFIG } from '../config.js';
import { sleep } from '../utils.js';
import { getPrefs } from '../store.js';

// Shikimori по умолчанию скрывает 18+ (параметр censored). Показывать их
// можно включить в «Настройках» — тогда censored не передаём.
function hideAdult() {
  return CONFIG.HIDE_18_PLUS && getPrefs().showAdult !== true;
}

// Поля для карточек в каталоге (коротко, чтобы грузилось быстро).
// malId и franchise — для импорта (сверка id MAL/Shikimori) и склейки сезонов,
// scoresStats — число оценок. 18+ прячется на сервере (censored), не тут.
const CARD_FIELDS = `
  id name russian english kind status score episodes episodesAired rating franchise malId
  airedOn { year date }
  poster { mainUrl previewUrl }
  scoresStats { count }
  genres { id }
`; // ИЗМЕНЕНО В 1.5: genres { id } — для любимых жанров в «Итогах года»

// Поля для страницы аниме (подробно)
const FULL_FIELDS = `
  ${CARD_FIELDS}
  scoresStats { score count }
  statusesStats { status count }
  english japanese duration rating nextEpisodeAt
  releasedOn { date }
  airedOn { date year }
  genres { id russian kind }
  studios { name }
  description
  videos { url name kind }
  externalLinks { kind url }
  related {
    relationText
    anime { id name russian kind airedOn { year } poster { previewUrl } }
  }
`;

async function gql(query) {
  const res = await window.api.graphql(query);
  if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '));
  return res.data;
}

// Собирает аргументы запроса: { search: 'наруто', page: 1 } → search: "наруто", page: 1
// Пустые значения пропускает. order — перечисление, поэтому без кавычек.
function args(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => (k === 'order' ? `${k}: ${v}` : `${k}: ${JSON.stringify(v)}`))
    .join(', ');
}

// ------------------------------------------------------------
//  Фильтр «мусора». Применяется ко всему, что приходит из каталога.
// ------------------------------------------------------------
export const votesOf = (a) => (a?.scoresStats || []).reduce((sum, x) => sum + (x.count || 0), 0);

const hasPoster = (a) => a?.poster?.mainUrl && !/missing/.test(a.poster.mainUrl);

// Строгий поиск: оставляем только тайтлы, в названии которых есть все слова запроса
const norm = (t) => String(t || '').toLowerCase().replaceAll('ё', 'е');
function matchesAllWords(a, search) {
  const words = norm(search).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  if (!words.length) return true;
  const hay = norm([a.russian, a.name, a.english].join(' '));
  return words.every((w) => hay.includes(w));
}

function cleanList(list, { kindChosen, statusChosen, order, search } = {}) {
  return list.filter((a) => {
    if (CONFIG.STRICT_SEARCH && search?.trim() && !matchesAllWords(a, search)) return false;
    if (CONFIG.HIDE_NO_POSTER && !hasPoster(a)) return false;
    if (CONFIG.HIDE_ANONS && !statusChosen && a.status === 'anons') return false;
    if (CONFIG.HIDE_JUNK_KINDS && !kindChosen && CONFIG.JUNK_KINDS.includes(a.kind)) return false;
    if (order === 'top' && votesOf(a) < CONFIG.MIN_VOTES) return false;
    return true;
  });
}

// Поиск и каталог.
// Возвращает массив уже очищенных тайтлов; в list.rawCount — сколько пришло
// с сервера (по нему каталог понимает, есть ли следующая страница).
export async function searchAnimes({ search, page = 1, order, kind, status, genre, year, season, rating } = {}) {
  // Shikimori принимает сезон в виде "fall_2024" или просто год "2024".
  let seasonValue = '';
  if (year) seasonValue = season ? `${season}_${year}` : String(year);
  else if (season) seasonValue = `${season}_${new Date().getFullYear()}`;

  let wanted = order || CONFIG.DEFAULT_ORDER;
  // При поиске по названию «Лучшие» мешают (прячут малоизвестное) — ищем по популярности
  if (wanted === 'top' && search?.trim()) wanted = 'popularity';
  // «Лучшие» = сортировка по рейтингу на сервере + отсев тайтлов с малым числом оценок у нас
  const apiOrder = wanted === 'top' ? 'ranked' : wanted;
  // Клипы/рекламу отсекаем прямо в запросе, если тип не выбран вручную
  const kindValue = kind || (CONFIG.HIDE_JUNK_KINDS ? CONFIG.JUNK_KINDS.map((k) => '!' + k).join(',') : '');

  const a = args({
    search: search?.trim(),
    page,
    limit: CONFIG.PAGE_SIZE,
    order: apiOrder,
    kind: kindValue,
    status,
    genre,
    season: seasonValue,
    rating,
    censored: hideAdult() ? true : undefined,
  });
  const data = await gql(`{ animes(${a}) { ${CARD_FIELDS} } }`);
  const raw = data.animes || [];
  const list = cleanList(raw, { kindChosen: !!kind, statusChosen: !!status, order: wanted, search });
  list.rawCount = raw.length;
  return list;
}

// ДОБАВЛЕНО В 1.5: поиск кандидатов для автораскладки папок.
// Без фильтров каталога (строгий поиск, «Лучшие») — нужны все похожие тайтлы.
export async function searchForMatch(query, limit = 8) {
  const a = args({
    search: String(query || '').trim(),
    limit,
    order: 'popularity',
    kind: 'tv,movie,ova,ona,special,tv_special',
    censored: hideAdult() ? true : undefined,
  });
  if (!String(query || '').trim()) return [];
  const data = await gql(`{ animes(${a}) { ${CARD_FIELDS} } }`);
  return data.animes || [];
}

// Все сезоны/фильмы/OVA одной франшизы, по дате выхода
const franchiseCache = new Map();
export async function getFranchise(franchise) {
  if (!franchise) return [];
  if (franchiseCache.has(franchise)) return franchiseCache.get(franchise);
  const data = await gql(`{ animes(franchise: ${JSON.stringify(franchise)}, limit: 50, order: aired_on,
    kind: "tv,movie,ova,ona,special,tv_special"${hideAdult() ? ', censored: true' : ''}) { ${CARD_FIELDS} } }`);
  const list = (data.animes || [])
    .sort((x, y) => String(x.airedOn?.date || x.airedOn?.year || '9999').localeCompare(String(y.airedOn?.date || y.airedOn?.year || '9999')));
  franchiseCache.set(franchise, list);
  return list;
}

// Сбросить кеш франшиз (например, после переключения «Показывать 18+»,
// иначе у уже загруженных франшиз новые сезоны не появятся до перезапуска).
export function clearFranchiseCache() {
  franchiseCache.clear();
}

// Короткие сведения о многих тайтлах сразу (по 50 за запрос).
// Нужно для импорта и чтобы дозаполнить франшизу/рейтинг у старых записей.
export async function getAnimesByIds(ids, onProgress = () => {}) {  const list = [...new Set(ids.map(Number).filter((n) => n > 0))];
  const out = [];
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const data = await gql(`{ animes(ids: "${chunk.join(',')}", limit: ${chunk.length}) { ${CARD_FIELDS} } }`);
    out.push(...(data.animes || []));
    onProgress(Math.min(i + 50, list.length), list.length);
    if (i + 50 < list.length) await sleep(400); // не злим Shikimori частыми запросами
  }
  return out;
}

// Одно аниме со всеми подробностями
export async function getAnime(id) {
  const data = await gql(`{ animes(ids: "${Number(id)}", limit: 1) { ${FULL_FIELDS} } }`);
  return data.animes[0] || null;
}

// Список жанров для фильтра (кешируем, он почти не меняется)
let genresCache = null;
export async function getGenres() {
  if (genresCache) return genresCache;
  const data = await gql(`{ genres(entryType: Anime) { id russian kind } }`);
  genresCache = (data.genres || [])
    .filter((g) => g.russian)
    .sort((a, b) => String(a.russian).localeCompare(String(b.russian), 'ru'));
  return genresCache;
}

// ------------------------------------------------------------
//  Календарь онгоингов: /api/calendar отдаёт ближайшие серии.
//  Картинки приходят относительными путями — делаем полные ссылки.
// ------------------------------------------------------------
const SHIKI_HOST = 'https://shikimori.io';

export async function getCalendar() {
  const data = await window.api.shikiGet('/api/calendar');
  const list = Array.isArray(data) ? data : [];

  const items = list
    .filter((x) => x?.anime && x?.next_episode_at)
    .map((x) => {
      const image = x.anime.image || {};
      const poster = image.preview || image.original || '';
      return {
        id: String(x.anime.id),
        title: x.anime.russian || x.anime.name || 'Без названия',
        name: x.anime.name || '',
        kind: x.anime.kind || '',
        score: Number(x.anime.score) || 0,
        episodes: x.anime.episodes || 0,
        episodesAired: x.anime.episodes_aired || 0,
        status: x.anime.status || '',
        poster: poster.startsWith('/') ? SHIKI_HOST + poster : poster,
        episode: x.next_episode || 1,
        at: x.next_episode_at,
        duration: x.duration || 0,
      };
    })
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));

  // /api/calendar для многих тайтлов отдаёт заглушку missing_preview.jpg,
  // поэтому настоящие постеры дозапрашиваем через GraphQL (одним-двумя запросами).
  const broken = items.filter((x) => !x.poster || x.poster.includes('/missing_')).map((x) => x.id);
  if (broken.length) {
    try {
      const posters = await getAnimesByIds(broken);
      const byId = new Map(posters.map((a) => [String(a.id), a.poster?.previewUrl || a.poster?.mainUrl || '']));
      for (const item of items) {
        const url = byId.get(item.id);
        if (url) item.poster = url;
      }
    } catch {
      // не получилось — оставляем заглушки, календарь всё равно покажется
    }
  }
  return items;
}

// Сколько серий вышло у тайтлов из «Смотрю» — для уведомлений.
export async function getAiredInfo(ids) {
  const list = [...new Set((ids || []).map((id) => Number(id)).filter((id) => id > 0))].slice(0, 50);
  if (!list.length) return [];

  const data = await gql(`{
    animes(ids: "${list.join(',')}", limit: ${list.length}) {
      id episodes episodesAired status nextEpisodeAt
    }
  }`);
  return data.animes || [];
}

// ------------------------------------------------------------
//  Импорт открытого списка пользователя Shikimori по нику.
//  Пароль и вход не нужны — список должен быть открытым в профиле.
// ------------------------------------------------------------
export async function fetchUserList(nickname, onProgress = () => {}) {
  const user = await window.api.shikiGet(`/api/users/${encodeURIComponent(nickname)}?is_nickname=1`);
  if (!user?.id) throw new Error('Пользователь не найден');

  const all = [];
  const limit = 50;
  for (let page = 1; page < 200; page++) {
    const data = await gql(`{
      userRates(userId: "${user.id}", targetType: Anime, limit: ${limit}, page: ${page}) {
        status episodes score updatedAt
        anime { ${CARD_FIELDS} }
      }
    }`);
    all.push(...data.userRates);
    onProgress(all.length);
    if (data.userRates.length < limit) break;
    await sleep(400); // Shikimori ограничивает частоту запросов — не спешим
  }
  return { user, rates: all };
}

// ============================================================
//  «ДЛЯ ТЕБЯ»: вкусы и похожие тайтлы (ИЗМЕНЕНО В 1.3)
// ============================================================

// Жанры и студии тайтлов из библиотеки — из них строится профиль вкуса.
export async function getTasteDetails(ids) {
  const list = [...new Set((ids || []).map(Number).filter((id) => id > 0))].slice(0, 100);
  const out = [];
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    try {
      const data = await gql(`{ animes(ids: "${chunk.join(',')}", limit: ${chunk.length}) {
        id genres { id russian } studios { name }
      } }`);
      out.push(...(data?.animes || []));
    } catch { /* профиль чуть беднее — не страшно */ }
    if (i + 50 < list.length) await sleep(400);
  }
  return out;
}

// Похожие тайтлы с Shikimori (REST /api/animes/:id/similar)
export async function getSimilar(id) {
  try {
    const list = await window.api.shikiGet(`/api/animes/${Number(id)}/similar`);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Жанры Shikimori для фильтра рекомендаций (id → название)
export async function getGenresList() {
  try {
    return await getGenres();
  } catch {
    return [];
  }
}

// ============================================================
//  ЛЮДИ: профили, друзья, активность (ДОБАВЛЕНО В 1.4)
//  Публичные данные Shikimori: кто зарегистрирован, что смотрит,
//  что оценил, друзья и активность. Без регистрации — только то,
//  что пользователь открыл сам.
// ============================================================
export const USER_HOST = 'https://shikimori.io';

export function userAvatar(user, size = 'x80') {
  if (!user) return '';
  const img = user.image || {};
  return img[size] || user.avatar || '';
}

export async function findUsers(search) {
  const q = String(search || '').trim();
  if (!q) return [];
  try {
    const list = await window.api.shikiGet('/api/users?search=' + encodeURIComponent(q) + '&limit=20');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function getUser(id) {
  return window.api.shikiGet('/api/users/' + Number(id));
}

export async function getUserFriends(id) {
  try {
    const list = await window.api.shikiGet('/api/users/' + Number(id) + '/friends');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function getUserHistory(id, limit = 20) {
  try {
    const list = await window.api.shikiGet('/api/users/' + Number(id) + '/history?limit=' + limit);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function getUserRates(id, limit = 30) {
  try {
    const list = await window.api.shikiGet('/api/users/' + Number(id) + '/anime_rates?limit=' + limit);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function getUserFavourites(id) {
  try {
    return await window.api.shikiGet('/api/users/' + Number(id) + '/favourites');
  } catch {
    return null;
  }
}

// Старый объект тайтла из REST (история/оценки) → формат карточки
export function legacyAnime(a) {
  if (!a || !a.id) return null;
  const image = a.image || {};
  const preview = image.preview || image.original || image.x96 || image.x48 || '';
  return {
    id: Number(a.id),
    title: a.russian || a.name || 'Без названия',
    name: a.name || '',
    poster: preview && String(preview).startsWith('/') ? USER_HOST + preview : preview,
    kind: a.kind || 'tv',
    year: Number(String(a.aired_on || '').slice(0, 4)) || null,
    episodes: Number(a.episodes) || 0,
    episodesAired: Number(a.episodes_aired) || 0,
    animeStatus: a.status || '',
    score: Number(a.score) || 0,
  };
}
