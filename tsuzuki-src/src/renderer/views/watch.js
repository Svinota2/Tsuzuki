// ============================================================
//  ОНЛАЙН-ПРОСМОТР (Kodik).
//  Плеер Kodik открывается в iframe прямо в приложении.
//  Слева — плеер, справа — выбор озвучки и серии.
//
//  Адрес: #/watch/<id Shikimori>/<озвучка>/<сезон>/<серия>
// ============================================================

import { getAnime } from '../api/shikimori.js';
import { loadKodik, kodikError } from '../api/kodik.js';
import * as store from '../store.js';
import { esc, titleOf, toast, plural } from '../utils.js';
import { animeFromEntry } from './anime.js';
import { setPlaying } from '../api/presence.js'; // ДОБАВЛЕНО В 1.6.3: статус в Discord при онлайн-просмотре

// Кеш ответов Kodik: id тайтла + токен → список озвучек
const cache = new Map();

export async function render(root, [id, trParam, seasonParam, epParam]) {
  root.scrollTop = 0;
  root.innerHTML = '<div class="spinner"></div>';

  const stored = store.getEntry(id);
  const manual = stored?.manual ? stored : null;
  let anime;

  if (manual) {
    anime = animeFromEntry(manual);
  } else {
    try {
      anime = await getAnime(id);
    } catch (err) {
      root.innerHTML = `<div class="empty"><div class="empty-big">⚠</div>Не удалось загрузить тайтл:<br>
        <span class="faint">${esc(err.message)}</span><br><br>
        <a class="btn btn-ghost" href="#/anime/${esc(id)}">Назад</a></div>`;
      return;
    }
  }

  if (!anime) {
    root.innerHTML = `<div class="empty"><div class="empty-big">∅</div>Тайтл не найден.<br><br>
      <a class="btn btn-ghost" href="#/catalog">В каталог</a></div>`;
    return;
  }

  const token = store.getPrefs().kodikToken || '';
  const title = titleOf(anime);
  const cacheKey = `${id}:${token}:${title}`;
  let translations = cache.get(cacheKey);

  if (!translations) {
    try {
      translations = await loadKodik(id, token, title);
      cache.set(cacheKey, translations);
    } catch (err) {
      root.innerHTML = errorHtml(id, kodikError(err));
      return;
    }
  }

  if (!translations.length) {
    root.innerHTML = `<div class="empty"><div class="empty-big">🔍</div>
      Kodik не нашёл этот тайтл.<br>
      <span class="faint">${manual
        ? 'Поиск шёл по названию из своей записи. Проверь название или добавь оригинальное.'
        : 'Возможно, для него ещё нет озвучек или он привязан к другому id Shikimori.'}</span><br><br>
      ${manual ? `<a class="btn btn-ghost" href="#/add/${esc(id)}">Редактировать запись</a>` : ''}
      <a class="btn btn-ghost" href="#/anime/${esc(id)}">Назад к тайтлу</a></div>`;
    return;
  }

  // ---------- Выбор озвучки и серии ----------
  // Приоритет: адрес → последняя озвучка/серия из трекера → первая серия.
  const saved = store.getOnlineState(id);
  const trKey = (t) => String(t.id ?? t.title);
  let currentTr = translations.find((t) => trKey(t) === String(trParam))
    || (saved ? translations.find((t) => trKey(t) === String(saved.tr)) : null)
    || translations[0];
  let currentEp = null;
  let autoEpisode = null; // плоский номер Shikimori при переходе кликом по серии
  let autoMapped = false; // удалось ли честно сопоставить номер с серией озвучки

  if (String(seasonParam) === 'auto' && epParam) {
    // Клик по серии на странице тайтла: плеер сам сопоставляет плоский номер
    // Shikimori с сезоном/серией Kodik. Сезон 0 (спешлы/бонусы) в нумерацию
    // Shikimori не входит, поэтому считаем по основным сезонам (1, 2, ...).
    autoEpisode = Number(epParam) || null;
    if (autoEpisode) {
      const mainEpisodes = currentTr.episodes.filter((e) => e.season > 0);
      const ordered = mainEpisodes.length ? mainEpisodes : currentTr.episodes;
      const found = ordered[autoEpisode - 1];
      if (found) {
        currentEp = found;
        autoMapped = true;
      } else {
        // запасной вариант — серия с таким номером в любом сезоне
        currentEp = currentTr.episodes.find((e) => e.episode === autoEpisode) || null;
      }
    }
  } else if (seasonParam && epParam) {
    currentEp = currentTr.episodes.find(
      (e) => e.season === Number(seasonParam) && e.episode === Number(epParam)
    ) || null;
  }

  if (!currentEp && saved && String(saved.tr) === trKey(currentTr)) {
    currentEp = currentTr.episodes.find(
      (e) => e.season === Number(saved.season) && e.episode === Number(saved.episode)
    ) || null;
  }

  if (!currentEp) currentEp = currentTr.episodes[0];

  // Отмечаем ту серию, которую реально нашли. Только при честном сопоставлении
  // по плоскому номеру, иначе можно отметить не то.
  if (autoEpisode && autoMapped && !store.isWatched(id, autoEpisode)) {
    store.setEpisodeWatched(anime, autoEpisode, true);
  }

  const movie = anime.kind === 'movie' || currentTr.episodes.length === 1 && anime.kind !== 'tv';
  let presenceStart = Date.now(); // ДОБАВЛЕНО В 1.6.3: сколько смотрим в Discord

  // ---------- Разметка ----------
  root.innerHTML = `
    <div class="player-page">
      <div class="player-main">
        <div class="player-top">
          <a class="btn btn-sm btn-ghost" href="#/anime/${esc(id)}">← К тайтлу</a>
          <a class="t ttl" href="#/anime/${esc(id)}" title="Открыть страницу тайтла">${esc(titleOf(anime))}</a>
          <span class="grow"></span>
          ${window.api && window.api.openPlayer ? `<button class="btn btn-sm btn-ghost" data-act="external">${window.api.manualInstall ? 'Плеер на весь экран ↗' : 'Открыть в окне ↗'}</button>` : ''}
        </div>

        <div class="online-player">
          <div class="online-loading" id="loading"><div class="spinner"></div></div>
          <iframe id="kodik" title="Kodik" allowfullscreen
                  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                  referrerpolicy="no-referrer"></iframe>
        </div>
        <!-- ДОБАВЛЕНО В 1.6.5: подсказка для телефона/ТВ, если iframe не запустился -->
        ${window.api && window.api.manualInstall
          ? '<p class="faint" style="margin:6px 14px 0">Если видео внутри не запускается — нажми «Плеер на весь экран ↗».</p>'
          : ''}

        <div class="player-bar">
          <button class="btn btn-sm" id="prev" data-act="prev">⏮ Пред.</button>
          <button class="btn btn-sm" id="next" data-act="next">След. ⏭</button>
          <button class="btn btn-sm" id="mark" data-act="mark"></button>
          <span class="grow"></span>
          <span class="faint" id="ep-label"></span>
        </div>
      </div>

      <aside class="player-side">
        <h3>Озвучки <span class="faint" id="tr-count"></span></h3>
        <div id="translations"></div>
        <h3 id="episodes-title">Серии</h3>
        <div id="episodes"></div>
      </aside>
    </div>`;

  const page = root.querySelector('.player-page');
  const iframe = page.querySelector('#kodik');
  const loading = page.querySelector('#loading');

  // ---------- Отрисовка ----------
  function drawTranslations() {
    page.querySelector('#tr-count').textContent = `(${translations.length})`;
    page.querySelector('#translations').innerHTML = translations
      .map((t) => {
        const active = t === currentTr;
        return `<div class="file ${active ? 'current' : ''}" data-tr="${esc(trKey(t))}" title="${esc(t.title)}">
          <span class="num">${t.type === 'voice' ? '🎙' : '💬'}</span>
          <span class="fname">${esc(t.title)}</span>
          <span class="tr-meta">${t.episodes.length} ${plural(t.episodes.length, ['сер.', 'сер.', 'сер.'])}${t.quality ? ` · ${esc(t.quality)}` : ''}</span>
        </div>`;
      })
      .join('');
  }

  function drawEpisodes() {
    const groups = new Map();
    for (const ep of currentTr.episodes) {
      if (!groups.has(ep.season)) groups.set(ep.season, []);
      groups.get(ep.season).push(ep);
    }
    const manySeasons = groups.size > 1;

    page.querySelector('#episodes-title').textContent = movie ? 'Фильм' : 'Серии';

    page.querySelector('#episodes').innerHTML = [...groups.entries()]
      .map(([season, eps]) => `
        ${manySeasons ? `<div class="season-label">Сезон ${season}</div>` : ''}
        <div class="episodes online-episodes">
          ${eps.map((ep) => {
            const watched = store.isWatched(id, ep.episode);
            const active = ep.season === currentEp.season && ep.episode === currentEp.episode;
            return `<button class="ep ${watched ? 'watched' : ''} ${active ? 'current' : ''}"
              data-ep="${ep.season}:${ep.episode}" title="${esc(ep.title || '')}">${movie ? '▶' : ep.episode}</button>`;
          }).join('')}
        </div>`)
      .join('');
  }

  function drawBar() {
    const idx = currentTr.episodes.indexOf(currentEp);
    const watched = store.isWatched(id, currentEp.episode);

    page.querySelector('#ep-label').textContent = movie
      ? 'Фильм'
      : `${currentTr.episodes.some((e) => e.season !== currentEp.season) ? `Сезон ${currentEp.season} · ` : ''}Серия ${currentEp.episode}`;
    page.querySelector('#prev').disabled = idx <= 0;
    page.querySelector('#next').disabled = idx >= currentTr.episodes.length - 1;

    const mark = page.querySelector('#mark');
    mark.textContent = watched ? '✓ Просмотрена' : 'Отметить просмотренной';
    mark.classList.toggle('btn-accent', watched);
  }

  // ---------- Переключение ----------
  function select(tr, index) {
    currentTr = tr;
    currentEp = tr.episodes[Math.max(0, Math.min(index, tr.episodes.length - 1))];

    // Запоминаем выбор: при следующем входе откроется эта же озвучка и серия
    store.setOnlineState(id, {
      tr: trKey(tr),
      trTitle: tr.title,
      season: currentEp.season,
      episode: currentEp.episode,
      title: titleOf(anime),
      poster: anime.poster?.mainUrl || '',
      kind: anime.kind,
      animeStatus: anime.status,
    });

    loading.style.display = 'flex';
    iframe.src = currentEp.link;
    history.replaceState(null, '', `#/watch/${encodeURIComponent(id)}/${encodeURIComponent(trKey(tr))}/${currentEp.season}/${currentEp.episode}`);

    drawTranslations();
    drawEpisodes();
    drawBar();
    page.querySelector('.file.current')?.scrollIntoView({ block: 'nearest' });

    // ДОБАВЛЕНО В 1.6.3: статус в Discord — название и «Серия N из M»
    presenceStart = Date.now();
    setPlaying(movie
      ? { title: titleOf(anime), episode: 0, total: 0, startedAt: presenceStart }
      : { title: titleOf(anime), episode: currentEp.episode, total: anime.episodes || 0, startedAt: presenceStart });
  }

  function go(delta) {
    const idx = currentTr.episodes.indexOf(currentEp);
    const next = idx + delta;
    if (next < 0 || next >= currentTr.episodes.length) return;

    // «Следующая» — значит текущую досмотрели: отмечаем её в трекере
    if (delta > 0 && !store.isWatched(id, currentEp.episode)) {
      store.setEpisodeWatched(anime, currentEp.episode, true);
      toast(`${currentEp.episode} серия отмечена просмотренной`, 'ok');
    }
    select(currentTr, next);
  }

  // ---------- События ----------
  iframe.addEventListener('load', () => {
    if (iframe.src && iframe.src !== 'about:blank') loading.style.display = 'none';
  });

  page.querySelector('#translations').addEventListener('click', (e) => {
    const row = e.target.closest('[data-tr]');
    if (!row) return;
    const tr = translations.find((t) => trKey(t) === row.dataset.tr);
    if (!tr || tr === currentTr) return;

    // при смене озвучки пытаемся остаться на той же серии
    const same = tr.episodes.findIndex((ep) => ep.episode === currentEp.episode);
    select(tr, same >= 0 ? same : 0);
  });

  page.querySelector('#episodes').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ep]');
    if (!btn) return;
    const [season, episode] = btn.dataset.ep.split(':').map(Number);
    const idx = currentTr.episodes.findIndex((ep) => ep.season === season && ep.episode === episode);
    if (idx >= 0) select(currentTr, idx);
  });

  page.querySelector('[data-act="prev"]').addEventListener('click', () => go(-1));
  page.querySelector('[data-act="next"]').addEventListener('click', () => go(1));
  page.querySelector('[data-act="mark"]').addEventListener('click', () => {
    store.toggleEpisode(anime, currentEp.episode);
    drawEpisodes();
    drawBar();
  });
  page.querySelector('[data-act="external"]')?.addEventListener('click', () => {
    // ДОБАВЛЕНО В 1.6.4: на Android отдельного окна плеера нет — кнопка скрыта
    // Прямую ссылку Kodik открывать в окне нельзя (404), поэтому открываем
    // локальную обёртку с тем же iframe — см. src/renderer/player-window.html
    if (iframe.src) window.api.openPlayer(iframe.src, titleOf(anime));
  });

  // ---------- Старт ----------
  const startIndex = Math.max(0, currentTr.episodes.indexOf(currentEp));
  select(currentTr, startIndex);

  return () => {
    iframe.src = 'about:blank';
    setPlaying(null); // ДОБАВЛЕНО В 1.6.3: убираем статус при уходе с страницы
  };
}

function errorHtml(id, message) {
  const noToken = /не задан токен|нет рабочих публичных токенов|список публичных токенов/i.test(message || '');
  const badToken = /неверный токен/i.test(message || '');
  const tokenIssue = noToken || badToken;

  return `<div class="empty">
    <div class="empty-big">${tokenIssue ? '🔑' : '⚠'}</div>
    ${badToken
      ? `Kodik не принял токен. Проверь его в «Настройках» или очисти поле — тогда приложение возьмёт публичный токен.`
      : noToken
        ? `Для онлайн-просмотра нужен токен Kodik API.<br>
           <span class="faint">Приложение обычно находит публичный токен само, но сейчас не получилось. Вставь свой в «Настройках» — он выдаётся владельцам сайтов: support@kodikres.com.<br>
           Также можно задать переменную окружения KODIK_TOKEN.</span>`
        : `Не удалось загрузить Kodik:<br><span class="faint">${esc(message)}</span>`}
    <br><br>
    <a class="btn btn-accent" href="#/settings">Открыть настройки</a>
    <a class="btn btn-ghost" href="#/anime/${esc(id)}">Назад к тайтлу</a>
  </div>`;
}
