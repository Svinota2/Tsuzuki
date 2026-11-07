// ============================================================
//  Мелкие помощники, которые нужны в разных местах.
// ============================================================

import { CONFIG } from './config.js';

// Экранирование текста перед вставкой в HTML (защищает от «поломанной» вёрстки)
export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Задержка вызова: функция сработает, только когда пользователь перестанет печатать
export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Описание на Shikimori содержит теги вида [character=1]Имя[/character] и [[Термин]].
// Убираем их, оставляя только текст.
export function cleanDescription(text) {
  if (!text) return '';
  let s = text;
  for (let i = 0; i < 3; i++) {
    s = s.replace(/\[(\w+)(?:=[^\]]*)?\]([\s\S]*?)\[\/\1\]/g, '$2');
  }
  s = s.replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\[[^\]]+\]/g, '');
  return s.trim();
}

// Название, которое показываем: русское, если есть, иначе оригинальное
export const titleOf = (anime) => anime?.russian || anime?.name || 'Без названия';

export const kindLabel = (kind) => CONFIG.KINDS[kind] || kind || '';
export const animeStatusLabel = (s) => CONFIG.ANIME_STATUSES[s] || s || '';
export const statusInfo = (id) => CONFIG.STATUSES.find((s) => s.id === id);

// Сколько серий у тайтла. Если неизвестно (онгоинг без даты конца) — вернёт 0.
export const totalEpisodes = (anime) => anime?.episodes || 0;

// Сколько серий уже вышло (для онгоингов это меньше, чем всего)
export function airedEpisodes(anime) {
  if (!anime) return 0;
  if (anime.status === 'released') return anime.episodes || anime.episodesAired || 0;
  return anime.episodesAired || 0;
}

// ------------------------------------------------------------
//  Номер серии из имени файла.
//  Если твои файлы называются как-то иначе и номер не находится —
//  добавь свой шаблон в начало списка PATTERNS.
// ------------------------------------------------------------
const PATTERNS = [
  /s\d{1,2}[\s._-]*e(\d{1,4})/i,                 // S01E05
  /(?:серия|эпизод|episode|ep\.?)[\s._-]*(\d{1,4})/i, // Серия 5, Episode 05, EP05
  /(\d{1,4})[\s._-]*(?:серия|эпизод)/i,          // 5 серия
  /\s-\s(\d{1,4})(?:v\d)?(?=[\s.[(_]|$)/,        // [Group] Title - 05 [1080p]
  /\[(\d{1,4})(?:v\d)?\]/,                       // Title [05]
  /^(\d{1,4})(?=[\s._-]|$)/,                     // 05.mkv / 05 - Title.mkv
  /(?:^|[\s._-])(\d{1,4})(?=[\s._-]*(?:\[|\(|$))/, // Title_05 (что-то)
];

export function parseEpisodeNumber(fileName) {
  // убираем расширение и типичные «шумные» числа: 1080p, x264, 2023 год и т.п.
  const name = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/\b(?:\d{3,4}p|[xh]\.?26[45]|10bit|8bit|(?:19|20)\d{2})\b/gi, ' ');
  for (const re of PATTERNS) {
    const m = name.match(re);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

// 75 → «1:15», 3725 → «1:02:05»
export function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Склонение: plural(5, ['серия','серии','серий']) → «серий»
export function plural(n, [one, few, many]) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// Всплывающее уведомление внизу экрана
export function toast(message, type = 'info') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.classList.add('hide'), 2800);
  setTimeout(() => el.remove(), 3200);
}

// Модальное подтверждение в стиле приложения (вместо системного window.confirm).
// Возвращает Promise<boolean>: true — OK, false — отмена/закрытие.
export function confirmDialog(text, { title = 'Tsuzuki', ok = 'OK', cancel = 'Отмена', danger = false } = {}) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `
      <div class="modal-box" role="dialog" aria-modal="true">
        <div class="modal-head">
          <span class="modal-title"></span>
          <button class="modal-x" data-act="cancel" title="Закрыть">×</button>
        </div>
        <div class="modal-text"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-act="cancel"></button>
          <button class="btn ${danger ? 'btn-danger-solid' : 'btn-accent'}" data-act="ok"></button>
        </div>
      </div>`;
    back.querySelector('.modal-title').textContent = title;
    back.querySelector('.modal-text').textContent = text;
    const [cancelBtn, okBtn] = back.querySelectorAll('.modal-actions .btn');
    cancelBtn.textContent = cancel;
    okBtn.textContent = ok;

    const close = (result) => {
      document.removeEventListener('keydown', onKey, true);
      back.remove();
      if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(true); }
    };
    back.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'ok') close(true);
      else if (act === 'cancel' || e.target === back) close(false);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back);
    requestAnimationFrame(() => okBtn.focus());
  });
}
