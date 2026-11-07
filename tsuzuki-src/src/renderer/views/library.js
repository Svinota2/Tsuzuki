// ============================================================
//  МОЯ БИБЛИОТЕКА: вкладки по статусам, поиск, подборки, рулетка.
// ============================================================

// ------------------------------------------------------------
//  ИЗМЕНЕНО В 1.1 (Claude, 02.11.2026):
//  - склейка сезонов (stack)
//  ДОБАВЛЕНО В 1.4:
//  - вкладка «Подборки» (создать/переименовать/удалить, содержимое)
//  - поиск по заметкам
//  - кнопка «🎲 Случайное» (рулетка)
// ------------------------------------------------------------

import { CONFIG } from '../config.js';
import * as store from '../store.js';
import { cardHtml } from '../components/card.js';
import { openRoulette } from '../components/roulette.js';
import { esc, toast, confirmDialog } from '../utils.js';

let filterText = ''; // поиск внутри библиотеки (запоминается между переходами)
const COLLECTIONS = 'collections';
const COLORS = ['#ff5d48', '#4ade80', '#60a5fa', '#a78bfa', '#fbbf24', '#f87171', '#22d3ee'];

export function render(root, [status = 'watching', cid]) {
  root.scrollTop = 0;
  let editingId = null; // какую подборку переименовываем

  function draw() {
    const counts = store.countByStatus();
    const all = store.listEntries('all');
    const collections = store.getCollections();
    const isCollections = status === COLLECTIONS;
    const collectionData = isCollections && cid ? store.getCollectionEntries(cid) : null;
    const q = filterText.toLowerCase();
    const items = isCollections
      ? []
      : store.listEntries(status).filter((e) => !q
        || e.title.toLowerCase().includes(q)
        || (e.name || '').toLowerCase().includes(q)
        || (e.note || '').toLowerCase().includes(q));

    let body = '';
    if (isCollections && collectionData) {
      const { collection, entries } = collectionData;
      body = `
        <div class="row" style="margin-bottom:14px">
          <a class="btn btn-sm btn-ghost" href="#/library/collections">← Все подборки</a>
        </div>
        <h2 style="margin:0 0 14px">${esc(collection.name)} <span class="muted" style="font-size:13px;font-weight:400">${entries.length} тайтлов</span></h2>
        ${entries.length
          ? `<div class="grid">${entries.map((e) => `
              <div class="col-item" data-col-item="${e.id}">
                ${cardHtml(e)}
                <button class="btn btn-sm btn-ghost" data-col-remove="${e.id}" title="Убрать из подборки">Убрать</button>
              </div>`).join('')}</div>`
          : '<div class="empty"><div class="empty-big">🗂</div>Подборка пока пустая.<br><span class="faint">Добавляй тайтлы со страницы тайтла: «В подборку».</span></div>'}`;
    } else if (isCollections) {
      body = `
        <div class="box" style="margin-bottom:16px">
          <h3>Новая подборка</h3>
          <div class="row">
            <input class="input" id="col-name" placeholder="Название (например, «Зимний сезон»)" style="flex:1">
            <button class="btn btn-accent" data-act="create-col">Создать</button>
          </div>
        </div>
        ${collections.length
          ? `<div>${collections.map((c) => `
              <div class="collection-row">
                <span class="collection-dot" style="background:${esc(c.color)}"></span>
                ${editingId === c.id
                  ? `<input class="input" data-rename-input="${c.id}" value="${esc(c.name)}" style="flex:1">
                     <span class="collection-actions">
                       <button class="btn btn-sm btn-accent" data-act="rename-save" data-id="${c.id}">Сохранить</button>
                       <button class="btn btn-sm btn-ghost" data-act="rename-cancel">Отмена</button>
                     </span>`
                  : `<a class="collection-name" href="#/library/collections/${c.id}">${esc(c.name)}</a>
                     <span class="collection-count">${c.ids.length} тайтлов</span>
                     <span class="collection-actions">
                       <button class="btn btn-sm btn-ghost" data-act="rename" data-id="${c.id}">Переименовать</button>
                       <button class="btn btn-sm btn-ghost btn-danger" data-act="delete-col" data-id="${c.id}">Удалить</button>
                     </span>`}
              </div>`).join('')}</div>`
          : '<div class="empty"><div class="empty-big">🗂</div>Подборок пока нет.<br><span class="faint">Создай первую — например, «Топ-10» или «Пересмотреть».</span></div>'}`;
    } else {
      body = items.length
        ? `<div class="grid">${stack(items).map(({ e, more }) => cardHtml(e, { showPlus: status === 'watching', stack: more })).join('')}</div>`
        : `<div class="empty"><div class="empty-big">▤</div>Здесь пока пусто.<br>
           <span class="faint">Найди аниме в каталоге и выбери статус на его странице.</span></div>`;
    }

    root.innerHTML = `
      <div class="page">
        <h1 class="page-title">Моя библиотека</h1>
        <div class="tabs">
          <a class="tab ${status === 'all' ? 'active' : ''}" href="#/library/all">
            <span class="dot" style="background:var(--text-2)"></span>Все
            <span class="count">${all.length}</span>
          </a>
          ${CONFIG.STATUSES.map((s) => `
            <a class="tab ${s.id === status ? 'active' : ''}" href="#/library/${s.id}">
              <span class="dot" style="background:${s.color}"></span>${esc(s.label)}
              <span class="count">${counts[s.id]}</span>
            </a>`).join('')}
          <a class="tab ${isCollections ? 'active' : ''}" href="#/library/${COLLECTIONS}">
            <span class="dot" style="background:var(--accent)"></span>Подборки
            <span class="count">${collections.length}</span>
          </a>
        </div>
        ${isCollections ? '' : `
        <div class="toolbar">
          <input class="input search" id="filter" placeholder="Найти в библиотеке (название или заметка)…" value="${esc(filterText)}">
          <button class="btn" data-act="roulette" title="Случайный тайтл из списка">🎲 Случайное</button>
          <a class="btn btn-accent" href="#/add">＋ Своя запись</a>
        </div>`}
        ${body}
      </div>`;

    const page = root.querySelector('.page');
    const input = page.querySelector('#filter');
    if (input) {
      input.addEventListener('input', (e) => {
        filterText = e.target.value;
        draw();
        const again = root.querySelector('#filter');
        again.focus();
        again.setSelectionRange(filterText.length, filterText.length);
      });
    }

    page.addEventListener('click', async (e) => {
      const plus = e.target.closest('[data-plus]');
      if (plus) {
        e.stopPropagation();
        const entry = store.getEntry(plus.dataset.plus);
        const n = store.nextEpisode(entry.id);
        if (entry.episodes && n > entry.episodes) return toast('Все серии уже отмечены');
        store.setEpisodeWatched({ id: entry.id, ...entryAsAnime(entry) }, n);
        toast(`${entry.title}: отмечена ${n} серия`, 'ok');
        return;
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'roulette') {
        const candidates = status === 'all' ? all : store.listEntries(status);
        if (!candidates.length) return toast('Список пуст — добавь тайтлы в библиотеку');
        openRoulette(candidates, { title: 'Что посмотреть сейчас' });
        return;
      }
      if (act === 'create-col') {
        const name = page.querySelector('#col-name')?.value || '';
        if (!String(name).trim()) return toast('Введи название подборки', 'error');
        store.createCollection(name, COLORS[store.getCollections().length % COLORS.length]);
        toast('Подборка создана', 'ok');
        return draw();
      }
      if (act === 'rename') { editingId = e.target.closest('[data-id]').dataset.id; return draw(); }
      if (act === 'rename-cancel') { editingId = null; return draw(); }
      if (act === 'rename-save') {
        const id = e.target.closest('[data-id]').dataset.id;
        const value = page.querySelector(`[data-rename-input="${id}"]`)?.value || '';
        store.renameCollection(id, value);
        editingId = null;
        return draw();
      }
      if (act === 'delete-col' && (await confirmDialog('Удалить подборку? Тайтлы останутся в библиотеке.', { danger: true, ok: 'Удалить' }))) {
        store.deleteCollection(e.target.closest('[data-id]').dataset.id);
        return draw();
      }
      const remove = e.target.closest('[data-col-remove]');
      if (remove && cid) {
        e.stopPropagation();
        store.toggleCollectionItem(cid, remove.dataset.colRemove);
        return draw();
      }
      const card = e.target.closest('[data-open]');
      if (card) location.hash = `#/anime/${card.dataset.open}`;
    });
  }

  draw();
  return store.onChange(draw);
}

// Склейка сезонов: из записей одной франшизы показываем самую свежую,
// остальные — значком «+N сезонов» (полный список — на странице тайтла)
function stack(items) {
  if (!CONFIG.STACK_FRANCHISES) return items.map((e) => ({ e, more: 0 }));
  const groups = new Map();
  const out = [];
  for (const e of items) { // items уже отсортированы: свежие сверху
    if (!e.franchise) { out.push({ e, more: 0 }); continue; }
    const g = groups.get(e.franchise);
    if (g) { g.more++; continue; }
    const rec = { e, more: 0 };
    groups.set(e.franchise, rec);
    out.push(rec);
  }
  return out;
}

// Запись библиотеки → объект «как с Shikimori», чтобы store.ensureEntry её понял
function entryAsAnime(e) {
  return {
    russian: e.title, name: e.name, kind: e.kind, status: e.animeStatus,
    episodes: e.episodes, episodesAired: e.episodesAired,
    poster: { mainUrl: e.poster }, airedOn: { year: e.year },
  };
}
