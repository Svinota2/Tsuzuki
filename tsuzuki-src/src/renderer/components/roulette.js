// ============================================================
//  РУЛЕТКА «ЧТО ПОСМОТРЕТЬ СЕЙЧАС» (ДОБАВЛЕНО В 1.4).
//  Крутит карточки из «В планах» (или переданного списка) и останавливается
//  на одной. Помнит последние 5 — чтобы не повторяться.
// ============================================================

import { cardHtml } from './card.js';
import { esc, plural } from '../utils.js';
import * as store from '../store.js';

const LENGTHS = {
  any: 'Любая длина',
  movie: 'Фильм (до 3 серий)',
  short: 'Короткий (до 13)',
  mid: 'Средний (до 26)',
};
const KINDS = {
  any: 'Любой тип',
  tv: 'ТВ-сериал',
  movie: 'Фильм',
  ova: 'OVA',
  ona: 'ONA',
  special: 'Спешл',
};

function matches(entry, { length, kind }) {
  const eps = Number(entry.episodes) || 0;
  if (kind !== 'any' && entry.kind !== kind) return false;
  if (length === 'movie' && eps > 3) return false;
  if (length === 'short' && !(eps > 0 && eps <= 13)) return false;
  if (length === 'mid' && !(eps > 13 && eps <= 26)) return false;
  return true;
}

export function openRoulette(candidates, { title = 'Что посмотреть сейчас' } = {}) {
  const all = (candidates || []).filter((e) => e && Number(e.id) > 0 && !e.manual);
  if (!all.length) return false;

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.id = 'roulette-modal';
  modal.innerHTML = `
    <div class="modal-box roulette-box">
      <div class="modal-head">
        <span class="modal-title">🎲 ${esc(title)}</span>
        <button class="modal-x" data-act="close" title="Закрыть">×</button>
      </div>
      <div class="roulette-filters">
        <select class="select" data-filter="length">
          ${Object.entries(LENGTHS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
        </select>
        <select class="select" data-filter="kind">
          ${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
        </select>
      </div>
      <div class="roulette-stage" data-stage></div>
      <div class="roulette-result-name" data-name></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-act="close">Закрыть</button>
        <button class="btn" data-act="spin">Крутить</button>
        <button class="btn btn-accent" data-act="open" disabled>Открыть</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const stage = modal.querySelector('[data-stage]');
  const nameEl = modal.querySelector('[data-name]');
  const openBtn = modal.querySelector('[data-act="open"]');
  let chosen = null;
  let spinTimer = null;

  const pool = () => {
    const filters = {
      length: modal.querySelector('[data-filter="length"]').value,
      kind: modal.querySelector('[data-filter="kind"]').value,
    };
    let list = all.filter((e) => matches(e, filters));
    if (!list.length) list = all;
    const recent = new Set(store.getRouletteHistory());
    const fresh = list.filter((e) => !recent.has(String(e.id)));
    return fresh.length ? fresh : list;
  };

  const renderCard = (entry) => {
    stage.innerHTML = `<div class="roulette-card">${cardHtml(entry)}</div>`;
  };

  function close() {
    if (spinTimer) clearTimeout(spinTimer);
    modal.remove();
  }

  function spin() {
    if (spinTimer) clearTimeout(spinTimer);
    const list = pool();
    if (!list.length) return;
    openBtn.disabled = true;
    chosen = null;
    nameEl.textContent = '';
    modal.classList.add('roulette-spinning');
    const final = list[Math.floor(Math.random() * list.length)];

    // 20 шагов с замедлением — «прокрутка»
    let step = 0;
    const total = 20;
    const tick = () => {
      if (step >= total) {
        modal.classList.remove('roulette-spinning');
        chosen = final;
        renderCard(final);
        const n = Number(final.episodes) || 0;
        nameEl.innerHTML = `${esc(final.title)}${n ? ` <span class="faint">· ${n} ${plural(n, ['серия', 'серии', 'серий'])}</span>` : ''}`;
        openBtn.disabled = false;
        return;
      }
      renderCard(list[Math.floor(Math.random() * list.length)]);
      step++;
      const delay = 60 + Math.pow(step / total, 2) * 260; // ускоряется к концу
      spinTimer = setTimeout(tick, delay);
    };
    tick();
  }

  modal.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) { if (e.target === modal) close(); return; }
    if (act === 'close') return close();
    if (act === 'spin') return spin();
    if (act === 'open' && chosen) {
      store.pushRoulette(chosen.id);
      location.hash = `#/anime/${chosen.id}`;
      close();
    }
  });

  // Первый «прокрут» сразу при открытии
  spin();
  return true;
}
