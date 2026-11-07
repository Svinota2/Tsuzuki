// Тест 1.2: наши правки (тема, импорт, клик по серии, кнопки) + регресс.
import fs from 'node:fs';
const PORT = Number(process.env.TSUZUKI_PORT || 9350);
const OUT = process.env.TSUZUKI_OUT || 'shots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function targets() {
  for (let i = 0; i < 60; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch {}
    await sleep(500);
  }
  throw new Error('no CDP');
}
const list = await targets();
const page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const waiting = new Map(); const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id) { const p = waiting.get(m.id); if (p) { waiting.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception?.description || '').slice(0, 300));
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return { value: r.result?.value };
}
const shot = async (name) => { if (!shot.pageEnabled) { await send('Page.enable'); shot.pageEnabled = true; } try { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}\\${name}.png`, Buffer.from(data, 'base64')); } catch {} };
await send('Runtime.enable');
const out = {};

// 1. Тема: смена с всплытием события + сохранение после перезагрузки
await ev(`location.hash = '#/settings'`); await sleep(2000);
out.theme = (await ev(`(async () => {
  const sel = document.querySelector('[data-opt="theme"]');
  const before = document.documentElement.dataset.theme;
  const values = [...sel.options].map((o) => o.value);
  const target = values.includes('oled') ? 'oled' : values[0];
  sel.value = target;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 700));
  return { values, target, before, after: document.documentElement.dataset.theme, pref: (await window.api.loadData()).prefs.custom?.theme };
})()`)).value;
await ev('location.reload()'); await sleep(4000);
await send('Runtime.enable');
out.themeAfterReload = (await ev(`({ theme: document.documentElement.dataset.theme })`)).value;
// вернуть тёмную
await ev(`location.hash = '#/settings'`); await sleep(1500);
await ev(`(() => { const sel = document.querySelector('[data-opt="theme"]'); if (sel) { sel.value = 'dark'; sel.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
await sleep(700);
await ev(`location.hash = '#/catalog'`); await sleep(2500);
await shot('12-01-catalog');

// 2. Импорт MAL (файл не нужен, проверяем парсер и запись)
out.importMal = (await ev(`(async () => {
  const m = await import('./api/importers.js');
  const xml = '<?xml version="1.0" encoding="UTF-8"?><myanimelist><anime><series_animedb_id>16498</series_animedb_id><series_title>AoT</series_title><my_watched_episodes>5</my_watched_episodes><my_score>9</my_score><my_status>1</my_status></anime></myanimelist>';
  const rates = m.parseMalXml(xml);
  const r = await m.applyImport(rates, { mode: 'overwrite' });
  const d = await window.api.loadData();
  const e = d.library['16498'];
  return { rates, r, entry: e ? { watched: e.watched, score: e.score, status: e.status } : null, hasApi: { openTextFile: typeof window.api.openTextFile, anilist: typeof window.api.anilist } };
})()`)).value;

// 3. Клик по серии открывает плеер и отмечает просмотренной
await ev(`location.hash = '#/anime/16498'`); await sleep(6000);
out.anime = (await ev(`(() => ({
  onlineButtons: document.querySelectorAll('.btn-online').length,
  onlineBox: (() => { const b = document.querySelector('.actions .btn-online, .watch-box .btn-online'); if (!b) return null; const s = getComputedStyle(b); return { text: b.innerText, h: Math.round(b.getBoundingClientRect().height), padding: s.padding, bg: s.backgroundColor }; })(),
  episodes: document.querySelectorAll('.episodes .ep').length,
}))()`)).value;
await shot('12-02-anime');
const epRect = (await ev(`(() => { const b = document.querySelector('[data-ep="3"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`)).value;
if (epRect) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: epRect.x, y: epRect.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: epRect.x, y: epRect.y, button: 'left', clickCount: 1 });
}
await sleep(5000);
out.afterEpisodeClick = (await ev(`(async () => {
  const d = await window.api.loadData();
  return {
    hash: location.hash,
    watched16498: d.library['16498']?.watched || [],
    historyTop: (d.history || [])[0] || null,
    tr: document.querySelectorAll('#translations .file').length,
    epLabel: document.querySelector('#ep-label')?.innerText || '',
    titleLink: (() => { const a = document.querySelector('.player-top a.t'); return a ? { text: a.innerText.slice(0, 40), href: a.getAttribute('href') } : null; })(),
  };
})()`)).value;
await shot('12-03-watch');

// 4. adblock на реальном сайте в окне сервисов
out.adblockBefore = (await ev('window.api.adblockStats()')).value;
await ev(`window.api.openWeb('https://lenta.ru/', 'adblock-check')`); await sleep(12000);
out.adblockAfter = (await ev('window.api.adblockStats()')).value;

out.errors = errors;
console.log(JSON.stringify(out, null, 2));
ws.close();
process.exit(0);
