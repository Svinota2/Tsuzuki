// ============================================================
//  СТАТУС В DISCORD (ДОБАВЛЕНО В 1.6.2)
//  Раньше статус был только в плеере своих файлов. Теперь он есть
//  во всём приложении:
//    плеер        → «Тайтл» / «Серия 5 из 12» (как и раньше, главнее всего);
//    остальное    → что ты сейчас делаешь: «Ищет аниме», «Выбирает, что
//                   посмотреть: <тайтл>», «Разбирает список: Смотрю»…
//
//  Включается пунктом «Статус в Discord» в настройках; показ разделов и
//  открытых тайтлов можно выключить отдельно («Показывать в статусе, что
//  открыто в приложении») — тогда статус будет только в плеере.
//
//  Discord принимает не больше ~5 обновлений за 20 секунд, поэтому
//  обновления копятся и уходят не чаще раза в MIN_GAP_MS.
//  Отправка — window.api.discordSet → src/main/extras.js → setPresence.
//  На Android статуса нет (там window.api.discordSet — заглушка).
// ============================================================

import { CONFIG } from '../config.js';

const MIN_GAP_MS = 4500;      // между отправками в Discord
const SETTLE_MS = 700;        // ждём, пока пользователь «остановится» на разделе
const appStart = Date.now();  // «в Tsuzuki уже 25 минут»

let playing = null;   // статус плеера
let browsing = null;  // что открыто сейчас
let lastKey = null;   // что отправили последним (чтобы не слать одно и то же)
let lastAt = 0;
let timer = null;

const enabled = () => !!(CONFIG.DISCORD_PRESENCE && window.api && window.api.discordSet);

function wanted() {
  if (!enabled()) return null;
  if (playing) return playing;
  if (CONFIG.DISCORD_PRESENCE_BROWSE === false || !browsing) return null;
  return { kind: 'browse', details: browsing.details, state: browsing.state, startedAt: appStart };
}

function flush() {
  timer = null;
  const data = wanted();
  const key = JSON.stringify(data);
  if (key === lastKey) return;
  const wait = lastAt + MIN_GAP_MS - Date.now();
  if (wait > 0) { timer = setTimeout(flush, wait); return; }
  lastKey = key;
  lastAt = Date.now();
  if (!window.api || !window.api.discordSet) return;
  window.api.discordSet(data).catch(() => {});
}

function schedule(delay) {
  clearTimeout(timer);
  timer = setTimeout(flush, delay);
}

// Плеер: data = { title, episode, total, startedAt } или null
export function setPlaying(data) {
  playing = data ? { kind: 'play', ...data } : null;
  schedule(0);
}

// Настройки поменялись (включили/выключили статус) — применяем сразу
export function refresh() {
  schedule(0);
}

// Подписи разделов. Хочешь другие слова — меняй здесь.
function describe(name, params, root) {
  const h1 = () => (root.querySelector('h1.anime-title')?.textContent || '').trim();
  switch (name) {
    case 'catalog':  return ['Ищет аниме', 'Каталог'];
    case 'anime':    return ['Выбирает, что посмотреть', h1() || 'Страница тайтла'];
    case 'library': {
      const s = (CONFIG.STATUSES || []).find((x) => x.id === params[0]);
      return ['Разбирает свой список', s ? s.label : 'Библиотека'];
    }
    case 'history':  return ['Вспоминает, что смотрел', 'История'];
    case 'calendar': return ['Ждёт новые серии', 'Календарь онгоингов'];
    case 'stats':    return ['Изучает свою статистику', 'Статистика'];
    case 'recap':    return ['Подводит итоги года', params[0] ? `Итоги ${params[0]}` : 'Итоги года'];
    case 'discover': return ['Ищет, что посмотреть', 'Подборка «Для тебя»'];
    case 'people':   return ['Смотрит профили Shikimori', params[0] ? (h1() || 'Профиль') : 'Люди'];
    case 'player':   return null; // у плеера свой статус (setPlaying)
    case 'watch':    return null; // ИЗМЕНЕНО В 1.6.3: у онлайн-плеера свой статус
    default:         return ['В Tsuzuki', ''];
  }
}

// Вызывается из app.js после открытия раздела
export function onRoute(name, params, root) {
  let d = null;
  try { d = describe(name, params || [], root); } catch { d = ['В Tsuzuki', '']; }
  browsing = d ? { details: d[0], state: d[1] || '' } : browsing;
  schedule(SETTLE_MS);
}
