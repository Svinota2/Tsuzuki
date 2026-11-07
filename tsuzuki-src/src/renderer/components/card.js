// ============================================================
//  Карточка аниме для сетки (каталог и библиотека).
// ============================================================

// ------------------------------------------------------------
//  ИЗМЕНЕНО В 1.1 (Claude, 02.11.2026):
//  - shortNumber, число оценок на карточке
//  - значок «+N частей» и вид «стопки» для склеенных сезонов
// ------------------------------------------------------------

import { esc, titleOf, kindLabel, statusInfo, plural } from '../utils.js';
import { getEntry } from '../store.js';
import { CONFIG } from '../config.js';

// 12345 → «12 тыс.», 1500 → «1,5 тыс.», 1500000 → «1,5 млн»
export function shortNumber(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '').replace('.', ',') + ' млн';
  if (n >= 1e4) return Math.round(n / 1e3) + ' тыс.';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '').replace('.', ',') + ' тыс.';
  return String(n);
}

// anime — объект Shikimori ИЛИ запись из библиотеки (у них похожие поля)
// options.showPlus — показывать кнопку «+1 серия» (в библиотеке)
// options.stack — сколько ещё сезонов этой франшизы спрятано под карточкой
export function cardHtml(anime, { showPlus = false, stack = 0 } = {}) {
  const entry = getEntry(anime.id);
  const poster = anime.poster?.mainUrl || anime.poster || '';
  const title = anime.title || titleOf(anime);
  const year = anime.airedOn?.year || anime.year || '';
  // У записи из библиотеки есть поле watched, и score там — ТВОЯ оценка
  const isLibraryEntry = Array.isArray(anime.watched);
  const score = anime.score ? (isLibraryEntry ? String(anime.score) : Number(anime.score).toFixed(1)) : '';
  const status = entry?.status ? statusInfo(entry.status) : null;

  const total = entry?.episodes || anime.episodes || 0;
  const watched = entry?.watched?.length || 0;
  const progress = total && watched ? Math.min(100, (watched / total) * 100) : 0;

  const votes = (anime.scoresStats || []).reduce((sum, x) => sum + (x.count || 0), 0);
  const meta = [
    kindLabel(anime.kind),
    year,
    CONFIG.SHOW_VOTES && votes ? `${shortNumber(votes)} ${plural(votes, ['оценка', 'оценки', 'оценок'])}` : '',
  ].filter(Boolean).join(' · ');
  const epInfo = entry && watched ? ` · ${watched}${total ? '/' + total : ''} эп.` : '';

  return `
    <div class="card ${stack ? 'stacked' : ''}" data-open="${anime.id}" title="${esc(title)}">
      <div class="card-poster">
        ${stack ? `<span class="card-stack" title="Ещё ${stack} из этой франшизы (сезоны, фильмы, OVA) — список на странице тайтла">+${stack} ${plural(stack, ['часть', 'части', 'частей'])}</span>` : ''}
        ${poster ? `<img src="${esc(poster)}" loading="lazy" alt="">` : ''}
        ${score ? `<span class="card-score ${isLibraryEntry ? 'mine' : ''}" title="${isLibraryEntry ? 'Твоя оценка' : 'Оценка на Shikimori'}">★ ${score}</span>` : ''}
        ${status ? `<span class="card-badge" style="background:${status.color}" title="${esc(status.label)}"></span>` : ''}
        ${progress ? `<div class="card-progress"><div style="width:${progress}%"></div></div>` : ''}
        ${showPlus ? `<button class="card-plus" data-plus="${anime.id}" title="Отметить следующую серию">+1 серия</button>` : ''}
      </div>
      <div class="card-title">${esc(title)}</div>
      <div class="card-meta">${esc(meta)}${esc(epInfo)}</div>
    </div>`;
}

// ДОБАВЛЕНО В 1.4: заглушки-скелетоны, пока грузятся карточки
export function skeletonGrid(n = 8) {
  const one = `
    <div class="card skeleton-card">
      <div class="skeleton skeleton-poster"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line short"></div>
    </div>`;
  return `<div class="grid">${one.repeat(Math.max(1, Math.min(24, n)))}</div>`;
}
