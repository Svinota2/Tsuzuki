// ============================================================
//  Точка входа интерфейса и «маршрутизатор».
//  Адрес вида #/anime/52991 → вызывается нужный раздел из views/.
//  Чтобы добавить раздел: создай views/мой-раздел.js с функцией
//  render(root, params) и допиши его в ROUTES.
// ============================================================

// ------------------------------------------------------------
//  ИЗМЕНЕНО В 1.1 (Claude, 02.11.2026):
//  - applyCustom() при запуске
//  - backfillMeta — дозаполняет франшизу и оценку Shikimori у старых записей
// ------------------------------------------------------------

import { initStore, onChange, countByStatus, listEntries, getPrefs, getState, setAchievements, entriesMissingMeta, applyMeta, markMetaAttempted } from './store.js';
import { checkAchievements } from './achievements.js';
import { applyCustom } from './custom.js';
import { getAnimesByIds } from './api/shikimori.js';
import { applyAccent } from './theme.js';
import { toast } from './utils.js';
import * as catalog from './views/catalog.js';
import * as anime from './views/anime.js';
import * as library from './views/library.js';
import * as history from './views/history.js';
import * as calendar from './views/calendar.js';
import * as stats from './views/stats.js';
import * as add from './views/add.js';
import * as player from './views/player.js';
import * as watch from './views/watch.js';
import * as services from './views/services.js';
import * as settings from './views/settings.js';
import * as privacy from './views/privacy.js';
import * as discover from './views/discover.js';
import * as people from './views/people.js';
import * as recap from './views/recap.js'; // ДОБАВЛЕНО В 1.5
import * as autoscan from './views/autoscan.js'; // ДОБАВЛЕНО В 1.5
import { checkNewEpisodes } from './api/notifications.js';
import { startAutoSync } from './api/shikimori-sync.js';
import { initUpdater } from './api/updater.js';
import { onRoute as presenceOnRoute } from './api/presence.js'; // ДОБАВЛЕНО В 1.6.2: статус в Discord во всём приложении
import { startTelemetry, showConsent, needsConsent } from './api/telemetry.js';

const ROUTES = {
  catalog,   // #/catalog
  anime,     // #/anime/<id>
  library,   // #/library/<статус>
  history,   // #/history
  calendar,  // #/calendar
  stats,     // #/stats
  add,       // #/add/<id своей записи>
  player,    // #/player/<id>/<номер файла>
  watch,     // #/watch/<id>/<озвучка>/<сезон>/<серия>
  services,  // #/services
  settings,  // #/settings
  privacy,   // #/privacy — политика конфиденциальности
  discover,  // #/discover — «Для тебя» (1.3)
  people,    // #/people и #/people/<id> — люди Shikimori (1.4)
  recap,     // #/recap/<год> — итоги года (1.5)
  autoscan,  // #/autoscan — автораскладка папки с аниме (1.5)
};

const root = document.getElementById('view');
let cleanup = null; // функция, которую текущий раздел просит вызвать при уходе
let navToken = 0;   // защита от гонки: медленный раздел не должен рисоваться поверх нового

async function navigate() {
  const token = ++navToken;
  const [name = 'catalog', ...params] = location.hash.replace(/^#\/?/, '').split('/');
  const view = ROUTES[name] || catalog;

  if (typeof cleanup === 'function') cleanup();
  cleanup = null;

  document.querySelectorAll('.nav a').forEach((a) => {
    // ИЗМЕНЕНО В 1.5: подразделы подсвечивают «родителя» в меню
    const parent = { anime: 'catalog', recap: 'stats', autoscan: 'settings', privacy: 'settings' }[name];
    a.classList.toggle('active', a.dataset.route === name || a.dataset.route === parent);
  });

  try {
    const result = await view.render(root, params.map(decodeURIComponent));
    if (token !== navToken) {
      // Пока грузился этот раздел, пользователь ушёл в другой — убираем за собой
      if (typeof result === 'function') result();
      return;
    }
    cleanup = result;
    // ДОБАВЛЕНО В 1.6.2: статус в Discord — что сейчас открыто (см. api/presence.js)
    presenceOnRoute(name, params.map(decodeURIComponent), root);
    // ДОБАВЛЕНО В 1.4: плавное появление раздела и карточек
    animateEnter();
  } catch (err) {
    if (token !== navToken) return;
    console.error(err);
    root.innerHTML = `<div class="empty"><div class="empty-big">⚠</div>Что-то пошло не так:<br><span class="faint">${err.message}</span></div>`;
  }
}

// ДОБАВЛЕНО В 1.4: плавное появление нового раздела (и лёгкая «лесенка» карточек)
let enterTimer = null;
function animateEnter() {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  root.classList.remove('view-enter');
  // принудительный перезапуск анимации
  void root.offsetWidth;
  root.classList.add('view-enter');
  clearTimeout(enterTimer);
  enterTimer = setTimeout(() => root.classList.remove('view-enter'), 700);
}

// ДОБАВЛЕНО В 1.4: проверка достижений (после изменений, с задержкой)
let achTimer = null;
function runAchievements() {
  clearTimeout(achTimer);
  achTimer = setTimeout(() => {
    try {
      const { fresh, map } = checkAchievements(getState());
      if (!fresh.length) return;
      setAchievements(map);
      if (fresh.length === 1) toast(`Достижение: ${fresh[0].title}`, 'ok');
      else toast(`Новые достижения: ${fresh.slice(0, 3).map((a) => a.title).join(', ')}${fresh.length > 3 ? ` и ещё ${fresh.length - 3}` : ''}`, 'ok');
    } catch (err) {
      console.warn('Достижения:', err);
    }
  }, 1200);
}

// Счётчики внизу бокового меню
function renderSidebarStats() {
  const counts = countByStatus();
  const episodes = listEntries('all').reduce((sum, e) => sum + (e.watched?.length || 0), 0);
  document.getElementById('sidebar-stats').innerHTML =
    `Смотрю: <b>${counts.watching}</b><br>Просмотрено: <b>${counts.completed}</b><br>Серий всего: <b>${episodes}</b>`;
}

async function start() {
  await initStore();
  // Блокировка рекламы включена по умолчанию (можно выключить в «Настройках»)
  window.api.setAdblock(getPrefs().adblock !== false).catch(() => {});
  applyAccent();
  applyCustom(); // тема, размеры, настройки из «Внешний вид и поведение»
  renderSidebarStats();
  onChange(renderSidebarStats);
  // ДОБАВЛЕНО В 1.4: проверяем достижения при запуске и после изменений
  onChange(runAchievements);
  setTimeout(runAchievements, 1500);
  window.addEventListener('hashchange', navigate);
  window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message || 'Ошибка', 'error'));
  if (!location.hash) location.hash = '#/catalog';
  else navigate();

  // Проверяем новые серии в фоне, чтобы не задерживать запуск
  setTimeout(checkNewEpisodes, 1200);
  // Дозаполняем франшизу и оценку Shikimori у старых записей (для склейки сезонов и статистики)
  setTimeout(backfillMeta, 4000);

  // ---------- НОВОЕ В 1.3 ----------
  // Синхронизация с Shikimori: вход уже сохранён — синхронизируем при запуске и по изменениям
  startAutoSync();
  // Автообновление: слушаем статус и показываем плашку
  initUpdater();
  // Анонимная статистика: экран согласия при первом запуске, иначе одно событие в сутки
  if (needsConsent()) showConsent();
  else startTelemetry();
  // Клик по системному уведомлению о новой серии открывает страницу тайтла
  if (window.api.onNavigate) {
    window.api.onNavigate((id) => { if (id) location.hash = `#/anime/${id}`; });
  }
}

async function backfillMeta() {
  const missing = entriesMissingMeta();
  if (!missing.length) return;
  try {
    const list = await getAnimesByIds(missing.map((e) => e.id));
    applyMeta(list);
    // Если на Shikimori тайтла нет — помечаем попытку, чтобы не спрашивать
    // его при каждом запуске.
    const found = new Set((list || []).map((a) => String(a.id)));
    markMetaAttempted(missing.filter((e) => !found.has(String(e.id))).map((e) => e.id));
  } catch (err) {
    console.warn('Не удалось дозаполнить сведения о тайтлах:', err);
  }
}

start();
