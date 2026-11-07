// ============================================================
//  «ДЛЯ ТЕБЯ» — рекомендации (ИЗМЕНЕНО В 1.3).
//  Подбираем тайтлы по вкусу: жанры и студии любимых тайтлов,
//  похожие с Shikimori, топ по любимым жанрам.
//  Результат кешируется на CONFIG.DISCOVER_CACHE_HOURS часов.
// ============================================================

import { CONFIG } from '../config.js';
import { cardHtml, skeletonGrid } from '../components/card.js';
import { openRoulette } from '../components/roulette.js';
import * as store from '../store.js';
import { getTasteDetails, getSimilar, searchAnimes, getGenresList } from '../api/shikimori.js';
import { esc, toast, plural } from '../utils.js';

const HOST = 'https://shikimori.io';
const PAUSE = 400;

let building = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const posterOf = (image) => {
  const p = image?.preview || image?.original || image?.x96 || '';
  return p && p.startsWith('/') ? HOST + p : p;
};

// Старый REST-объект «похожих» → наш формат карточки
function fromLegacy(a) {
  if (!a || !a.id) return null;
  return {
    id: Number(a.id),
    title: a.russian || a.name || 'Без названия',
    name: a.name || '',
    poster: posterOf(a.image),
    kind: a.kind || 'tv',
    year: Number(a.aired_on) || null,
    episodes: Number(a.episodes) || 0,
    episodesAired: Number(a.episodes_aired) || 0,
    animeStatus: a.status || '',
    score: Number(a.score) || 0,
  };
}

// Профиль вкуса: жанры и студии с весами
function buildTaste(rated) {
  const genres = new Map();
  const studios = new Map();
  for (const { entry, weight } of rated) {
    for (const g of entry._genres || []) {
      const name = g.russian || g.name;
      if (name) genres.set(name, (genres.get(name) || 0) + weight);
    }
    for (const s of entry._studios || []) {
      if (s && s.name) studios.set(s.name, (studios.get(s.name) || 0) + weight);
    }
  }
  const topGenres = [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, CONFIG.DISCOVER_GENRE_TOP);
  const topStudios = [...studios.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  return { genres: topGenres, studios: topStudios };
}

// Собираем кандидатов
async function buildRecommendations() {
  const entries = store.listEntries('all');
  const rated = entries
    .filter((e) => Number(e.score) >= CONFIG.DISCOVER_MIN_SCORE)
    .sort((a, b) => Number(b.score) - Number(a.score));

  // Если оценок мало — берём «Просмотрено» и «Смотрю»
  let source = rated;
  if (source.length < 2) {
    source = entries
      .filter((e) => e.status === 'completed' || e.status === 'watching')
      .sort((a, b) => (b.watched?.length || 0) - (a.watched?.length || 0));
  }
  if (!source.length) return { empty: true, items: [] };

  const top = source.slice(0, CONFIG.DISCOVER_TOP_TITLES);

  // Жанры и студии любимых тайтлов (один запрос пачкой)
  let details = [];
  try { details = await getTasteDetails(top.map((e) => e.id)); } catch { details = []; }
  const byId = new Map(details.map((d) => [String(d.id), d]));
  const withTaste = top.map((e) => {
    const d = byId.get(String(e.id));
    const weight = Number(e.score) >= CONFIG.DISCOVER_MIN_SCORE
      ? Math.max(1, Number(e.score) - 5)
      : 1;
    return { entry: { ...e, _genres: d?.genres || [], _studios: d?.studios || [] }, weight };
  });
  const taste = buildTaste(withTaste);
  const liked = new Set(entries.map((e) => String(e.id)));
  const hidden = new Set(store.getHiddenRecs());

  const cands = new Map(); // id → { anime, score, reasons:Set }
  const add = (anime, points, reason) => {
    if (!anime || !anime.id) return;
    const id = String(anime.id);
    if (liked.has(id) || hidden.has(id)) return;
    if (anime.score && anime.score < CONFIG.DISCOVER_MIN_AVG_SCORE) return;
    if (['music', 'cm', 'pv'].includes(anime.kind)) return;      // клипы и рекламу не советуем
    if (anime.animeStatus === 'anons') return;                    // анонсы не советуем
    if (!anime.poster) return;
    const cur = cands.get(id) || { anime, score: 0, reasons: new Set() };
    cur.score += points;
    if (reason) cur.reasons.add(reason);
    cands.set(id, cur);
  };

  // 1) Похожие на любимые тайтлы
  for (const { entry, weight } of withTaste.slice(0, 8)) {
    if (Number(entry.id) <= 0) continue;
    const similar = await getSimilar(entry.id);
    for (const raw of similar.slice(0, CONFIG.DISCOVER_SIMILAR_EACH)) {
      const a = fromLegacy(raw);
      add(a, 3 * weight, `Похоже на «${entry.title}»`);
    }
    await sleep(PAUSE);
  }

  // 2) Топ по любимым жанрам
  let genresList = [];
  try { genresList = await getGenresList(); } catch { genresList = []; }
  const genreIdByTitle = new Map(genresList.map((g) => [String(g.russian || g.name), g.id]));
  for (const [name, weight] of taste.genres) {
    const gid = genreIdByTitle.get(name);
    if (!gid) continue;
    try {
      const list = await searchAnimes({ genre: gid, order: 'top', page: 1 });
      for (const a of list.slice(0, 20)) {
        add(a, 1.5 + Math.min(2, weight / 3), `Твой жанр: ${name}`);
      }
    } catch { /* один жанр не сработал — не страшно */ }
    await sleep(PAUSE);
  }

  // 3) Студии любимых тайтлов — ищем по названию студии
  for (const [name] of taste.studios) {
    try {
      const list = await searchAnimes({ search: name, order: 'top', page: 1 });
      for (const a of list.slice(0, 10)) add(a, 1.2, `Твоя студия: ${name}`);
    } catch { /* пропускаем */ }
    await sleep(PAUSE);
  }

  // Сортируем и ограничиваем
  const items = [...cands.values()]
    .map((c) => ({
      ...c.anime,
      reason: [...c.reasons][0] || '',
      score: Number(c.anime.score) || 0,
    }))
    .sort((a, b) => {
      const sa = (cands.get(String(a.id))?.score || 0) + (a.score || 0) / 2;
      const sb = (cands.get(String(b.id))?.score || 0) + (b.score || 0) / 2;
      return sb - sa;
    })
    .slice(0, CONFIG.DISCOVER_LIMIT);

  return { empty: false, items, taste };
}

export function render(root) {
  root.scrollTop = 0;
  root.innerHTML = ''; // как и другие разделы: заменяем содержимое, а не дописываем
  const page = document.createElement('div');
  page.className = 'page';
  root.appendChild(page);

  const state = { items: [], loading: false, empty: false, error: '' };

  const cached = store.getRecsCache();
  const fresh = cached && (Date.now() - Number(cached.at || 0)) < CONFIG.DISCOVER_CACHE_HOURS * 3600 * 1000;

  function draw() {
    const items = state.items.filter((a) => !store.getHiddenRecs().includes(String(a.id)));
    page.innerHTML = `
      <h1 class="page-title">Для тебя <span class="muted" style="font-size:14px;font-weight:400">подборка по твоим вкусам</span></h1>
      <div class="toolbar">
        <button class="btn" data-act="refresh" ${state.loading ? 'disabled' : ''}>
          ${state.loading ? 'Подбираем…' : 'Обновить подборку'}
        </button>
        <span class="faint" data-status>${state.loading ? 'Смотрим любимые тайтлы и ищем похожие…' : state.error || (items.length ? `Найдено: ${items.length}` : '')}</span>
      </div>
      ${state.empty
        ? `<div class="empty"><div class="empty-big">✦</div>Пока не из чего собрать подборку.<br>
            <span class="faint">Поставь несколько оценок или отметь просмотренное — и здесь появятся рекомендации.</span></div>`
        : ''}
      ${!state.empty && !items.length && !state.loading
        ? `<div class="empty"><div class="empty-big">✦</div>Подборка пока пустая.<br>
            <span class="faint">Нажми «Обновить подборку» — или любимых тайтлов слишком мало.</span></div>`
        : ''}
      <div class="grid discover-grid">
        ${items.map((a) => `
          <div class="rec" data-rec="${esc(a.id)}">
            ${cardHtml(a)}
            <div class="rec-reason">${esc(a.reason || '')}</div>
            <button class="btn btn-sm btn-ghost rec-hide" data-hide="${esc(a.id)}" title="Больше не советовать">Не интересно</button>
          </div>`).join('')}
      </div>`;
  }

  async function load(force = false) {
    if (building) return;
    building = true;
    state.loading = true;
    state.error = '';
    draw();
    try {
      const res = await buildRecommendations();
      state.items = res.items || [];
      state.empty = !!res.empty;
      store.setRecsCache(state.items);
      if (!res.empty) toast(`Подборка обновлена: ${state.items.length}`, 'ok');
    } catch (err) {
      state.error = 'Не удалось собрать подборку: ' + err.message;
    } finally {
      building = false;
      state.loading = false;
      draw();
    }
  }

  page.addEventListener('click', (e) => {
    const hide = e.target.closest('[data-hide]');
    if (hide) {
      const id = hide.dataset.hide;
      store.hideRec(id);
      state.items = state.items.filter((a) => String(a.id) !== String(id));
      store.setRecsCache(state.items);
      draw();
      return;
    }
    if (e.target.closest('[data-act="refresh"]')) { load(true); return; }
    if (e.target.closest('[data-act="roulette"]')) {
      const planned = store.listEntries('planned');
      if (!planned.length) return toast('В «Планах» пусто — добавь тайтлы в библиотеку', 'error');
      openRoulette(planned, { title: 'Что посмотреть из планов' });
      return;
    }
    const card = e.target.closest('[data-open]');
    if (card) location.hash = `#/anime/${card.dataset.open}`;
  });

  if (fresh && cached.list) {
    state.items = cached.list;
    draw();
    // обновляем в фоне, если кеш старше половины срока
    if (Date.now() - Number(cached.at || 0) > (CONFIG.DISCOVER_CACHE_HOURS * 3600 * 1000) / 2) {
      setTimeout(() => load(false), 1500);
    }
  } else {
    load(false);
  }

  return null;
}
