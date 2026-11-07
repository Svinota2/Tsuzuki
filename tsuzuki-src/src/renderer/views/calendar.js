// ============================================================
//  КАЛЕНДАРЬ ОНГОИНГОВ.
//  Shikimori отдаёт ближайшие серии через /api/calendar.
// ============================================================

import { getCalendar } from '../api/shikimori.js';
import { esc, kindLabel } from '../utils.js';

const pad = (n) => String(n).padStart(2, '0');

function dayKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayTitle(key) {
  const now = new Date();
  const today = dayKey(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (key === today) return 'Сегодня';
  if (key === dayKey(tomorrow)) return 'Завтра';

  const d = new Date(key + 'T12:00:00');
  // Только день недели: сама дата выводится рядом в .cal-day-date
  const text = d.toLocaleDateString('ru-RU', { weekday: 'long' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function timeOf(value) {
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export async function render(root) {
  root.scrollTop = 0;
  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">Календарь онгоингов</h1>
        <button class="btn btn-sm btn-ghost" data-act="reload">Обновить</button>
      </div>
      <div id="cal-body"><div class="spinner"></div></div>
    </div>`;

  const page = root.querySelector('.page');
  const body = root.querySelector('#cal-body');
  let items = [];

  function draw() {
    if (!items.length) {
      body.innerHTML = `<div class="empty"><div class="empty-big">▦</div>
        Ближайших серий не нашлось.<br>
        <span class="faint">Shikimori не отдал даты выхода — попробуй обновить позже.</span></div>`;
      return;
    }

    const groups = new Map();
    for (const item of items) {
      const key = dayKey(item.at);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    body.innerHTML = [...groups.entries()]
      .map(([key, list]) => `
        <div class="cal-day">
          <div class="cal-day-title">${esc(dayTitle(key))}</div>
          <div class="cal-day-date">${esc(new Date(key + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }))}</div>
        </div>
        <div class="cal-list">
          ${list.map((item) => {
            const meta = [
              item.episode ? `Серия ${item.episode}` : '',
              kindLabel(item.kind),
              item.score ? `★ ${item.score.toFixed(1)}` : '',
            ].filter(Boolean).join(' · ');
            return `
              <div class="cal-item" data-open="${esc(item.id)}">
                <div class="cal-time">${esc(timeOf(item.at))}</div>
                ${item.poster
                  ? `<img class="cal-poster" src="${esc(item.poster)}" loading="lazy" alt="">`
                  : '<div class="cal-poster"></div>'}
                <div class="cal-info">
                  <div class="cal-title">${esc(item.title)}</div>
                  <div class="cal-meta">${esc(meta)}</div>
                </div>
              </div>`;
          }).join('')}
        </div>`)
      .join('');
  }

  async function load() {
    body.innerHTML = '<div class="spinner"></div>';
    try {
      items = await getCalendar();
      draw();
    } catch (err) {
      body.innerHTML = `<div class="empty"><div class="empty-big">⚠</div>
        Не удалось загрузить календарь:<br><span class="faint">${esc(err.message)}</span><br><br>
        <button class="btn btn-sm" data-act="reload">Попробовать снова</button></div>`;
    }
  }

  page.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="reload"]')) return load();
    const item = e.target.closest('[data-open]');
    if (item) location.hash = `#/anime/${item.dataset.open}`;
  });

  await load();
}
