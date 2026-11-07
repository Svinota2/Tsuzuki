// Диагностика клика по серии (item 9) и проверка watch после перехода.
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
  if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception?.description || '').slice(0, 400));
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return { value: r.result?.value };
}
const shot = async (name) => { try { const { data } = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}\\${name}.png`, Buffer.from(data, 'base64')); } catch {} };
await send('Runtime.enable'); await send('Page.enable'); await sleep(2500);
const out = {};

// отметить клики
await ev(`window.__clicks = []; window.__clicksLog = (e) => { window.__clicks.push({ tag: e.target.tagName, cls: String(e.target.className || '').slice(0, 40), ep: e.target.dataset ? e.target.dataset.ep : null, detail: e.detail }); }; document.addEventListener('click', window.__clicksLog, true); 'ok'`);

await ev(`location.hash = '#/anime/16498'`); await sleep(6500);
out.before = (await ev(`(() => {
  const b = document.querySelector('[data-ep="3"]');
  if (!b) return { found: false };
  b.scrollIntoView({ block: 'center' });
  const r = b.getBoundingClientRect();
  const el = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
  return { found: true, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, viewport: { w: innerWidth, h: innerHeight }, hit: el ? { tag: el.tagName, cls: String(el.className || '').slice(0, 40), ep: el.dataset ? el.dataset.ep : null } : null, hash: location.hash };
})()`)).value;
await sleep(500);
const rect = (await ev(`(() => { const r = document.querySelector('[data-ep="3"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`)).value;
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
await sleep(4000);
out.afterClick = (await ev(`(async () => {
  const d = await window.api.loadData();
  return { clicks: window.__clicks, hash: location.hash, watched: d.library['16498']?.watched || [], historyTop: (d.history || [])[0] || null };
})()`)).value;

// дождаться плеера
let watch = null;
for (let i = 0; i < 10; i++) {
  await sleep(2500);
  watch = (await ev(`(() => ({
    hash: location.hash,
    tr: document.querySelectorAll('#translations .file').length,
    epLabel: document.querySelector('#ep-label')?.innerText || '',
    currentEp: document.querySelector('.ep.current')?.dataset?.ep || '',
    titleLink: (() => { const a = document.querySelector('.player-top a.t'); return a ? { text: a.innerText.slice(0, 40), href: a.getAttribute('href') } : null; })(),
    error: document.querySelector('.empty')?.innerText?.slice(0, 120) || '',
  }))()`)).value;
  if (watch && (watch.tr || watch.error)) break;
}
out.watch = watch;
await shot('12-03-watch');
out.errors = errors;
console.log(JSON.stringify(out, null, 2));
ws.close();
process.exit(0);
