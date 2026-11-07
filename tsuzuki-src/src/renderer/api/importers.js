// НОВЫЙ ФАЙЛ В 1.1 (Claude, 02.11.2026): импорт из MyAnimeList (XML) и AniList
// ============================================================
//  ИМПОРТ СПИСКОВ ИЗ ДРУГИХ ПРОГРАММ.
//
//  Все форматы сводятся к одному виду:
//    { malId, status, episodes, score, updatedAt }
//  id на Shikimori совпадает с id на MyAnimeList, поэтому дальше
//  подробности тайтлов берём с Shikimori (getAnimesByIds).
//
//  Новый источник = функция, которая возвращает такой массив.
//  Добавь её сюда и кнопку в views/settings.js.
// ============================================================

import { getAnimesByIds } from './shikimori.js';
import { importRates } from '../store.js';

// ---------- MyAnimeList XML ----------
// Подходит для: MyAnimeList (Профиль → Export → Anime List, файл .xml.gz),
// Shikimori (Настройки → Список → Экспорт в XML), Kitsu, AniList-экспортёров
// и любой программы, которая умеет «экспорт в формате MAL».
const MAL_STATUS = {
  'watching': 'watching', '1': 'watching',
  'completed': 'completed', '2': 'completed',
  'on-hold': 'on_hold', 'on hold': 'on_hold', '3': 'on_hold',
  'dropped': 'dropped', '4': 'dropped',
  'plan to watch': 'planned', 'planned': 'planned', '6': 'planned',
  'rewatching': 'watching',
};

export function parseMalXml(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Файл не похож на XML');
  const nodes = [...doc.querySelectorAll('anime')];
  if (!nodes.length) throw new Error('В файле нет тайтлов (нужен экспорт аниме-списка в формате MyAnimeList)');
  const get = (n, tag) => n.querySelector(tag)?.textContent?.trim() || '';

  return nodes
    .map((n) => ({
      malId: Number(get(n, 'series_animedb_id')),
      status: MAL_STATUS[get(n, 'my_status').toLowerCase()] || 'planned',
      episodes: Number(get(n, 'my_watched_episodes')) || 0,
      score: Number(get(n, 'my_score')) || 0,
      updatedAt: null,
    }))
    .filter((r) => r.malId > 0);
}

// ---------- AniList по нику ----------
const ANILIST_STATUS = {
  CURRENT: 'watching', REPEATING: 'watching', COMPLETED: 'completed',
  PAUSED: 'on_hold', DROPPED: 'dropped', PLANNING: 'planned',
};

export async function fetchAniList(userName) {
  const data = await window.api.anilist(`
    query ($name: String) {
      MediaListCollection(userName: $name, type: ANIME) {
        lists { entries { status progress score(format: POINT_10) updatedAt media { idMal } } }
      }
    }`, { name: userName });
  const entries = (data?.MediaListCollection?.lists || []).flatMap((l) => l.entries || []);
  const withMal = entries.filter((x) => x.media?.idMal);
  return {
    noMal: entries.length - withMal.length, // тайтлы, которых нет на MAL/Shikimori
    rates: withMal.map((x) => ({
      malId: x.media.idMal,
      status: ANILIST_STATUS[x.status] || 'planned',
      episodes: x.progress || 0,
      score: x.score || 0,
      updatedAt: x.updatedAt ? new Date(x.updatedAt * 1000).toISOString() : null,
    })),
  };
}

// ---------- Общий шаг: подтянуть тайтлы с Shikimori и записать ----------
// mode: 'overwrite' или 'skip' (см. importRates в store.js)
// Id MyAnimeList и Shikimori обычно совпадают, но не всегда — сверяем по полю
// malId из Shikimori: если оно не совпало, тайтл считаем ненайденным, чтобы
// не записать чужую запись.
export async function applyImport(rates, { mode = 'overwrite', onProgress = () => {} } = {}) {
  const byMal = new Map(rates.map((r) => [Number(r.malId), r]));
  const animes = await getAnimesByIds([...byMal.keys()], onProgress);

  const ready = [];
  const used = new Set();
  for (const a of animes) {
    const malId = Number(a.malId);
    const r = byMal.get(malId) || (!malId ? byMal.get(Number(a.id)) : undefined);
    if (!r || used.has(r.malId)) continue;
    used.add(r.malId);
    ready.push({ anime: a, status: r.status, episodes: r.episodes, score: r.score, updatedAt: r.updatedAt || undefined });
  }
  const { added, skipped } = importRates(ready, mode);
  return { added, skipped, notFound: byMal.size - used.size };
}
