// ============================================================
//  Kodik: поиск озвучек и серий по id Shikimori.
//  Сам запрос уходит через главный процесс (window.api.kodikSearch),
//  здесь — приведение ответа к удобному виду.
//
//  Токен API вводится в «Настройках». Он выдаётся владельцам сайтов:
//  support@kodikres.com (или переменная окружения KODIK_TOKEN).
// ============================================================

// Kodik отдаёт ссылки на kodik.info, но у части провайдеров этот домен
// не открывается. Тот же плеер доступен на kodikplayer.com.
const PLAYER_HOST = 'kodikplayer.com';
const PLAYER_HOSTS = /^(kodik\.info|kodik\.biz|kodik-api\.com|kodikplayer\.com)$/i;

// Ссылка на embed-плеер. Протокол-относительные ссылки делаем https.
export function playerUrl(link) {
  if (!link) return '';
  let url = String(link).trim();
  if (url.startsWith('//')) url = 'https:' + url;
  if (url.startsWith('/')) url = `https://${PLAYER_HOST}${url}`;
  try {
    const u = new URL(url);
    if (PLAYER_HOSTS.test(u.hostname)) u.hostname = PLAYER_HOST;
    return u.toString();
  } catch {
    return '';
  }
}

// Загрузить все озвучки тайтла. animeId — id на Shikimori,
// title — запасной вариант для своих записей и тайтлов без привязки.
export async function loadKodik(animeId, token, title = '') {
  const numeric = Number(animeId);
  const hasId = Number.isFinite(numeric) && numeric > 0;

  const search = async (params) => {
    const data = await window.api.kodikSearch(params);
    return normalize(data?.results || []);
  };

  let results = await search({
    token,
    shikimoriId: hasId ? animeId : null,
    title: hasId ? '' : title,
  });

  // По id ничего не нашлось — пробуем по названию
  if (!results.length && hasId && title) {
    results = await search({ token, title });
  }
  return results;
}

// Electron заворачивает ошибки IPC в «Error invoking remote method ...».
// Оставляем только человеческий текст.
export function kodikError(err) {
  return String(err?.message || err || '').replace(
    /^Error invoking remote method '[^']+': Error: /,
    ''
  );
}

// ------------------------------------------------------------
//  Ответ Kodik → список озвучек:
//  [{ id, title, type, quality, episodes: [{ season, episode, link }] }]
//  Одна озвучка может прийти несколькими объектами (разные сезоны),
//  поэтому склеиваем их по id перевода.
// ------------------------------------------------------------
export function normalize(results) {
  const byTranslation = new Map();

  for (const item of results) {
    if (!item || !item.link) continue;

    const tr = item.translation || {};
    const key = String(tr.id ?? `${tr.title || ''}:${tr.type || ''}`);
    let t = byTranslation.get(key);

    if (!t) {
      t = {
        id: tr.id ?? null,
        title: tr.title || 'Без названия',
        type: tr.type === 'subtitles' ? 'subtitles' : 'voice',
        quality: '',
        episodes: new Map(),
      };
      byTranslation.set(key, t);
    }

    if (qualityRank(item.quality) > qualityRank(t.quality)) t.quality = item.quality || '';

    const seasons = item.seasons && typeof item.seasons === 'object' ? item.seasons : {};
    let added = 0;

    for (const [seasonKey, season] of Object.entries(seasons)) {
      const seasonNum = Number(seasonKey) || 1;
      const eps = season?.episodes && typeof season.episodes === 'object' ? season.episodes : {};

      for (const [epKey, ep] of Object.entries(eps)) {
        const episodeNum = Number(epKey) || 1;
        const id = `${seasonNum}:${episodeNum}`;
        if (!t.episodes.has(id)) {
          t.episodes.set(id, {
            season: seasonNum,
            episode: episodeNum,
            link: playerUrl(ep?.link),
            title: ep?.title || '',
          });
          added++;
        }
      }

      // Сезон без разбивки на серии — даём одну ссылку на сезон
      if (!Object.keys(eps).length && season?.link) {
        const id = `${seasonNum}:1`;
        if (!t.episodes.has(id)) {
          t.episodes.set(id, {
            season: seasonNum,
            episode: 1,
            link: playerUrl(season.link),
            title: '',
          });
          added++;
        }
      }
    }

    // Фильм или одиночная серия — у объекта нет seasons
    if (!added && item.link) {
      const id = '1:1';
      if (!t.episodes.has(id)) {
        t.episodes.set(id, {
          season: 1,
          episode: 1,
          link: playerUrl(item.link),
          title: '',
        });
      }
    }
  }

  const translations = [...byTranslation.values()]
    .map((t) => ({
      ...t,
      episodes: [...t.episodes.values()]
        .filter((e) => e.link)
        .sort((a, b) => a.season - b.season || a.episode - b.episode),
    }))
    .filter((t) => t.episodes.length);

  // Сначала озвучки (их просил пользователь), потом субтитры.
  // Внутри группы — где больше серий, потом по алфавиту.
  translations.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'voice' ? -1 : 1;
    if (b.episodes.length !== a.episodes.length) return b.episodes.length - a.episodes.length;
    return a.title.localeCompare(b.title, 'ru');
  });

  return translations;
}

function qualityRank(quality) {
  const m = String(quality || '').match(/(\d{3,4})/);
  return m ? Number(m[1]) : 0;
}
