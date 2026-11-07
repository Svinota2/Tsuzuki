// ============================================================
//  ИСТОРИЯ: какие серии и когда отмечены.
//  Можно удалить одну запись (×) или очистить историю целиком.
//  Отметки серий в библиотеке при этом не трогаются.
// ============================================================

import * as store from '../store.js';
import { esc, toast, confirmDialog } from '../utils.js';

export function render(root) {
  root.scrollTop = 0;

  function draw() {
    const history = store.getState().history;

    // группируем по дням, сохраняя индекс записи в общем массиве истории
    const groups = new Map();
    history.forEach((h, index) => {
      const day = new Date(h.at).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push({ h, index });
    });

    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1 class="page-title">История</h1>
          ${history.length ? '<button class="btn btn-sm btn-ghost" data-act="clear-history">Очистить историю</button>' : ''}
        </div>
        ${history.length ? '' : '<div class="empty"><div class="empty-big">↺</div>Пока ничего не отмечено</div>'}
        <div class="history-list">
          ${[...groups].map(([day, items]) => `
            <div class="history-day">${esc(day)}</div>
            ${items.map(({ h, index }) => {
              const poster = store.getEntry(h.id)?.poster;
              return `
                <div class="history-item" data-open="${h.id}">
                  ${poster ? `<img src="${esc(poster)}" style="width:36px;height:50px;object-fit:cover;border-radius:5px" alt="">` : ''}
                  <div><div>${esc(h.title)}</div><div class="faint">${h.episode} серия</div></div>
                  <span class="when">${new Date(h.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                  <button class="history-del" data-del="${index}" title="Удалить запись из истории">×</button>
                </div>`;
            }).join('')}`).join('')}
        </div>
      </div>`;

    root.querySelector('.page').addEventListener('click', async (e) => {
      const del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        store.removeHistoryAt(Number(del.dataset.del));
        return;
      }
      if (e.target.closest('[data-act="clear-history"]')) {
        if (await confirmDialog('Очистить всю историю просмотров? Отметки серий в библиотеке останутся.', { danger: true, ok: 'Очистить' })) {
          store.clearHistory();
          toast('История очищена', 'ok');
        }
        return;
      }
      const item = e.target.closest('[data-open]');
      if (item) location.hash = `#/anime/${item.dataset.open}`;
    });
  }

  draw();
  // Перерисовываемся и после изменений из других мест (например, «Очистить всё»)
  return store.onChange(draw);
}
