// НОВЫЙ ФАЙЛ В 1.1 (Claude, 02.11.2026): раздел «Внешний вид и поведение»
// ============================================================
//  КАСТОМИЗАЦИЯ.
//  Всё, что можно настроить мышкой в «Настройках» → «Внешний вид и поведение».
//
//  Хочешь добавить свой пункт — допиши объект в OPTIONS:
//    { key, label, type, group, ... }
//  type: 'range' (min, max, step, unit), 'toggle', 'select' (choices)
//  Если key совпадает с полем CONFIG (config.js) — значение просто
//  перекроет его. Если нет — опиши, что делать, в apply ниже.
//  Значения хранятся в твоём файле данных (prefs.custom).
// ============================================================

import { CONFIG } from './config.js';
import { getPrefs, setPref } from './store.js';

// Исходные значения CONFIG — чтобы можно было вернуть «как было»
const DEFAULTS = { ...CONFIG };

export const THEMES = {
  dark: 'Тёмная',
  oled: 'Чёрная (OLED)',
  dusk: 'Сине-серая',
  light: 'Светлая',
};

export const GROUPS = {
  look: 'Внешний вид',
  catalog: 'Каталог и поиск',
  home: 'Главная',
  tracker: 'Трекер и плеер',
  system: 'Система', // ИЗМЕНЕНО В 1.3
};

export const OPTIONS = [
  // ---------- Внешний вид ----------
  { key: 'theme', group: 'look', label: 'Тема', type: 'select', choices: THEMES, def: 'dark' },
  { key: 'uiScale', group: 'look', label: 'Масштаб интерфейса', type: 'range', min: 80, max: 130, step: 5, unit: '%', def: 100 },
  { key: 'cardWidth', group: 'look', label: 'Размер карточек', type: 'range', min: 120, max: 260, step: 4, unit: 'px', def: 172 },
  { key: 'radius', group: 'look', label: 'Скругление углов', type: 'range', min: 0, max: 22, step: 1, unit: 'px', def: 12 },
  { key: 'sidebarWidth', group: 'look', label: 'Ширина бокового меню', type: 'range', min: 170, max: 300, step: 5, unit: 'px', def: 220 },
  { key: 'SHOW_SIDEBAR_STATS', group: 'look', label: 'Счётчики внизу меню', type: 'toggle' },
  { key: 'animations', group: 'look', label: 'Анимации', type: 'toggle', def: true },

  // ---------- Каталог ----------
  { key: 'DEFAULT_ORDER', group: 'catalog', label: 'Сортировка по умолчанию', type: 'select', choices: () => CONFIG.ORDERS },
  { key: 'MIN_VOTES', group: 'catalog', label: 'Минимум оценок для «Лучших»', type: 'range', min: 0, max: 20000, step: 500, unit: '' },
  { key: 'PAGE_SIZE', group: 'catalog', label: 'Тайтлов за одну подгрузку', type: 'range', min: 10, max: 50, step: 5, unit: '' },
  { key: 'STACK_FRANCHISES', group: 'catalog', label: 'Склеивать сезоны одной франшизы', type: 'toggle' },
  { key: 'STRICT_SEARCH', group: 'catalog', label: 'Строгий поиск: только где есть все слова запроса', type: 'toggle' },
  { key: 'HIDE_JUNK_KINDS', group: 'catalog', label: 'Прятать клипы, рекламу и промо', type: 'toggle' },
  { key: 'HIDE_NO_POSTER', group: 'catalog', label: 'Прятать тайтлы без постера', type: 'toggle' },
  { key: 'HIDE_ANONS', group: 'catalog', label: 'Прятать анонсы (ещё не вышло)', type: 'toggle' },
  { key: 'SHOW_VOTES', group: 'catalog', label: 'Показывать число оценок на карточках', type: 'toggle' },

  // ---------- Главная ----------
  { key: 'SHOW_NEWS', group: 'home', label: 'Блок «Вышли новые серии»', type: 'toggle' },
  { key: 'SHOW_CONTINUE', group: 'home', label: 'Блок «Продолжить просмотр»', type: 'toggle' },
  { key: 'CONTINUE_LIMIT', group: 'home', label: 'Карточек в «Продолжить просмотр»', type: 'range', min: 1, max: 12, step: 1, unit: '' },
  { key: 'CONTINUE_MAX_DAYS', group: 'home', label: 'Убирать из «Продолжить» через (дней, 0 — никогда)', type: 'range', min: 0, max: 180, step: 5, unit: '' },
  { key: 'CONTINUE_HIDE_COMPLETED', group: 'home', label: 'Не показывать в «Продолжить» досмотренное', type: 'toggle' },

  // ---------- Трекер и плеер ----------
  { key: 'AUTO_STATUS', group: 'tracker', label: 'Менять статус автоматически', type: 'toggle' },
  { key: 'AUTO_MARK_PERCENT', group: 'tracker', label: 'Отмечать серию просмотренной на', type: 'range', min: 50, max: 100, step: 5, unit: '%' },
  { key: 'AUTOPLAY_NEXT', group: 'tracker', label: 'Включать следующую серию (свои файлы)', type: 'toggle' },
  // ДОБАВЛЕНО В 1.5: нужен DISCORD_CLIENT_ID в src/main/settings.js; на ТВ пункт ничего не делает
  { key: 'DISCORD_PRESENCE', group: 'tracker', label: 'Статус в Discord при просмотре своих файлов', type: 'toggle' },
  // ---------- Система (ИЗМЕНЕНО В 1.3) ----------
  { key: 'autoUpdate', group: 'system', label: 'Проверять обновления автоматически', type: 'toggle', def: true },
  { key: 'closeToTray', group: 'system', label: 'Сворачивать в трей при закрытии окна (ПК)', type: 'toggle', def: false },
  { key: 'backgroundNotify', group: 'system', label: 'Проверять новые серии в фоне и показывать уведомления', type: 'toggle', def: true },
  { key: 'autostart', group: 'system', label: 'Запускать вместе с системой', type: 'toggle', def: false },
  { key: 'telemetry', group: 'system', label: 'Отправлять анонимную статистику использования', type: 'toggle', def: false },
];

// Текущее значение пункта: сохранённое → значение из CONFIG → def
export function valueOf(opt) {
  // ИЗМЕНЕНО В 1.3: согласие на статистику хранится отдельно (может быть null)
  if (opt.key === 'telemetry') return getPrefs().telemetry === true;
  const saved = getPrefs().custom?.[opt.key];
  if (saved !== undefined) return saved;
  if (opt.key in DEFAULTS) return DEFAULTS[opt.key];
  return opt.def;
}

export function setOption(key, value) {
  // ИЗМЕНЕНО В 1.3: статистика — отдельная настройка
  if (key === 'telemetry') {
    setPref('telemetry', !!value);
    return applyCustom();
  }
  const custom = { ...(getPrefs().custom || {}), [key]: value };
  setPref('custom', custom);
  applyCustom();
}

export function resetCustom() {
  setPref('custom', {});
  Object.assign(CONFIG, DEFAULTS);
  applyCustom();
}

// Применить всё: значения CONFIG и CSS-переменные
let lastAutostart = null; // чтобы не дёргать систему на каждую перерисовку

export function applyCustom() {
  const values = Object.fromEntries(OPTIONS.map((o) => [o.key, valueOf(o)]));

  // 1. Пункты, совпадающие с CONFIG, просто перекрывают его
  for (const o of OPTIONS) if (o.key in DEFAULTS) CONFIG[o.key] = values[o.key];

  // 2. Внешний вид — через CSS-переменные (их список в styles/theme.css)
  const root = document.documentElement;
  root.dataset.theme = values.theme;
  root.style.setProperty('--card-width', values.cardWidth + 'px');
  root.style.setProperty('--radius', values.radius + 'px');
  root.style.setProperty('--radius-sm', Math.round(values.radius * 0.66) + 'px');
  root.style.setProperty('--sidebar-width', values.sidebarWidth + 'px');
  root.style.zoom = values.uiScale / 100;
  root.classList.toggle('no-anim', !values.animations);

  const stats = document.getElementById('sidebar-stats');
  if (stats) stats.style.display = values.SHOW_SIDEBAR_STATS ? '' : 'none';

  // 3. ИЗМЕНЕНО В 1.3: системные переключатели передаём главному процессу
  //    (на ТВ этих методов нет — там заглушки, поэтому всё в try/catch).
  try {
    if (window.api?.setCloseToTray) window.api.setCloseToTray(values.closeToTray === true).catch(() => {});
    if (window.api?.setBackgroundNotify) window.api.setBackgroundNotify(values.backgroundNotify !== false).catch(() => {});
    if (window.api?.setAutostart && lastAutostart !== (values.autostart === true)) {
      lastAutostart = values.autostart === true;
      window.api.setAutostart(lastAutostart).catch(() => {});
    }
    // ИЗМЕНЕНО В 1.6: «Проверять обновления автоматически» теперь реально
    // выключает фоновую проверку в главном процессе (а не только плашку).
    if (window.api?.updateSetAuto) window.api.updateSetAuto(values.autoUpdate !== false).catch(() => {});
  } catch { /* на ТВ может не быть системных функций — не мешаем */ }
}
