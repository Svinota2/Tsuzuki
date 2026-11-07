// ============================================================
//  МИНИ-ПЛЕЕР (ДОБАВЛЕНО В 1.6.3): логика окна.
//  Управление: играть/пауза, перемотка, серии, звук, булавка
//  «поверх всех», закрыть / вернуть в основное окно.
//  Всё общение с приложением идёт через window.mini (preload-mini.js).
// ============================================================

const video = document.getElementById('video');
const $ = (id) => document.getElementById(id);

let list = [];        // [{ url, name, ep }]
let index = 0;
let title = '';
let total = 0;
let pinned = true;
let idleTimer = null;
let lastReport = 0;
let startedAt = Date.now();

const fmt = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

function episodeNow() {
  const item = list[index] || {};
  return Number(item.ep) || 0;
}

function drawTitle() {
  const ep = episodeNow();
  $('title').textContent = ep
    ? `${title} · Серия ${ep}${total ? ' из ' + total : ''}`
    : title;
}

function drawButtons() {
  $('play').textContent = video.paused ? '▶' : '⏸';
  $('prev').disabled = index <= 0;
  $('next').disabled = index >= list.length - 1;
  $('mute').textContent = video.muted || video.volume === 0 ? '🔇' : '🔊';
  $('pin').classList.toggle('on', pinned);
  document.getElementById('app').classList.toggle('topmost', pinned);
}

function report(event, extra = {}) {
  try {
    window.mini.update({
      event,
      index,
      episode: episodeNow(),
      time: video.currentTime || 0,
      startedAt,
      ...extra,
    });
  } catch { /* ignore */ }
}

function load(i, time = 0) {
  index = Math.max(0, Math.min(Number(i) || 0, list.length - 1));
  const item = list[index];
  if (!item) return;
  startedAt = Date.now();
  video.src = item.url;
  video.currentTime = Math.max(0, Number(time) || 0);
  drawTitle();
  drawButtons();
  video.play().catch(() => { /* автозапуск может быть запрещён — ничего */ });
}

// ---------- Инициализация от приложения ----------
window.mini.onInit((data) => {
  if (!data) return;
  list = Array.isArray(data.list) ? data.list : [];
  title = String(data.title || 'Tsuzuki');
  total = Number(data.total) || 0;
  load(Number(data.index) || 0, Number(data.time) || 0);
  window.mini.state().then((s) => {
    pinned = !!(s && s.onTop);
    drawButtons();
  }).catch(() => {});
});

// ---------- Кнопки ----------
$('play').addEventListener('click', () => {
  if (video.paused) video.play().catch(() => {});
  else video.pause();
});
$('prev').addEventListener('click', () => {
  if (index > 0) load(index - 1, 0);
});
$('next').addEventListener('click', () => {
  if (index < list.length - 1) load(index + 1, 0);
});
$('mute').addEventListener('click', () => {
  video.muted = !video.muted;
  drawButtons();
});
$('pin').addEventListener('click', async () => {
  try {
    const res = await window.mini.pin();
    pinned = !!(res && res.on);
    drawButtons();
  } catch { /* ignore */ }
});
$('close').addEventListener('click', () => window.mini.close());
$('to-main').addEventListener('click', () => window.mini.toMain());

$('seek').addEventListener('input', () => {
  if (!Number.isFinite(video.duration) || !video.duration) return;
  video.currentTime = (Number($('seek').value) / 1000) * video.duration;
});

// ---------- События видео ----------
video.addEventListener('timeupdate', () => {
  const d = video.duration || 0;
  if (d) $('seek').value = String(Math.round((video.currentTime / d) * 1000));
  $('time').textContent = fmt(video.currentTime);
  const now = Date.now();
  if (now - lastReport > 4000) { // раз в 4 секунды — основному окну и Discord
    lastReport = now;
    report('time');
  }
});
video.addEventListener('play', () => { drawButtons(); report('play'); });
video.addEventListener('pause', () => { drawButtons(); report('pause'); });
video.addEventListener('ended', () => {
  report('time');
  if (index < list.length - 1) load(index + 1, 0);
});
video.addEventListener('click', () => {
  if (video.paused) video.play().catch(() => {});
  else video.pause();
});
video.addEventListener('dblclick', () => {
  // двойной клик — на весь экран (внутри мини-окна)
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.().catch(() => {});
});

// ---------- Клавиатура ----------
document.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'Space': e.preventDefault(); video.paused ? video.play().catch(() => {}) : video.pause(); break;
    case 'ArrowRight': e.preventDefault(); video.currentTime += 5; break;
    case 'ArrowLeft': e.preventDefault(); video.currentTime -= 5; break;
    case 'KeyN': if (index < list.length - 1) load(index + 1, 0); break;
    case 'KeyP': if (index > 0) load(index - 1, 0); break;
    case 'KeyM': video.muted = !video.muted; drawButtons(); break;
    case 'Escape': window.mini.close(); break;
  }
});

// ---------- Прячем полосы, когда мышь не двигается ----------
function showUI() {
  const app = document.getElementById('app');
  app.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => app.classList.add('idle'), 2500);
}
document.addEventListener('mousemove', showUI);
document.addEventListener('mouseleave', () => document.getElementById('app').classList.add('idle'));
showUI();
