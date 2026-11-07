// ============================================================
//  СВОЯ ЗАПИСЬ.
//  Добавляет тайтл, которого нет на Shikimori: название, постер,
//  число серий и статус. id у таких записей отрицательный.
// ============================================================

import { CONFIG } from '../config.js';
import * as store from '../store.js';
import { esc, toast, confirmDialog } from '../utils.js';

export function render(root, [id]) {
  root.scrollTop = 0;

  const editing = id ? store.getEntry(id) : null;
  if (id && (!editing || !editing.manual)) {
    root.innerHTML = `<div class="empty"><div class="empty-big">∅</div>
      Своя запись не найдена.<br><br>
      <a class="btn btn-ghost" href="#/library">В библиотеку</a></div>`;
    return;
  }

  const e = editing || {};
  const kindOptions = Object.entries(CONFIG.KINDS)
    .map(([v, label]) => `<option value="${esc(v)}" ${v === (e.kind || 'tv') ? 'selected' : ''}>${esc(label)}</option>`)
    .join('');

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">${editing ? 'Редактировать запись' : 'Своя запись'}</h1>
        <a class="btn btn-sm btn-ghost" href="#/library">← В библиотеку</a>
      </div>

      <form class="form box" id="manual-form">
        <div class="form-grid">
          <div class="form-row">
            <label for="m-title">Название *</label>
            <input class="input" id="m-title" name="title" required maxlength="200"
                   value="${esc(e.title || '')}" placeholder="Например, Наруто">
          </div>

          <div class="form-row">
            <label for="m-name">Оригинальное название</label>
            <input class="input" id="m-name" name="name" maxlength="200"
                   value="${esc(e.name || '')}" placeholder="Naruto">
          </div>

          <div class="form-row form-wide">
            <label for="m-poster">Ссылка на постер</label>
            <input class="input" id="m-poster" name="poster" maxlength="1000"
                   value="${esc(e.poster || '')}" placeholder="https://...">
          </div>

          <div class="form-row">
            <label for="m-kind">Тип</label>
            <select class="select" id="m-kind" name="kind">${kindOptions}</select>
          </div>

          <div class="form-row">
            <label for="m-year">Год</label>
            <input class="input" id="m-year" name="year" type="number" min="1900" max="2100"
                   value="${e.year || ''}" placeholder="2024">
          </div>

          <div class="form-row">
            <label for="m-episodes">Всего серий</label>
            <input class="input" id="m-episodes" name="episodes" type="number" min="0" max="100000"
                   value="${e.episodes || ''}" placeholder="12">
          </div>

          <div class="form-row">
            <label for="m-duration">Минут на серию</label>
            <input class="input" id="m-duration" name="duration" type="number" min="0" max="600"
                   value="${e.duration || ''}" placeholder="24">
          </div>

          <div class="form-row">
            <label for="m-status">Статус в списке</label>
            <select class="select" id="m-status" name="status">
              <option value="">Без статуса</option>
              ${CONFIG.STATUSES.map((s) => `<option value="${s.id}" ${e.status === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="form-row">
          <label for="m-description">Описание</label>
          <textarea class="input" id="m-description" name="description" rows="5"
                    placeholder="Необязательно">${esc(e.description || '')}</textarea>
        </div>

        <div class="form-actions">
          <button class="btn btn-accent" type="submit">${editing ? 'Сохранить' : 'Добавить запись'}</button>
          <a class="btn btn-ghost" href="${editing ? `#/anime/${editing.id}` : '#/library'}">Отмена</a>
          ${editing ? '<button class="btn btn-danger" type="button" data-act="delete">Удалить запись</button>' : ''}
        </div>
        <p class="faint" style="margin:14px 0 0">Для такой записи онлайн-поиск идёт по названию: Kodik попробует найти её сам.</p>
      </form>
    </div>`;

  const form = root.querySelector('#manual-form');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    const data = {
      title: String(fd.get('title') || '').trim(),
      name: String(fd.get('name') || '').trim(),
      poster: String(fd.get('poster') || '').trim(),
      kind: String(fd.get('kind') || 'tv'),
      year: Number(fd.get('year')) || null,
      episodes: Number(fd.get('episodes')) || 0,
      duration: Number(fd.get('duration')) || 0,
      status: String(fd.get('status') || ''),
      description: String(fd.get('description') || '').trim(),
    };

    if (!data.title) return toast('Укажи название', 'error');

    if (editing) {
      store.updateManual(editing.id, data);
      toast('Запись обновлена', 'ok');
      location.hash = `#/anime/${editing.id}`;
    } else {
      const newId = store.addManual(data);
      toast('Запись добавлена', 'ok');
      location.hash = `#/anime/${newId}`;
    }
  });

  form.addEventListener('click', async (event) => {
    if (!event.target.closest('[data-act="delete"]')) return;
    if (!(await confirmDialog('Удалить эту запись вместе с отметками серий?', { danger: true, ok: 'Удалить' }))) return;
    store.removeEntry(editing.id);
    toast('Запись удалена');
    location.hash = '#/library';
  });
}
