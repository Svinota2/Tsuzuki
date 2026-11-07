// ============================================================
//  ДОСТИЖЕНИЯ (ДОБАВЛЕНО В 1.4).
//  Каждое достижение — простой вопрос к данным приложения:
//  сколько серий отмечено, сколько оценок, что в истории и т.п.
//  Полученные хранятся в данных (state.achievements: id → дата).
// ============================================================

const MIN = 60 * 1000;

function entries(state) { return Object.values((state && state.library) || {}); }
function episodesWatched(state) { return entries(state).reduce((s, e) => s + (e.watched?.length || 0), 0); }
function titlesCount(state) { return entries(state).length; }
function scored(state) { return entries(state).filter((e) => Number(e.score) > 0).length; }
function completed(state) { return entries(state).filter((e) => e.status === 'completed').length; }
function kindsCount(state) { return new Set(entries(state).map((e) => e.kind).filter(Boolean)).size; }
function statusesCount(state) { return new Set(entries(state).map((e) => e.status).filter(Boolean)).size; }
function historyList(state) { return Array.isArray(state && state.history) ? state.history : []; }
function nightMarks(state) {
  return historyList(state).filter((h) => {
    const d = new Date(h.at);
    const hh = d.getHours();
    return hh >= 3 && hh < 6;
  }).length;
}
function weekEpisodes(state) {
  const limit = Date.now() - 7 * 24 * 60 * MIN;
  return historyList(state).filter((h) => new Date(h.at).getTime() >= limit).length;
}
function longestCompleted(state) {
  return entries(state).reduce((max, e) => (e.status === 'completed' ? Math.max(max, Number(e.episodes) || 0) : max), 0);
}
function ratedAvg(state) {
  const list = entries(state).filter((e) => Number(e.score) > 0);
  if (!list.length) return 0;
  return list.reduce((s, e) => s + Number(e.score), 0) / list.length;
}
function hasAllStatuses(state) { return statusesCount(state) >= 5; }

// { id, icon, title, desc, value(state), target }
export const ACHIEVEMENTS = [
  { id: 'first_ep', icon: '🎬', title: 'Первая серия', desc: 'Отметь первую серию', value: episodesWatched, target: 1 },
  { id: 'ep100', icon: '💯', title: 'Сотня', desc: '100 отмеченных серий', value: episodesWatched, target: 100 },
  { id: 'ep1000', icon: '🏆', title: 'Тысяча', desc: '1000 отмеченных серий', value: episodesWatched, target: 1000 },
  { id: 'ep5000', icon: '🚀', title: 'Космонавт', desc: '5000 отмеченных серий', value: episodesWatched, target: 5000 },
  { id: 'titles10', icon: '📚', title: 'Начало коллекции', desc: '10 тайтлов в библиотеке', value: titlesCount, target: 10 },
  { id: 'titles50', icon: '🗂', title: 'Коллекционер', desc: '50 тайтлов в библиотеке', value: titlesCount, target: 50 },
  { id: 'scored10', icon: '⭐', title: 'Первый десяток оценок', desc: 'Оцени 10 тайтлов', value: scored, target: 10 },
  { id: 'scored50', icon: '🌟', title: 'Ценитель', desc: 'Оцени 50 тайтлов', value: scored, target: 50 },
  { id: 'completed3', icon: '✅', title: 'До конца', desc: '3 досмотренных тайтла', value: completed, target: 3 },
  { id: 'completed10', icon: '🏁', title: 'Марафонец-финишёр', desc: '10 досмотренных тайтлов', value: completed, target: 10 },
  { id: 'long100', icon: '🐉', title: 'Долгострой', desc: 'Досмотри тайтл на 100+ серий', value: longestCompleted, target: 100 },
  { id: 'week50', icon: '⚡', title: 'Неделя марафона', desc: '50 серий за 7 дней', value: weekEpisodes, target: 50 },
  { id: 'night', icon: '🌙', title: 'Ночная смена', desc: 'Отметь серию после 3:00', value: nightMarks, target: 1 },
  { id: 'kinds', icon: '🎭', title: 'Всеядный', desc: 'Тайтлы 4 разных типов (ТВ, фильм, OVA, ONA…)', value: kindsCount, target: 4 },
  { id: 'statuses', icon: '🧭', title: 'Полный набор', desc: 'Есть тайтлы во всех пяти статусах', value: (s) => (hasAllStatuses(s) ? 5 : statusesCount(s)), target: 5 },
  { id: 'avg', icon: '⚖️', title: 'Своя мера', desc: 'Поставь оценки и держи среднюю выше 8', value: (s) => (scored(s) >= 10 ? Math.floor(ratedAvg(s) * 10) : 0), target: 80 },
];

export function earned(state) {
  return (state && state.achievements) || {};
}

// Проверяем, что уже получено и что открылось только что.
// Возвращает { fresh: [...достижения], map: {...все полученные} } — данные не меняет.
export function checkAchievements(state) {
  const have = { ...earned(state) };
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (have[a.id]) continue;
    let value = 0;
    try { value = Number(a.value(state)) || 0; } catch { value = 0; }
    if (value >= a.target) {
      have[a.id] = new Date().toISOString();
      fresh.push(a);
    }
  }
  return { fresh, map: have };
}

// Прогресс по достижению (для экрана «Достижения»)
export function progressOf(a, state) {
  let current = 0;
  try { current = Number(a.value(state)) || 0; } catch { current = 0; }
  const got = earned(state)[a.id];
  return { current: Math.min(current, a.target), target: a.target, done: !!got, date: got || null };
}
