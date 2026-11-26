// ============================================================
//  AniLibria API для сайта Tsuzuki (1.9.1)
//  Публичный API, CORS для сайта открыт. Свои плеер и качества.
// ============================================================

const BASE = 'https://anilibria.top/api/v1';
const TIMEOUT_MS = 12000;

async function request(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(BASE + path, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('AniLibria ответила ' + response.status);
    return await response.json();
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('AniLibria не ответила вовремя');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function searchReleases(query, { limit = 12 } = {}) {
  const rows = await request('/app/search/releases?query=' + encodeURIComponent(String(query || '').trim()));
  const list = Array.isArray(rows) ? rows : (rows.data || []);
  return list.slice(0, limit);
}

export function releaseTitle(release) {
  return release?.name?.main || release?.name?.english || release?.alias || 'Без названия';
}

export function releaseYear(release) {
  return release?.year || '';
}

export async function releaseEpisodes(releaseId) {
  const data = await request('/anime/releases/' + encodeURIComponent(releaseId) + '?include=episodes');
  return Array.isArray(data.episodes) ? data.episodes : [];
}

export function episodeLabel(episode, index) {
  return 'Серия ' + (episode?.ordinal || index + 1);
}

// AniLibria иногда добавляет рекламные сегменты параметром isWithVideoAds.
function cleanHls(url) {
  if (!url) return '';
  return String(url)
    .replace(/([?&])isWithVideoAds=1/g, '$1isWithVideoAds=0')
    .replace(/([?&])isWithVideoAdsAlways=1/g, '$1isWithVideoAdsAlways=0');
}

export function episodeQualities(episode) {
  const rows = [];
  for (const [key, label] of [['hls_1080', '1080p'], ['hls_720', '720p'], ['hls_480', '480p']]) {
    if (episode && episode[key]) rows.push({ label, url: cleanHls(episode[key]) });
  }
  return rows;
}

export function episodeOpening(episode) {
  const opening = episode && episode.opening;
  const start = Number(opening && opening.start) || 0;
  const stop = Number(opening && opening.stop) || 0;
  return stop > start ? { start, stop } : null;
}
