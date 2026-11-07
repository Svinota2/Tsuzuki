// ============================================================
//  КАТАЛОГ: поиск и фильтры по базе Shikimori.
// ============================================================

// ------------------------------------------------------------
//  ИЗМЕНЕНО В 1.1 (Claude, 02.11.2026):
//  - склейка сезонов (stackItems)
//  - крестик и «Очистить» в «Продолжить просмотр»
//  - догрузка, если после чистки страница почти пустая
// ------------------------------------------------------------

import { CONFIG } from '../config.js';
import { searchAnimes, getGenres } from '../api/shikimori.js';
import { cardHtml } from '../components/card.js';
import { esc, debounce, toast } from '../utils.js';
import { getContinueWatching, hideContinue, clearContinue, getPrefs } from '../store.js';
import { getNews, clearNews } from '../api/notifications.js';
import { rememberAnime } from './anime.js';

// Состояние живёт между переходами: вернулся из карточки — поиск и прокрутка на месте
const state = {
  search: '',
  order: null,      // null — берём CONFIG.DEFAULT_ORDER (его можно поменять в «Настройках»)
  kind: '',
  status: '',
  genre: '',
  year: '',
  season: '',
  rating: '',
  page: 1,
  items: [],
  done: false,      // больше страниц нет
  loading: false,
  scroll: 0,
  franchises: new Map(), // франшиза → { id карточки-представителя, сколько ещё сезонов спрятано }
};

const options = (map, selected, emptyLabel) =>
  (emptyLabel !== undefined ? `<option value="">${emptyLabel}</option>` : '') +
  Object.entries(map)
    .map(([v, label]) => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(label)}</option>`)
    .join('');

const yearOptions = (selected) => {
  const current = new Date().getFullYear();
  let html = '<option value="">Любой год</option>';
  for (let y = current + 1; y >= 1960; y--) {
    html += `<option value="${y}" ${String(y) === String(selected) ? 'selected' : ''}>${y}</option>`;
  }
  return html;
};

export async function render(root) {
  if (!state.order) state.order = CONFIG.DEFAULT_ORDER;
  root.innerHTML = `
    <div class="page">
      <h1 class="page-title">Каталог</h1>
      <div id="news-slot"></div>
      <div id="continue-slot"></div>
      <div class="toolbar">
        <input class="input search" id="q" placeholder="Название аниме на русском, английском или японском…" value="${esc(state.search)}" autofocus>
        <select class="select" id="order">${options(CONFIG.ORDERS, state.order)}</select>
        <select class="select" id="kind">${options(CONFIG.KINDS, state.kind, 'Любой тип')}</select>
        <select class="select" id="status">${options(CONFIG.ANIME_STATUSES, state.status, 'Любой статус')}</select>
        <select class="select" id="genre"><option value="">Все жанры</option></select>
        <select class="select" id="year">${yearOptions(state.year)}</select>
        <select class="select" id="season">${options(CONFIG.SEASONS, state.season, 'Любой сезон')}</select>
        <select class="select" id="rating">${options(CONFIG.RATINGS, state.rating, 'Любой рейтинг')}</select>
      </div>
      <div class="grid" id="grid"></div>
      <div id="below"></div>
    </div>`;

  // Слушатели вешаем на .page, а не на root: при смене раздела .page удаляется вместе с ними
  const page = root.querySelector('.page');
  const grid = root.querySelector('#grid');
  const below = root.querySelector('#below');
  const newsSlot = root.querySelector('#news-slot');
  const continueSlot = root.querySelector('#continue-slot');

  // ---------- Новые серии ----------
  function drawNews() {
    const news = CONFIG.SHOW_NEWS ? getNews() : [];
    if (!news.length) {
      newsSlot.innerHTML = '';
      return;
    }
    newsSlot.innerHTML = `
      <div class="news-banner">
        <div class="news-head">
          <b>Вышли новые серии</b>
          <button class="news-dismiss" data-news-dismiss title="Скрыть">×</button>
        </div>
        <div class="news-items">
          ${news.map((n) => `
            <div class="news-item" data-news-open="${esc(n.id)}">
              <span class="news-title">${esc(n.title)}</span>
              <span class="news-count">+${n.to - n.from}</span>
            </div>`).join('')}
        </div>
      </div>`;
  }

  // ---------- Продолжить просмотр ----------
  function drawContinue() {
    const items = CONFIG.SHOW_CONTINUE ? getContinueWatching() : [];
    if (!items.length) {
      continueSlot.innerHTML = '';
      return;
    }
    continueSlot.innerHTML = `
      <div class="continue-block">
        <div class="block-head">
          <h2 class="block-title">Продолжить просмотр</h2>
          <button class="btn btn-ghost" data-continue-clear title="Убрать все карточки (место, где остановился, сохранится)">Очистить</button>
        </div>
        <div class="continue-row">
          ${items.map((item) => {
            const href = `#/watch/${encodeURIComponent(item.id)}/${encodeURIComponent(item.tr || '')}/${item.season || 1}/${item.episode}`;
            const meta = [
              item.season ? `Сезон ${item.season}` : '',
              `Серия ${item.episode}`,
              item.trTitle || '',
            ].filter(Boolean).join(' · ');
            return `
              <div class="continue-card" data-continue="${esc(href)}">
                ${item.poster
                  ? `<img class="continue-poster" src="${esc(item.poster)}" loading="lazy" alt="">`
                  : '<div class="continue-poster"></div>'}
                <div class="continue-info">
                  <div class="continue-title">${esc(item.title)}</div>
                  <div class="continue-meta">${esc(meta)}</div>
                </div>
                <span class="continue-play">▶</span>
                <button class="continue-hide" data-continue-hide="${esc(item.id)}" title="Убрать из списка">×</button>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  drawNews();
  drawContinue();

  const onNews = () => drawNews();
  window.addEventListener('tsuzuki:news', onNews);

  // Жанры подгружаем отдельно, чтобы не задерживать каталог
  getGenres()
    .then((genres) => {
      const sel = root.querySelector('#genre');
      if (!sel) return;
      // 18+ жанры показываем только если это включено в «Настройках»
      const hideAdultGenres = CONFIG.HIDE_18_PLUS && getPrefs().showAdult !== true;
      const list = hideAdultGenres
        ? genres.filter((g) => !['Хентай', 'Эротика'].includes(g.russian))
        : genres;
      sel.innerHTML += list
        .map((g) => `<option value="${esc(g.id)}" ${String(g.id) === String(state.genre) ? 'selected' : ''}>${esc(g.russian)}</option>`)
        .join('');
    })
    .catch(() => {});

  // Склейка сезонов: из одной франшизы показываем первую попавшуюся карточку,
  // остальные прячем и пишем на ней «+N сезонов».
  function stackItems(items) {
    if (!CONFIG.STACK_FRANCHISES) return items.map((a) => ({ anime: a, stack: 0 }));
    const out = [];
    for (const a of items) {
      const f = a.franchise;
      if (!f) { out.push({ anime: a, stack: 0 }); continue; }
      const seen = state.franchises.get(f);
      if (seen) { seen.stack++; continue; }
      const rec = { anime: a, stack: 0 };
      state.franchises.set(f, rec);
      out.push(rec);
    }
    return out;
  }

  function drawItems(items, append) {
    const recs = append ? stackItems(items) : rebuildStacks(items);
    const html = recs.map((r) => cardHtml(r.anime, { stack: r.stack })).join('');
    if (append) {
      grid.insertAdjacentHTML('beforeend', html);
      // у старых карточек могло прибавиться спрятанных сезонов — перерисуем их значки
      for (const rec of state.franchises.values()) {
        const el = grid.querySelector(`[data-open="${rec.anime.id}"]`);
        if (el && rec.stack) el.outerHTML = cardHtml(rec.anime, { stack: rec.stack });
      }
    } else grid.innerHTML = html;
  }

  function rebuildStacks(items) {
    state.franchises = new Map();
    return stackItems(items);
  }

  function drawBelow() {
    if (state.loading) below.innerHTML = '<div class="spinner"></div>';
    else if (!state.items.length) below.innerHTML = `<div class="empty"><div class="empty-big">∅</div>Ничего не нашлось</div>`;
    else if (state.done) below.innerHTML = '';
    else below.innerHTML = `<div class="load-more"><button class="btn" id="more">Показать ещё</button></div>`;
  }

  let autoLoads = 0;
  async function load(reset) {
    if (state.loading) return;
    if (reset) autoLoads = 0;
    if (reset) {
      state.page = 1;
      state.items = [];
      state.done = false;
      state.franchises = new Map();
      grid.innerHTML = '';
    }
    state.loading = true;
    drawBelow();
    try {
      const items = await searchAnimes({
        search: state.search,
        page: state.page,
        order: state.order,
        kind: state.kind,
        status: state.status,
        genre: state.genre,
        year: state.year,
        season: state.season,
        rating: state.rating,
      });
      items.forEach(rememberAnime);
      state.items.push(...items);
      // конец списка определяем по тому, сколько прислал сервер (до нашей чистки)
      state.done = (items.rawCount ?? items.length) < CONFIG.PAGE_SIZE;
      state.page++;
      drawItems(items, !reset);
      // после чистки страница могла почти опустеть — сразу догружаем следующую
      // (не больше 5 раз подряд, чтобы не засыпать Shikimori запросами)
      autoLoads = grid.children.length < 12 ? autoLoads + 1 : 0;
      if (!state.done && autoLoads > 0 && autoLoads <= 5) setTimeout(() => load(false), 350);
    } catch (err) {
      toast('Не удалось загрузить каталог: ' + err.message, 'error');
    } finally {
      state.loading = false;
      drawBelow();
    }
  }

  // ---------- События ----------
  const onSearch = debounce(() => load(true), CONFIG.SEARCH_DELAY_MS);
  root.querySelector('#q').addEventListener('input', (e) => {
    state.search = e.target.value;
    onSearch();
  });
  for (const id of ['order', 'kind', 'status', 'genre', 'year', 'season', 'rating']) {
    root.querySelector('#' + id).addEventListener('change', (e) => {
      state[id] = e.target.value;
      // Сезон без года ищем в текущем году — и показываем это в фильтре
      if (id === 'season' && e.target.value && !state.year) {
        state.year = String(new Date().getFullYear());
        root.querySelector('#year').value = state.year;
      }
      load(true);
    });
  }
  page.addEventListener('click', (e) => {
    if (e.target.closest('#more')) return load(false);

    if (e.target.closest('[data-news-dismiss]')) {
      clearNews();
      return;
    }
    const newsItem = e.target.closest('[data-news-open]');
    if (newsItem) {
      location.hash = `#/anime/${newsItem.dataset.newsOpen}`;
      return;
    }
    const hide = e.target.closest('[data-continue-hide]');
    if (hide) {
      e.stopPropagation();
      hideContinue(hide.dataset.continueHide);
      drawContinue();
      return;
    }
    if (e.target.closest('[data-continue-clear]')) {
      clearContinue();
      drawContinue();
      toast('«Продолжить просмотр» очищен', 'ok');
      return;
    }
    const cont = e.target.closest('[data-continue]');
    if (cont) {
      location.hash = cont.dataset.continue;
      return;
    }

    const card = e.target.closest('[data-open]');
    if (card) {
      state.scroll = root.scrollTop;
      location.hash = `#/anime/${card.dataset.open}`;
    }
  });

  // Автоподгрузка, когда долистал до низа
  const onScroll = () => {
    if (!state.done && !state.loading && root.scrollTop + root.clientHeight > root.scrollHeight - 600) load(false);
  };
  root.addEventListener('scroll', onScroll);

  // ---------- Первый показ ----------
  if (state.items.length) {
    drawItems(state.items, false);
    drawBelow();
    root.scrollTop = state.scroll;
  } else {
    root.scrollTop = 0;
    load(true);
  }

  // Вызовется при уходе со страницы
  return () => {
    root.removeEventListener('scroll', onScroll);
    window.removeEventListener('tsuzuki:news', onNews);
  };
}

// Сбрасывает сохранённые результаты: каталог перезагрузится с новыми настройками
// (например, после включения/выключения «Показывать 18+»).
export function resetCatalog() {
  state.items = [];
  state.franchises = new Map();
  state.order = null;
  state.page = 1;
  state.done = false;
}
